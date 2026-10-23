import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";
import { createBackendTestContext } from "./helpers/backend-test-context";

// Next installs this global before loading its AsyncLocalStorage facade. The
// direct Node runner used by the repository does not, so provide the same Node
// primitive before importing the Next internals exercised by this integration test.
(globalThis as typeof globalThis & { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;
let staticGenerationAsyncStorage: any;

type CachedEntry = {
  value: unknown;
  tags: string[];
};

/**
 * Minimal Data Cache adapter used only to exercise Next's unstable_cache and
 * revalidateTag together at route-handler boundaries. It purges tagged entries
 * synchronously, which models the required next-read freshness contract.
 */
class TestIncrementalCache {
  readonly entries = new Map<string, CachedEntry>();
  readonly writesByTag = new Map<string, number>();
  readonly revalidatedTags: string[] = [];
  readonly isOnDemandRevalidate = false;

  async fetchCacheKey(key: string): Promise<string> {
    return key;
  }

  async get(key: string): Promise<{ value: unknown; isStale: false } | null> {
    const entry = this.entries.get(key);
    return entry ? { value: entry.value, isStale: false } : null;
  }

  async set(key: string, value: unknown, context: { tags?: string[] }): Promise<void> {
    const tags = context.tags ?? [];
    this.entries.set(key, { value, tags });
    for (const tag of tags) {
      this.writesByTag.set(tag, (this.writesByTag.get(tag) ?? 0) + 1);
    }
  }

  async revalidateTag(tags: string | string[]): Promise<void> {
    for (const tag of Array.isArray(tags) ? tags : [tags]) {
      this.revalidatedTags.push(tag);
      this.entries.forEach((entry, key) => {
        if (entry.tags.includes(tag)) this.entries.delete(key);
      });
    }
  }

  writesFor(tag: string): number {
    return this.writesByTag.get(tag) ?? 0;
  }
}

function request(path: string, method: string, body: unknown, token?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("cookie", `token=${token}`);
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

async function inNextCacheContext<T>(cache: TestIncrementalCache, action: () => Promise<T>): Promise<T> {
  const storage = staticGenerationAsyncStorage ?? await import(
    "next/dist/client/components/static-generation-async-storage.external"
  ).then((module) => module.staticGenerationAsyncStorage);
  staticGenerationAsyncStorage = storage;
  const store: { revalidatedTags?: string[] } & Record<string, unknown> = {
    incrementalCache: cache,
    isStaticGeneration: false,
    prerenderState: null,
    urlPathname: "/api/test-cache",
    pagePath: "/api/test-cache",
    fetchCache: "auto",
  };
  const result = await storage.run(store, action);
  // revalidateTag() only records tags on the store; Next's AppRouteRouteModule
  // flushes them to the incremental cache after the handler returns. Handlers
  // are called directly here, so mirror that flush before the next read.
  await cache.revalidateTag(store.revalidatedTags ?? []);
  return result;
}

async function json(response: Response): Promise<any> {
  if (response.status >= 500) {
    assert.fail(await response.text());
  }
  return response.json();
}

test("stats and recap refresh per user after relevant committed mutations", async () => {
  const context = await createBackendTestContext();
  const cache = new TestIncrementalCache();
  try {
    const [statsRoute, recapRoute, ratingsRoute, reviewsRoute, reviewRoute, diaryRoute, auth, cacheTags] = await Promise.all([
      import("../src/app/api/users/[username]/stats/route"),
      import("../src/app/api/users/[username]/recap/route"),
      import("../src/app/api/ratings/route"),
      import("../src/app/api/reviews/route"),
      import("../src/app/api/reviews/[id]/route"),
      import("../src/app/api/diary/route"),
      import("../src/utils/auth"),
      import("../src/services/user-derived-cache"),
    ]);
    const year = new Date().getUTCFullYear();
    const [userA, userB, itemA, itemB] = await Promise.all([
      context.createUser({ username: "cache-user-a" }),
      context.createUser({ username: "cache-user-b" }),
      context.createMusicItem({ id: "cache-item-a" }),
      context.createMusicItem({ id: "cache-item-b" }),
    ]);
    const [tokenA, tokenB] = await Promise.all([
      auth.signToken({ userId: userA.id, username: userA.username }),
      auth.signToken({ userId: userB.id, username: userB.username }),
    ]);
    const [initialReviewA] = await Promise.all([
      context.prisma.review.create({
        data: {
          userId: userA.id,
          musicItemId: itemA.id,
          content: "Initial A review",
          ratingValue: 2,
          tags: "happy",
          createdAt: new Date(Date.UTC(year, 0, 2)),
        },
      }),
      context.prisma.rating.create({ data: { userId: userA.id, musicItemId: itemA.id, value: 2 } }),
      context.prisma.review.create({
        data: {
          userId: userB.id,
          musicItemId: itemB.id,
          content: "Initial B review",
          ratingValue: 4,
          tags: "calm",
          createdAt: new Date(Date.UTC(year, 0, 2)),
        },
      }),
      context.prisma.rating.create({ data: { userId: userB.id, musicItemId: itemB.id, value: 4 } }),
    ]);

    const stats = (username: string) => inNextCacheContext(cache, () => statsRoute.GET(
      new Request(`http://localhost/api/users/${username}/stats`),
      { params: { username } },
    ));
    const recap = (username: string) => inNextCacheContext(cache, () => recapRoute.GET(
      new Request(`http://localhost/api/users/${username}/recap?year=${year}`),
      { params: { username } },
    ));
    const mutate = <T>(action: () => Promise<T>) => inNextCacheContext(cache, action);
    const statsTagA = cacheTags.userStatsCacheTag(userA.id);
    const statsTagB = cacheTags.userStatsCacheTag(userB.id);
    const recapTagA = cacheTags.userRecapCacheTag(userA.id, year);

    assert.equal((await json(await stats(userA.username))).averageRating, 2);
    assert.equal((await json(await stats(userB.username))).averageRating, 4);
    assert.equal((await json(await recap(userA.username))).totalReviews, 1);
    assert.deepEqual([cache.writesFor(statsTagA), cache.writesFor(statsTagB), cache.writesFor(recapTagA)], [1, 1, 1]);

    const ratingResponse = await mutate(() => ratingsRoute.POST(
      request("/api/ratings", "POST", { musicItemId: itemA.id, value: 4.5 }, tokenA),
    ));
    assert.equal(ratingResponse.status, 200);
    assert.equal((await json(await stats(userA.username))).averageRating, 4.5);
    assert.equal(cache.writesFor(statsTagA), 2);
    assert.equal((await json(await stats(userB.username))).averageRating, 4);
    assert.equal(cache.writesFor(statsTagB), 1, "invalidating A must keep B's cache hot");

    const createdReview = await json(await mutate(() => reviewsRoute.POST(
      request("/api/reviews", "POST", {
        musicItemId: itemA.id,
        content: "Second A review",
        ratingValue: 3.5,
        tags: ["sad"],
      }, tokenA),
    )));
    assert.equal((await json(await stats(userA.username))).ratingDistribution[3.5], 1);
    assert.equal((await json(await recap(userA.username))).totalReviews, 2);
    assert.deepEqual([cache.writesFor(statsTagA), cache.writesFor(recapTagA)], [3, 2]);

    const patched = await mutate(() => reviewRoute.PATCH(
      request(`/api/reviews/${createdReview.review.id}`, "PATCH", {
        content: "Second A review updated",
        ratingValue: 5,
        tags: ["calm"],
      }, tokenA),
      { params: { id: createdReview.review.id } },
    ));
    assert.equal(patched.status, 200);
    assert.equal((await json(await stats(userA.username))).averageRating, 5);
    assert.equal((await json(await recap(userA.username))).avgRating, "3.5");
    assert.deepEqual([cache.writesFor(statsTagA), cache.writesFor(recapTagA)], [4, 3]);

    const deleted = await mutate(() => reviewRoute.DELETE(
      request(`/api/reviews/${createdReview.review.id}`, "DELETE", {}, tokenA),
      { params: { id: createdReview.review.id } },
    ));
    assert.equal(deleted.status, 200);
    assert.equal((await json(await stats(userA.username))).ratingDistribution[3.5], 0);
    assert.equal((await json(await recap(userA.username))).totalReviews, 1);
    assert.deepEqual([cache.writesFor(statsTagA), cache.writesFor(recapTagA)], [5, 4]);

    const writesBeforeContentOnlyUpdate = [cache.writesFor(statsTagA), cache.writesFor(recapTagA)];
    const contentOnlyPatch = await mutate(() => reviewRoute.PATCH(
      request(`/api/reviews/${initialReviewA.id}`, "PATCH", {
        content: "Initial A review with corrected prose",
      }, tokenA),
      { params: { id: initialReviewA.id } },
    ));
    assert.equal(contentOnlyPatch.status, 200);
    await json(await stats(userA.username));
    await json(await recap(userA.username));
    assert.deepEqual(
      [cache.writesFor(statsTagA), cache.writesFor(recapTagA)],
      writesBeforeContentOnlyUpdate,
      "content-only review edits must not invalidate derived aggregates",
    );

    const statsWritesBeforeDiary = cache.writesFor(statsTagA);
    const diaryCreated = await mutate(() => diaryRoute.POST(
      request("/api/diary", "POST", { musicItemId: itemA.id, ratingValue: 4 }, tokenA),
    ));
    assert.equal(diaryCreated.status, 201);
    assert.equal((await json(await stats(userA.username))).diaryEntries, 1);
    assert.equal(cache.writesFor(statsTagA), statsWritesBeforeDiary, "diary stats are read outside the cached aggregate");

    const statsWritesBeforeFailedMutation = cache.writesFor(statsTagA);
    const invalidRating = await mutate(() => ratingsRoute.POST(
      request("/api/ratings", "POST", { musicItemId: itemA.id, value: 5.25 }, tokenA),
    ));
    assert.equal(invalidRating.status, 400);
    await json(await stats(userA.username));
    assert.equal(cache.writesFor(statsTagA), statsWritesBeforeFailedMutation);

    const concurrentRatings = await Promise.all([
      mutate(() => ratingsRoute.POST(
        request("/api/ratings", "POST", { musicItemId: itemA.id, value: 1 }, tokenA),
      )),
      mutate(() => ratingsRoute.POST(
        request("/api/ratings", "POST", { musicItemId: itemA.id, value: 4 }, tokenA),
      )),
    ]);
    assert.deepEqual(concurrentRatings.map((response) => response.status), [200, 200]);
    assert.ok([1, 4].includes((await json(await stats(userA.username))).averageRating));
    assert.ok(cache.revalidatedTags.includes(statsTagA));
    assert.ok(cache.revalidatedTags.includes(recapTagA));
    assert.notEqual(tokenA, tokenB);
  } finally {
    await context.close();
  }
});
