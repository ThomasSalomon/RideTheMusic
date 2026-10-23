import assert from "node:assert/strict";
import test from "node:test";
import { createBackendTestContext } from "./helpers/backend-test-context";

function jsonRequest(path: string, method: string, body?: unknown, options: { token?: string; forwardedFor?: string } = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.token) headers.set("cookie", `token=${options.token}`);
  if (options.forwardedFor) headers.set("x-forwarded-for", options.forwardedFor);
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let forgedAddress = 0;
const forgedIp = () => `198.51.100.${++forgedAddress % 250}`;

test("security hardening for auth, profiles and user search", async (t) => {
  const context = await createBackendTestContext();
  const previousHops = process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUSTED_PROXY_HOPS;
  try {
    const [loginRoute, registerRoute, profileRoute, avatarRoute, searchRoute, meRoute, auth] = await Promise.all([
      import("../src/app/api/auth/login/route"),
      import("../src/app/api/auth/register/route"),
      import("../src/app/api/users/[username]/route"),
      import("../src/app/api/users/[username]/avatar/route"),
      import("../src/app/api/users/search/route"),
      import("../src/app/api/auth/me/route"),
      import("../src/utils/auth"),
    ]);
    const login = (usernameOrEmail: string, password: string, forwardedFor = forgedIp()) =>
      loginRoute.POST(jsonRequest("/api/auth/login", "POST", { usernameOrEmail, password }, { forwardedFor }));

    await t.test("RTM-SEC-101: rotating X-Forwarded-For no longer escapes the login limit", async () => {
      const victim = await context.createUser({ username: "rl-victim", password: "victim-password" });
      const bystander = await context.createUser({ username: "rl-bystander", password: "bystander-password" });

      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await login(victim.username, `guess-${i}`)).status);
      assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
      assert.deepEqual(statuses.slice(10), [429, 429]);

      // Case and spacing variants of the identifier share the account bucket.
      assert.equal((await login(" RL-VICTIM ", "guess")).status, 429);
      assert.equal((await login(bystander.username, bystander.password)).status, 200);
    });

    await t.test("RTM-SEC-101: with a trusted proxy the limit keys on the proxy-appended address", async () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 11; i++) {
          // Every attempt targets a new account and forges a new leftmost entry.
          const response = await login(`ip-target-${i}`, "guess", `${forgedIp()}, 203.0.113.50`);
          statuses.push(response.status);
        }
        assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
        assert.equal(statuses[10], 429);
        assert.equal((await login("ip-target-x", "guess", "203.0.113.51")).status, 400);
      } finally {
        delete process.env.TRUSTED_PROXY_HOPS;
      }
    });

    await t.test("RTM-SEC-101/105: registrations share one bucket and usernames are validated", async () => {
      const register = (username: string) => registerRoute.POST(jsonRequest("/api/auth/register", "POST", {
        username,
        email: `${username.replace(/[^a-z0-9]/gi, "")}-${forgedAddress}@example.test`,
        password: "valid-password",
      }, { forwardedFor: forgedIp() }));

      for (const invalid of ["u" + "x".repeat(30), "../evil", "name?x=1", "-leading", "spa ce"]) {
        const response = await register(invalid);
        assert.equal(response.status, 400, invalid);
      }
      for (let i = 0; i < 5; i++) {
        assert.equal((await register(`valid.user_${i}-ok`)).status, 200);
      }
      assert.equal((await register("one-too-many")).status, 429);
    });

    const owner = await context.createUser({ username: "avatar-owner" });
    const token = await auth.signToken({ userId: owner.id, username: owner.username });
    const putProfile = (body: Record<string, unknown>) => profileRoute.PUT(
      jsonRequest(`/api/users/${owner.username}`, "PUT", body, { token }),
      { params: { username: owner.username } },
    );

    await t.test("RTM-SEC-102: profile text and avatar sizes are bounded", async () => {
      assert.equal((await putProfile({ favoriteGenre: "g".repeat(51) })).status, 400);
      assert.equal((await putProfile({ favoriteGenre: "g".repeat(50) })).status, 200);
      assert.equal((await putProfile({ profileImage: "/avatars/" + "a".repeat(400) })).status, 400);

      const oversized = "data:image/jpeg;base64," + "A".repeat(300_000);
      const rejected = await putProfile({ profileImage: oversized });
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).code, "PROFILE_IMAGE_TOO_LARGE");
    });

    await t.test("RTM-SEC-102: uploaded avatars are served by URL, never inlined in payloads", async () => {
      const bytes = Buffer.from("fake-jpeg-bytes");
      const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
      const saved = await putProfile({ profileImage: dataUrl });
      assert.equal(saved.status, 200);
      const avatarUrl: string = (await saved.json()).profile.profileImage;
      assert.match(avatarUrl, /^\/api\/users\/avatar-owner\/avatar\?v=[\w-]{16}$/);

      const profile = await (await profileRoute.GET(
        jsonRequest(`/api/users/${owner.username}`, "GET"),
        { params: { username: owner.username } },
      )).json();
      const me = await (await meRoute.GET(jsonRequest("/api/auth/me", "GET", undefined, { token }))).json();
      const search = await (await searchRoute.GET(jsonRequest("/api/users/search?q=avatar-owner", "GET"))).json();
      assert.equal(profile.profile.profileImage, avatarUrl);
      assert.equal(me.user.profileImage, avatarUrl);
      assert.equal(search[0].profileImage, avatarUrl);

      const image = await avatarRoute.GET(
        jsonRequest(avatarUrl, "GET"),
        { params: { username: owner.username } },
      );
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/jpeg");
      assert.match(image.headers.get("cache-control") ?? "", /immutable/);
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);

      // Saving the editor unchanged echoes the URL back; the stored photo stays.
      assert.equal((await putProfile({ profileImage: avatarUrl, bio: "kept" })).status, 200);
      const stored = await context.prisma.user.findUnique({ where: { id: owner.id }, select: { profileImage: true } });
      assert.equal(stored?.profileImage, dataUrl);

      const missing = await avatarRoute.GET(
        jsonRequest("/api/users/rl-victim/avatar", "GET"),
        { params: { username: "rl-victim" } },
      );
      assert.equal(missing.status, 404);
    });

    await t.test("RTM-SEC-104: user search pagination is bounded and hides internal ids", async () => {
      const search = (query: string) => searchRoute.GET(jsonRequest(`/api/users/search?${query}`, "GET"));
      assert.equal((await search("limit=100000")).status, 400);
      assert.equal((await search("limit=0")).status, 400);
      assert.equal((await search("index=-5")).status, 400);
      assert.equal((await search("index=abc")).status, 400);
      assert.equal((await search(`q=${"x".repeat(101)}`)).status, 400);

      const users = await (await search("limit=50")).json();
      assert.ok(users.length > 0);
      assert.ok(users.every((user: Record<string, unknown>) => !("id" in user)));
      assert.ok(users.every((user: { profileImage: string | null }) => !user.profileImage?.startsWith("data:")));
    });
  } finally {
    if (previousHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = previousHops;
    await context.close();
  }
});
