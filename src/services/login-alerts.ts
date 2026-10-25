import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/services/db";
import { newSignInEmail, type EmailLocale } from "@/services/account-emails";
import { getAppUrl, sendMail } from "@/services/mail";
import { readCookie, type CookieResponse } from "@/utils/auth";
import { runInBackground } from "@/utils/background";
import { getClientIP } from "@/utils/rateLimit";

export const DEVICE_COOKIE_NAME = "rtm_device";
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Keeps the table bounded per account; the least recently seen browsers go first.
export const MAX_KNOWN_DEVICES = 20;

type SignInUser = Readonly<{ id: string; username: string; email: string }>;

function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

/** Reuses a well-formed device cookie, otherwise mints a fresh random id. */
export function readOrCreateDeviceId(request: Request): string {
  const current = readCookie(request, DEVICE_COOKIE_NAME);
  return current && DEVICE_ID_PATTERN.test(current) ? current : randomBytes(32).toString("base64url");
}

export function setDeviceCookie(response: CookieResponse, deviceId: string): void {
  response.cookies.set(DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

/** Records the browser for the account and reports whether it had signed in before. */
export async function rememberDevice(
  userId: string,
  deviceId: string,
  client: PrismaClient = prisma,
): Promise<{ isNew: boolean }> {
  const deviceHash = hashDeviceId(deviceId);
  const now = new Date();

  const seen = await client.knownDevice.updateMany({
    where: { userId, deviceHash },
    data: { lastSeenAt: now },
  });
  if (seen.count > 0) return { isNew: false };

  try {
    await client.knownDevice.create({ data: { userId, deviceHash, lastSeenAt: now } });
  } catch (error) {
    // A concurrent sign-in from the same browser created it first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { isNew: false };
    throw error;
  }

  const stale = await client.knownDevice.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
    skip: MAX_KNOWN_DEVICES,
    select: { id: true },
  });
  if (stale.length > 0) {
    await client.knownDevice.deleteMany({ where: { id: { in: stale.map((device) => device.id) } } });
  }

  return { isNew: true };
}

/** Coarse browser and OS names only, so the email never repeats raw header text. */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;

  const browser =
    /Edg(e|A|iOS)?\//.test(userAgent) ? "Edge"
    : /OPR\/|Opera/.test(userAgent) ? "Opera"
    : /Firefox\/|FxiOS\//.test(userAgent) ? "Firefox"
    : /Chrome\/|CriOS\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari"
    : null;
  const os =
    /Windows/.test(userAgent) ? "Windows"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /CrOS/.test(userAgent) ? "ChromeOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;

  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os;
}

function displayableIp(ip: string | null): string | null {
  return ip && /^[0-9A-Fa-f:.]{2,45}$/.test(ip) ? ip : null;
}

/**
 * Remembers the browser behind a successful sign-in and, the first time it is
 * seen for the account, emails the owner. Sign-in never fails because of this:
 * errors are logged and the session is still issued.
 */
export async function handleSignInDevice(
  request: Request,
  response: CookieResponse,
  user: SignInUser,
  locale: EmailLocale,
): Promise<void> {
  const deviceId = readOrCreateDeviceId(request);
  setDeviceCookie(response, deviceId);

  let isNew: boolean;
  try {
    ({ isNew } = await rememberDevice(user.id, deviceId));
  } catch (error) {
    console.error("Known device bookkeeping failed:", error instanceof Error ? error.message : error);
    return;
  }
  if (!isNew) return;

  const signedInAt = new Date();
  const device = describeUserAgent(request.headers.get("user-agent"));
  const ip = displayableIp(getClientIP(request));

  runInBackground("new sign-in alert", () =>
    sendMail(
      newSignInEmail({
        locale,
        to: user.email,
        username: user.username,
        signedInAt,
        device,
        ip,
        recoveryUrl: `${getAppUrl()}/${locale}/forgot-password`,
      }),
    ),
  );
}

/** A browser that creates the account is known from the start, so its next sign-in is quiet. */
export async function rememberRegistrationDevice(
  request: Request,
  response: CookieResponse,
  userId: string,
): Promise<void> {
  const deviceId = readOrCreateDeviceId(request);
  setDeviceCookie(response, deviceId);
  try {
    await rememberDevice(userId, deviceId);
  } catch (error) {
    console.error("Known device bookkeeping failed:", error instanceof Error ? error.message : error);
  }
}
