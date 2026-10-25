import type { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/services/db";
import { passwordChangedEmail, passwordResetEmail, type EmailLocale } from "@/services/account-emails";
import { getAppUrl, sendMail } from "@/services/mail";
import { hashPassword } from "@/utils/crypto";
import { AppError } from "@/utils/errors";

export const PASSWORD_RESET_TTL_MINUTES = 30;
// Issuance throttles live in the database so they hold across instances. A
// short cooldown stops inbox flooding; the hourly cap is low enough to stop
// abuse and short enough that a hostile requester cannot lock recovery for long.
export const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
export const PASSWORD_RESETS_PER_HOUR = 5;

const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class PasswordResetTokenError extends AppError {
  constructor() {
    super("El enlace de recuperación no es válido o ya venció", 400, "RESET_TOKEN_INVALID");
  }
}

// Issuance reads recent tokens and then writes one, so two requests for the
// same account must not interleave or both would pass the cooldown. This
// serializes them per instance; across instances the in-memory address limit
// and the hourly cap still bound how many links an account can receive.
const issuing = new Map<string, Promise<void>>();

function oneAtATime(userId: string, task: () => Promise<void>): Promise<void> {
  const run = (issuing.get(userId) ?? Promise.resolve()).then(task);
  const settled = run.then(() => {}, () => {});
  issuing.set(userId, settled);
  void settled.then(() => {
    if (issuing.get(userId) === settled) issuing.delete(userId);
  });
  return run;
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function findAccountByEmail(email: string, client: PrismaClient) {
  const select = { id: true, username: true, email: true, credentialsVersion: true } as const;
  const trimmed = email.trim();
  // Registration stores the address as typed, so an exact match wins; the
  // lowercase retry covers the usual case difference without a full scan.
  const exact = await client.user.findUnique({ where: { email: trimmed }, select });
  if (exact || trimmed === trimmed.toLowerCase()) return exact;
  return client.user.findUnique({ where: { email: trimmed.toLowerCase() }, select });
}

/**
 * Issues a single-use reset link and emails it. Unknown addresses and throttled
 * requests end silently: callers answer every request the same way and run this
 * in the background, so neither the response nor its timing reveals an account.
 */
export async function requestPasswordReset(
  email: string,
  locale: EmailLocale,
  client: PrismaClient = prisma,
): Promise<void> {
  const user = await findAccountByEmail(email, client);
  if (!user) return;
  await oneAtATime(user.id, () => issuePasswordReset(user, locale, client));
}

async function issuePasswordReset(
  user: { id: string; username: string; email: string; credentialsVersion: number },
  locale: EmailLocale,
  client: PrismaClient,
): Promise<void> {
  const now = new Date();
  const recent = await client.passwordResetToken.findMany({
    where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: PASSWORD_RESETS_PER_HOUR,
    select: { createdAt: true },
  });
  if (recent.length >= PASSWORD_RESETS_PER_HOUR) return;
  if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < PASSWORD_RESET_COOLDOWN_MS) return;

  const token = randomBytes(32).toString("base64url");
  // Only the newest link works: issuing one retires every earlier unused link.
  await client.$transaction([
    client.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
    client.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        credentialsVersion: user.credentialsVersion,
        createdAt: now,
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
      },
    }),
  ]);

  // The token travels in the fragment, which browsers never send to the server
  // or in Referer headers, so it stays out of access logs and third-party requests.
  await sendMail(
    passwordResetEmail({
      locale,
      to: user.email,
      username: user.username,
      resetUrl: `${getAppUrl()}/${locale}/reset-password#token=${token}`,
      expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
    }),
  );
}

/**
 * Redeems a reset token: sets the new password, bumps credentialsVersion,
 * revokes every session and retires every other outstanding link. The token is
 * accepted only while unused, unexpired and issued for the account's current
 * credentials, so a password change made after the email kills the link.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  client: PrismaClient = prisma,
): Promise<{ email: string; username: string; changedAt: Date }> {
  if (!RESET_TOKEN_PATTERN.test(token)) throw new PasswordResetTokenError();

  const tokenHash = hashResetToken(token);
  const hashedPassword = await hashPassword(newPassword);

  const account = await client.$transaction(async (tx) => {
    const now = new Date();
    const record = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        credentialsVersion: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { email: true, username: true, credentialsVersion: true } },
      },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt <= now ||
      record.user.credentialsVersion !== record.credentialsVersion
    ) {
      return null;
    }

    // Claiming first makes concurrent redemptions of one token race on a single row.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const updated = await tx.user.updateMany({
      where: { id: record.userId, credentialsVersion: record.credentialsVersion },
      data: { password: hashedPassword, credentialsVersion: { increment: 1 } },
    });
    if (updated.count !== 1) return null;

    await tx.authSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: now },
    });

    return { email: record.user.email, username: record.user.username, changedAt: now };
  });

  if (!account) throw new PasswordResetTokenError();
  return account;
}

export function sendPasswordChangedEmail(
  account: { email: string; username: string; changedAt: Date },
  locale: EmailLocale,
): Promise<void> {
  return sendMail(
    passwordChangedEmail({
      locale,
      to: account.email,
      username: account.username,
      changedAt: account.changedAt,
      recoveryUrl: `${getAppUrl()}/${locale}/forgot-password`,
    }),
  );
}
