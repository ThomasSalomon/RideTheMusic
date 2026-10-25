import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import type { PrismaClient } from "@prisma/client";
import { SignJWT, decodeJwt } from "jose";
import { hashPassword } from "../src/utils/crypto";

const SECRET = "revocable-session-test-secret-with-enough-entropy";
const USER_ID = "session-user";
const USERNAME = "session-user";

type Context = {
  client: Client;
  prisma: PrismaClient;
  signToken: typeof import("../src/utils/auth").signToken;
  verifyToken: typeof import("../src/utils/auth").verifyToken;
  login: typeof import("../src/app/api/auth/login/route").POST;
  register: typeof import("../src/app/api/auth/register/route").POST;
  logout: typeof import("../src/app/api/auth/logout/route").POST;
  password: typeof import("../src/app/api/users/[username]/password/route").PATCH;
};

function request(url: string, method: string, body?: unknown, token?: string): Request {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (token) headers.set("cookie", `token=${token}`);
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function tokenFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie") ?? "";
  const match = /token=([^;]+)/.exec(cookie);
  assert.ok(match, "la respuesta debe emitir una cookie de sesión");
  return match[1];
}

async function setup(): Promise<Context> {
  const url = "file::memory:?cache=shared";
  process.env.JWT_SECRET = SECRET;
  process.env.DATABASE_URL = url;
  process.env.TURSO_DATABASE_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;

  const client = createClient({ url });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL UNIQUE,
      "email" TEXT NOT NULL UNIQUE,
      "password" TEXT NOT NULL,
      "bio" TEXT,
      "favoriteGenre" TEXT,
      "profileImage" TEXT,
      "profileColor" TEXT DEFAULT 'emerald',
      "credentialsVersion" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "AuthSession" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "credentialsVersion" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" DATETIME NOT NULL,
      "revokedAt" DATETIME,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession" ("userId", "revokedAt");
    CREATE TABLE "KnownDevice" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "deviceHash" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "KnownDevice_userId_deviceHash_key" ON "KnownDevice" ("userId", "deviceHash");
  `);
  await client.execute({
    sql: 'INSERT INTO "User" ("id", "username", "email", "password", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
    args: [USER_ID, USERNAME, "session-user@example.test", await hashPassword("old-password")],
  });

  (await import("../src/services/mail")).setMailTransport(async () => {});
  const auth = await import("../src/utils/auth");
  const loginRoute = await import("../src/app/api/auth/login/route");
  const registerRoute = await import("../src/app/api/auth/register/route");
  const logoutRoute = await import("../src/app/api/auth/logout/route");
  const passwordRoute = await import("../src/app/api/users/[username]/password/route");
  const { prisma } = await import("../src/services/db");
  return { client, prisma, signToken: auth.signToken, verifyToken: auth.verifyToken, login: loginRoute.POST, register: registerRoute.POST, logout: logoutRoute.POST, password: passwordRoute.PATCH };
}

test("las sesiones persistentes permiten revocación individual y global", async (t) => {
  const context = await setup();
  try {
    const loginA = await context.login(request("http://localhost/api/auth/login", "POST", { usernameOrEmail: USERNAME, password: "old-password" }));
    const tokenA = tokenFrom(loginA);
    const loginB = await context.login(request("http://localhost/api/auth/login", "POST", { usernameOrEmail: USERNAME, password: "old-password" }));
    const tokenB = tokenFrom(loginB);
    const claimsA = decodeJwt(tokenA);

    await t.test("login registra un jti aleatorio y una expiración coherente", async () => {
      assert.equal(loginA.status, 200);
      assert.equal(typeof claimsA.sessionId, "string");
      assert.equal(claimsA.credentialsVersion, 0);
      assert.equal((await context.prisma.authSession.count({ where: { userId: USER_ID, revokedAt: null } })), 2);
      assert.deepEqual(await context.verifyToken(tokenA), { userId: USER_ID, username: USERNAME });
    });

    await t.test("registro también crea una sesión persistente antes de emitir cookie", async () => {
      const registration = await context.register(request("http://localhost/api/auth/register", "POST", {
        username: "registered-user",
        email: "registered@example.test",
        password: "registered-password",
      }));
      assert.equal(registration.status, 200);
      const registeredToken = tokenFrom(registration);
      const claims = decodeJwt(registeredToken);
      assert.equal(typeof claims.sessionId, "string");
      const session = await context.prisma.authSession.findUnique({ where: { id: String(claims.sessionId) } });
      assert.equal(session?.userId, String(claims.userId));
      await context.prisma.user.update({
        where: { id: String(claims.userId) },
        data: { credentialsVersion: { increment: 1 } },
      });
      assert.equal(await context.verifyToken(registeredToken), null);
    });

    await t.test("tokens legacy, manipulados, de otra identidad y sesiones expiradas se rechazan", async () => {
      const legacy = await new SignJWT({ userId: USER_ID, username: USERNAME })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
        .sign(new TextEncoder().encode(SECRET));
      const impersonated = await new SignJWT({
        userId: "another-user", username: "other", sessionId: claimsA.sessionId, credentialsVersion: 0,
      }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
        .sign(new TextEncoder().encode(SECRET));
      assert.equal(await context.verifyToken(legacy), null);
      assert.equal(await context.verifyToken(`${tokenA}tampered`), null);
      assert.equal(await context.verifyToken(impersonated), null);

      const expiredServerSession = await context.signToken({ userId: USER_ID, username: USERNAME });
      await context.prisma.authSession.update({
        where: { id: String(decodeJwt(expiredServerSession).sessionId) },
        data: { expiresAt: new Date(0) },
      });
      assert.equal(await context.verifyToken(expiredServerSession), null);
    });

    await t.test("logout revoca sólo la sesión presente, borra cookie y admite repetición concurrente", async () => {
      const logout = await context.logout(request("http://localhost/api/auth/logout", "POST", undefined, tokenA));
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get("set-cookie") ?? "", /token=;/);
      assert.equal(await context.verifyToken(tokenA), null);
      assert.deepEqual(await context.verifyToken(tokenB), { userId: USER_ID, username: USERNAME });

      const [first, second] = await Promise.all([
        context.logout(request("http://localhost/api/auth/logout", "POST", undefined, tokenA)),
        context.logout(request("http://localhost/api/auth/logout", "POST", undefined, tokenA)),
      ]);
      assert.deepEqual([first.status, second.status], [200, 200]);
    });

    await t.test("cambiar contraseña revoca todas las sesiones, incrementa versión y exige nuevo login", async () => {
      const change = await context.password(
        request(`http://localhost/api/users/${USERNAME}/password`, "PATCH", { currentPassword: "old-password", newPassword: "new-password" }, tokenB),
        { params: { username: USERNAME } },
      );
      assert.equal(change.status, 200);
      assert.match(change.headers.get("set-cookie") ?? "", /token=;/);
      assert.equal(await context.verifyToken(tokenB), null);
      assert.equal(await context.prisma.authSession.count({ where: { userId: USER_ID, revokedAt: null } }), 0);
      assert.equal((await context.prisma.user.findUnique({ where: { id: USER_ID }, select: { credentialsVersion: true } }))?.credentialsVersion, 1);

      const oldLogin = await context.login(request("http://localhost/api/auth/login", "POST", { usernameOrEmail: USERNAME, password: "old-password" }));
      assert.equal(oldLogin.status, 400);
      const newLogin = await context.login(request("http://localhost/api/auth/login", "POST", { usernameOrEmail: USERNAME, password: "new-password" }));
      assert.equal(newLogin.status, 200);
      assert.deepEqual(await context.verifyToken(tokenFrom(newLogin)), { userId: USER_ID, username: USERNAME });
    });

    await t.test("si persiste una sesión no falla, login no informa éxito ni entrega cookie", async () => {
      await context.client.execute('DROP TABLE "AuthSession"');
      const originalError = console.error;
      console.error = () => undefined;
      try {
        const failed = await context.login(request("http://localhost/api/auth/login", "POST", { usernameOrEmail: USERNAME, password: "new-password" }));
        assert.equal(failed.status, 500);
        assert.equal(failed.headers.get("set-cookie"), null);
      } finally {
        console.error = originalError;
      }
    });
  } finally {
    await context.prisma.$disconnect();
    context.client.close();
  }
});
