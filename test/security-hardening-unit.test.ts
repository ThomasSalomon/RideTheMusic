import assert from "node:assert/strict";
import test from "node:test";
import {
  getClientIP,
  rateLimit,
  rateLimitEntryCount,
  RATE_LIMIT_MAX_ENTRIES,
} from "../src/utils/rateLimit";
import {
  avatarPath,
  isOwnAvatarUrl,
  publicProfileImage,
  withPublicAvatar,
} from "../src/services/avatar";
import { comparePassword, comparePasswordWithoutAccount, hashPassword } from "../src/utils/crypto";

function withForwardedFor(value?: string): Request {
  const headers = new Headers();
  if (value !== undefined) headers.set("x-forwarded-for", value);
  return new Request("http://localhost/api/auth/login", { method: "POST", headers });
}

test("client IP is never read from X-Forwarded-For without a trusted proxy", () => {
  assert.equal(getClientIP(withForwardedFor("203.0.113.7"), {}), null);
  assert.equal(getClientIP(withForwardedFor("203.0.113.7"), { TRUSTED_PROXY_HOPS: "0" }), null);
  assert.equal(getClientIP(withForwardedFor("203.0.113.7"), { TRUSTED_PROXY_HOPS: "nope" }), null);
});

test("client IP comes from the hop appended by the trusted proxies", () => {
  const forged = withForwardedFor("1.1.1.1, 2.2.2.2, 198.51.100.4");
  assert.equal(getClientIP(forged, { TRUSTED_PROXY_HOPS: "1" }), "198.51.100.4");
  assert.equal(getClientIP(forged, { TRUSTED_PROXY_HOPS: "2" }), "2.2.2.2");
  assert.equal(getClientIP(withForwardedFor("198.51.100.4"), { TRUSTED_PROXY_HOPS: "2" }), null);
  assert.equal(getClientIP(withForwardedFor(), { TRUSTED_PROXY_HOPS: "1" }), null);
  assert.equal(getClientIP(withForwardedFor("198.51.100.9"), { VERCEL: "1" }), "198.51.100.9");
});

test("rate limit store stays bounded when keys come from client input", () => {
  const options = { windowMs: 60_000, max: 1 };
  for (let i = 0; i < RATE_LIMIT_MAX_ENTRIES + 25; i++) rateLimit(`bound:${i}`, options);
  assert.ok(rateLimitEntryCount() <= RATE_LIMIT_MAX_ENTRIES);

  // The newest bucket survives eviction and keeps counting.
  const newest = `bound:${RATE_LIMIT_MAX_ENTRIES + 24}`;
  assert.equal(rateLimit(newest, options).success, false);
});

test("uploaded avatars are exposed as versioned URLs, other images unchanged", () => {
  const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  const url = publicProfileImage("ana.b", dataUrl);
  assert.match(url ?? "", /^\/api\/users\/ana\.b\/avatar\?v=[\w-]{16}$/);
  assert.notEqual(url, publicProfileImage("ana.b", `${dataUrl}AA`));
  assert.equal(publicProfileImage("ana.b", "/avatars/preset-1.png"), "/avatars/preset-1.png");
  assert.equal(publicProfileImage("ana.b", null), null);
  assert.deepEqual(withPublicAvatar({ username: "ana.b", profileImage: dataUrl, extra: 1 }), {
    username: "ana.b",
    profileImage: url,
    extra: 1,
  });

  assert.equal(isOwnAvatarUrl("ana.b", url!), true);
  assert.equal(isOwnAvatarUrl("ana.b", avatarPath("ana.b")), true);
  assert.equal(isOwnAvatarUrl("other", url!), false);
  assert.equal(isOwnAvatarUrl("ana.b", `${avatarPath("ana.b")}-evil`), false);
});

test("unknown-account password checks cost as much as a wrong password", async () => {
  const hash = await hashPassword("correct-password");
  await comparePasswordWithoutAccount("warm-up");

  const median = async (run: () => Promise<unknown>) => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await run();
      samples.push(performance.now() - started);
    }
    return samples.sort((a, b) => a - b)[2];
  };

  const wrongPassword = await median(() => comparePassword("wrong-password", hash));
  const missingAccount = await median(() => comparePasswordWithoutAccount("wrong-password"));
  assert.equal(await comparePasswordWithoutAccount("anything"), false);
  assert.ok(
    missingAccount > wrongPassword * 0.5,
    `missing-account check took ${missingAccount.toFixed(1)}ms vs ${wrongPassword.toFixed(1)}ms`,
  );
});
