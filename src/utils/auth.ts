import { errors, jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { prisma } from "@/services/db";

export const AUTH_COOKIE_NAME = "token";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type AuthUser = Readonly<{
  userId: string;
  username: string;
}>;

export type AuthFailureReason = "missing" | "invalid" | "expired";

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: AuthFailureReason };

export type CookieResponse = {
  cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void };
};

type SessionTokenPayload = {
  userId: string;
  username: string;
  credentialsVersion: number;
  sessionId: string;
};

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1) continue;

    if (cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim();
    }
  }

  return undefined;
}

export function readAuthToken(request: Request): string | undefined {
  return readCookie(request, AUTH_COOKIE_NAME);
}

export function setAuthCookie(response: CookieResponse, token: string): void {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearAuthCookie(response: CookieResponse): void {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: new Date(0),
    path: "/",
  });
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: JWT_SECRET environment variable is missing in production environment!");
    }
    return new TextEncoder().encode("development-fallback-secret-key-do-not-use-in-prod");
  }
  return new TextEncoder().encode(secret);
}

async function signSessionToken(payload: SessionTokenPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * The id is a random session correlation identifier, not a credential on its
 * own: the signed JWT is still required. The token is returned only after the
 * server-side session has been created successfully.
 */
export async function signToken(payload: {
  userId: string;
  username: string;
  credentialsVersion?: number;
}): Promise<string> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const credentialsVersion = payload.credentialsVersion ?? 0;
  const token = await signSessionToken({
    userId: payload.userId,
    username: payload.username,
    credentialsVersion,
    sessionId,
  });

  await prisma.authSession.create({
    data: {
      id: sessionId,
      userId: payload.userId,
      credentialsVersion,
      expiresAt,
    },
  });

  return token;
}

async function verifyJwt(token: string): Promise<SessionTokenPayload | AuthFailureReason> {
  const secret = getSecretKey();

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      requiredClaims: ["iat", "exp"],
    });

    if (
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      typeof payload.username !== "string" ||
      payload.username.length === 0 ||
      typeof payload.sessionId !== "string" ||
      payload.sessionId.length === 0 ||
      typeof payload.credentialsVersion !== "number" ||
      !Number.isSafeInteger(payload.credentialsVersion) ||
      payload.credentialsVersion < 0
    ) {
      return "invalid";
    }

    return {
      userId: payload.userId,
      username: payload.username,
      sessionId: payload.sessionId,
      credentialsVersion: payload.credentialsVersion,
    };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return "expired";
    if (error instanceof errors.JOSEError) return "invalid";
    throw error;
  }
}

async function authenticateToken(token: string): Promise<AuthResult> {
  const payload = await verifyJwt(token);
  if (typeof payload === "string") return { ok: false, reason: payload };

  // This is the only persistence operation in authentication: the relation
  // filter proves the user still exists with the expected global version.
  const session = await prisma.authSession.findFirst({
    where: {
      id: payload.sessionId,
      userId: payload.userId,
      credentialsVersion: payload.credentialsVersion,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      user: { credentialsVersion: payload.credentialsVersion },
    },
    select: { id: true },
  });

  if (!session) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, user: { userId: payload.userId, username: payload.username } };
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  const result = await authenticateToken(token);
  return result.ok ? result.user : null;
}

export async function resolveAuthUser(request?: Request): Promise<AuthResult> {
  const token = request
    ? readAuthToken(request)
    : cookies().get(AUTH_COOKIE_NAME)?.value;

  if (!token) return { ok: false, reason: "missing" };
  return authenticateToken(token);
}

export async function getAuthUser(request?: Request): Promise<AuthUser | null> {
  const result = await resolveAuthUser(request);
  return result.ok ? result.user : null;
}

/** Logout is idempotent: absent, invalid, expired, or already-revoked tokens end with no active cookie. */
export async function revokeSessionForToken(token: string): Promise<void> {
  const payload = await verifyJwt(token);
  if (typeof payload === "string") return;

  await prisma.authSession.updateMany({
    where: {
      id: payload.sessionId,
      userId: payload.userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}
