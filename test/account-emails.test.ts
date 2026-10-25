import assert from "node:assert/strict";
import test from "node:test";
import { createBackendTestContext } from "./helpers/backend-test-context";

type Sent = { to: string; subject: string; text: string; html: string };

function jsonRequest(
  path: string,
  body: unknown,
  options: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json", ...options.headers });
  const cookie = Object.entries(options.cookies ?? {}).map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function cookieFrom(response: Response, name: string): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`).exec(header);
    if (match) return match[1];
  }
  return undefined;
}

function resetTokenFrom(mail: Sent): string {
  const match = /\/reset-password#token=([A-Za-z0-9_-]+)/.exec(mail.text);
  assert.ok(match, "the reset email must carry the token in the URL fragment");
  return match[1];
}

test("account emails: sign-in alerts and password recovery", async (t) => {
  const context = await createBackendTestContext();
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://app.example.test";
  const outbox: Sent[] = [];

  try {
    const [mail, background, loginRoute, registerRoute, forgotRoute, resetRoute, passwordRoute, auth, reset, emails] =
      await Promise.all([
        import("../src/services/mail"),
        import("../src/utils/background"),
        import("../src/app/api/auth/login/route"),
        import("../src/app/api/auth/register/route"),
        import("../src/app/api/auth/forgot-password/route"),
        import("../src/app/api/auth/reset-password/route"),
        import("../src/app/api/users/[username]/password/route"),
        import("../src/utils/auth"),
        import("../src/services/password-reset"),
        import("../src/services/account-emails"),
      ]);
    mail.setMailTransport(async (message) => {
      outbox.push(message);
    });

    const settle = async () => {
      await background.waitForBackgroundTasks();
      return outbox.splice(0);
    };
    const login = (usernameOrEmail: string, password: string, cookies?: Record<string, string>) =>
      loginRoute.POST(jsonRequest("/api/auth/login", { usernameOrEmail, password }, {
        cookies,
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" },
      }));
    const forgot = (email: string, headers?: Record<string, string>) =>
      forgotRoute.POST(jsonRequest("/api/auth/forgot-password", { email, locale: "es" }, { headers }));
    const redeem = (token: string, newPassword: string) =>
      resetRoute.POST(jsonRequest("/api/auth/reset-password", { token, newPassword, locale: "es" }));

    await t.test("a sign-in from an unseen browser emails the owner once", async () => {
      const user = await context.createUser({ username: "alert-user", email: "alert@example.test" });

      const first = await login(user.username, user.password);
      assert.equal(first.status, 200);
      const deviceId = cookieFrom(first, "rtm_device");
      assert.ok(deviceId && /^[A-Za-z0-9_-]{43}$/.test(deviceId));

      const [alert, ...rest] = await settle();
      assert.equal(rest.length, 0);
      assert.equal(alert.to, "alert@example.test");
      assert.match(alert.text, /Chrome · Windows/);
      assert.match(alert.text, /https:\/\/app\.example\.test\/en\/forgot-password/);

      const again = await login(user.username, user.password, { rtm_device: deviceId });
      assert.equal(again.status, 200);
      assert.equal(cookieFrom(again, "rtm_device"), deviceId);
      assert.deepEqual(await settle(), []);

      // A forged or malformed device cookie counts as a new browser.
      await login(user.username, user.password, { rtm_device: "forged" });
      assert.equal((await settle()).length, 1);

      const stored = await context.prisma.knownDevice.findMany({ where: { userId: user.id } });
      assert.equal(stored.length, 2);
      assert.ok(stored.every((device) => device.deviceHash !== deviceId), "only the hash is stored");
    });

    await t.test("the browser that registers is already known", async () => {
      const registered = await registerRoute.POST(jsonRequest("/api/auth/register", {
        username: "fresh-user",
        email: "fresh@example.test",
        password: "fresh-password",
      }));
      assert.equal(registered.status, 200);
      const deviceId = cookieFrom(registered, "rtm_device");
      assert.ok(deviceId);

      assert.equal((await login("fresh-user", "fresh-password", { rtm_device: deviceId })).status, 200);
      assert.deepEqual(await settle(), []);
    });

    await t.test("known devices stay bounded per account", async () => {
      const user = await context.createUser({ username: "many-devices" });
      for (let i = 0; i < 22; i++) {
        await context.prisma.knownDevice.create({
          data: { userId: user.id, deviceHash: `seed-${i}`, lastSeenAt: new Date(Date.now() - (i + 1) * 60_000) },
        });
      }
      await login(user.username, user.password);
      await settle();
      const devices = await context.prisma.knownDevice.findMany({ where: { userId: user.id } });
      const { MAX_KNOWN_DEVICES } = await import("../src/services/login-alerts");
      assert.equal(devices.length, MAX_KNOWN_DEVICES);
      assert.ok(!devices.some((device) => device.deviceHash === "seed-21"), "the least recently seen go first");
    });

    await t.test("recovery requests answer identically for unknown and known addresses", async () => {
      await context.createUser({ username: "recover-me", email: "recover@example.test" });

      const unknown = await forgot("nobody@example.test");
      const known = await forgot("recover@example.test");
      assert.equal(unknown.status, 202);
      assert.equal(known.status, 202);
      assert.deepEqual(await unknown.json(), await known.json());

      const sent = await settle();
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, "recover@example.test");
      assert.match(sent[0].subject, /Restablecé/);
      assert.match(sent[0].text, / https:\/\/app\.example\.test\/es\/reset-password#token=/);

      const token = resetTokenFrom(sent[0]);
      const stored = await context.prisma.passwordResetToken.findMany({ where: { user: { email: "recover@example.test" } } });
      assert.equal(stored.length, 1);
      assert.equal(stored[0].tokenHash, reset.hashResetToken(token));
      assert.notEqual(stored[0].tokenHash, token);
    });

    await t.test("reset links never trust the request's Host header", async () => {
      await context.createUser({ username: "host-victim", email: "host-victim@example.test" });
      await forgot("host-victim@example.test", { host: "evil.example", "x-forwarded-host": "evil.example" });
      const [message] = await settle();
      assert.doesNotMatch(message.text + message.html, /evil\.example/);
      assert.match(message.text, /https:\/\/app\.example\.test\//);
    });

    await t.test("a valid link resets the password, revokes sessions and is single-use", async () => {
      const user = await context.createUser({ username: "reset-user", email: "reset@example.test", password: "old-password" });
      const sessionToken = tokenFromLogin(await login(user.username, "old-password"));
      await settle();

      await forgot("reset@example.test");
      const token = resetTokenFrom((await settle())[0]);

      const short = await redeem(token, "123");
      assert.equal(short.status, 400);

      const response = await redeem(token, "new-password");
      assert.equal(response.status, 200);
      assert.equal(await auth.verifyToken(sessionToken), null, "existing sessions are revoked");

      const [notice] = await settle();
      assert.equal(notice.to, "reset@example.test");
      assert.match(notice.subject, /contraseña .* cambió/);

      assert.equal((await login(user.username, "old-password")).status, 400);
      assert.equal((await login(user.username, "new-password")).status, 200);
      await settle();

      const replay = await redeem(token, "another-password");
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).code, "RESET_TOKEN_INVALID");
    });

    await t.test("only the newest link works, and it dies when it expires", async () => {
      const user = await context.createUser({ username: "rotate-user", email: "rotate@example.test" });

      await forgot("rotate@example.test");
      const first = resetTokenFrom((await settle())[0]);
      // Step past the issuance cooldown.
      await context.prisma.passwordResetToken.updateMany({
        where: { userId: user.id },
        data: { createdAt: new Date(Date.now() - 5 * 60_000) },
      });
      await forgot("rotate@example.test");
      const second = resetTokenFrom((await settle())[0]);

      assert.equal((await redeem(first, "rotated-password")).status, 400);

      await context.prisma.passwordResetToken.updateMany({
        where: { tokenHash: reset.hashResetToken(second) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await redeem(second, "rotated-password")).status, 400);
    });

    await t.test("changing the password from the profile kills outstanding links", async () => {
      const user = await context.createUser({ username: "profile-user", email: "profile@example.test", password: "profile-old" });
      await forgot("profile@example.test");
      const token = resetTokenFrom((await settle())[0]);

      const sessionToken = tokenFromLogin(await login(user.username, "profile-old"));
      await settle();
      const changed = await passwordRoute.PATCH(
        new Request(`http://localhost/api/users/${user.username}/password`, {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: `token=${sessionToken}` },
          body: JSON.stringify({ currentPassword: "profile-old", newPassword: "profile-new" }),
        }),
        { params: { username: user.username } },
      );
      assert.equal(changed.status, 200);
      const [notice] = await settle();
      assert.equal(notice.to, "profile@example.test");

      assert.equal((await redeem(token, "attacker-password")).status, 400);
      assert.equal((await login(user.username, "profile-new")).status, 200);
      await settle();
    });

    await t.test("issuance is throttled per account without changing the answer", async () => {
      const user = await context.createUser({ username: "flood-user", email: "flood@example.test" });

      const responses = [await forgot("flood@example.test"), await forgot("flood@example.test")];
      assert.deepEqual(responses.map((response) => response.status), [202, 202]);
      assert.equal((await settle()).length, 1, "the cooldown drops the second email");

      // Past the cooldown but over the hourly cap, nothing more is issued.
      await context.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      for (let i = 0; i < reset.PASSWORD_RESETS_PER_HOUR; i++) {
        await context.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: `seed-${i}`,
            credentialsVersion: 0,
            createdAt: new Date(Date.now() - (i + 2) * 60_000),
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
      }
      await reset.requestPasswordReset("flood@example.test", "en");
      assert.deepEqual(await settle(), []);

      // The in-memory address limit also answers 202.
      const limited = [];
      for (let i = 0; i < 3; i++) limited.push((await forgot("Flood@Example.test")).status);
      assert.deepEqual(limited, [202, 202, 202]);
      await settle();
    });

    await t.test("malformed tokens and bodies are rejected", async () => {
      assert.equal((await redeem("not-a-token", "valid-password")).status, 400);
      assert.equal((await redeem("A".repeat(43), "valid-password")).status, 400);
      const extra = await resetRoute.POST(jsonRequest("/api/auth/reset-password", { token: "x", newPassword: "y", admin: true }));
      assert.equal(extra.status, 400);
      assert.equal((await forgot("not-an-email")).status, 400);
    });

    await t.test("templates escape dynamic values", () => {
      const message = emails.newSignInEmail({
        locale: "en",
        to: "x@example.test",
        username: "<script>alert(1)</script>",
        signedInAt: new Date("2026-10-24T12:00:00Z"),
        device: null,
        ip: null,
        recoveryUrl: 'https://app.example.test/en/forgot-password"><img src=x>',
      });
      assert.doesNotMatch(message.html, /<script>|<img/);
      assert.match(message.html, /&lt;script&gt;/);
    });

    await t.test("production refuses to send without a provider or a safe APP_URL", () => {
      mail.setMailTransport(null);
      try {
        assert.throws(() => mail.resolveMailTransport({ NODE_ENV: "production" }), /not configured/);
        assert.throws(() => mail.getAppUrl({ NODE_ENV: "production" }), /APP_URL/);
        assert.throws(() => mail.getAppUrl({ NODE_ENV: "production", APP_URL: "http://app.example.test" }), /https/);
        assert.equal(mail.getAppUrl({ APP_URL: "https://app.example.test/some/path/" }), "https://app.example.test");
      } finally {
        mail.setMailTransport(async (message) => {
          outbox.push(message);
        });
      }
    });
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    const { setMailTransport } = await import("../src/services/mail");
    setMailTransport(null);
    await context.close();
  }
});

function tokenFromLogin(response: Response): string {
  const token = cookieFrom(response, "token");
  assert.ok(token, "login must issue a session cookie");
  return token;
}
