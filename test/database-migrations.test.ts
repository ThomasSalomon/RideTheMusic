import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@libsql/client";

const projectRoot = resolve(import.meta.dirname, "..");
const baselineName = "00000000000000_baseline";
const ratingMigrationName = "20260802183000_unique_current_rating";
const commentIdempotencyMigrationName = "20260804120000_comment_idempotency";
const baselinePath = join(
  projectRoot,
  "prisma",
  "migrations",
  baselineName,
  "migration.sql",
);
const prismaCli = join(projectRoot, "node_modules", "prisma", "build", "index.js");
const tsxCli = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

type CommandResult = ReturnType<typeof spawnSync>;

function fileUrl(path: string): string {
  return `file:${path.replaceAll(sep, "/")}`;
}

async function temporaryDatabase(label: string): Promise<{
  directory: string;
  path: string;
  url: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), `musicbox-${label}-`));
  const path = join(directory, "database.db");
  await writeFile(path, "");
  return { directory, path, url: fileUrl(path) };
}

async function cleanup(directory: string): Promise<void> {
  const expectedPrefix = resolve(tmpdir()) + sep;
  const target = resolve(directory);
  assert.ok(target.startsWith(expectedPrefix), `Directorio temporal inesperado: ${target}`);
  await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}

function runPrisma(args: string[], databaseUrl: string): CommandResult {
  return spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
    timeout: 60_000,
  });
}

function runRemoteRunner(args: string[], databaseUrl: string): CommandResult {
  return spawnSync(process.execPath, [tsxCli, "scripts/turso-migrate.ts", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "",
      TURSO_DATABASE_URL: databaseUrl,
      TURSO_AUTH_TOKEN: "",
      MUSICBOX_MIGRATION_ALLOW_LOCAL: "1",
      MUSICBOX_MIGRATION_CONFIRM: "local-test",
    },
    timeout: 60_000,
  });
}

function commandOutput(result: CommandResult): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
}

function assertSucceeded(result: CommandResult): void {
  assert.equal(result.status, 0, commandOutput(result));
}

async function assertDatabaseShape(
  url: string,
  expected: { tables: number; indexes: number } = { tables: 19, indexes: 34 },
): Promise<void> {
  const client = createClient({ url });
  try {
    const tables = await client.execute(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' " +
        "AND name NOT IN ('_prisma_migrations', '_musicbox_migrations')",
    );
    const indexes = await client.execute(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
    );
    const foreignKeyProblems = await client.execute("PRAGMA foreign_key_check");

    assert.equal(tables.rows.length, expected.tables);
    assert.equal(indexes.rows.length, expected.indexes);
    assert.deepEqual(foreignKeyProblems.rows, []);
  } finally {
    client.close();
  }
}

async function writeRepresentativeData(
  url: string,
  suffix: string,
  withDuplicateRating: boolean,
): Promise<void> {
  const seedClient = createClient({ url });
  const userId = `user-${suffix}`;
  const musicItemId = `album-${suffix}`;
  await seedClient.execute({
    sql: 'INSERT INTO "User" ("id", "username", "email", "password", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
    args: [userId, `listener-${suffix}`, `${suffix}@example.test`, "not-a-real-secret"],
  });
  seedClient.close();

  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  try {
    await prisma.musicItem.create({
      data: {
        id: musicItemId,
        title: "Migration Test Album",
        artist: "Test Artist",
        type: "ALBUM",
        coverUrl: "https://example.test/cover.jpg",
        releaseYear: 2026,
      },
    });
    await prisma.review.create({
      data: { content: "Preserved", ratingValue: 4.5, userId, musicItemId },
    });
    const ratingData = [
      {
        id: `rating-a-${suffix}`,
        value: 4,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        userId,
        musicItemId,
      },
    ];
    if (withDuplicateRating) {
      ratingData.push({
        id: `rating-b-${suffix}`,
        value: 4.5,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        userId,
        musicItemId,
      });
    }
    await prisma.rating.createMany({ data: ratingData });
    await prisma.diaryLog.createMany({
      data: [
        { id: `diary-a-${suffix}`, notes: null, userId, musicItemId },
        { id: `diary-b-${suffix}`, ratingValue: 5, userId, musicItemId },
        {
          id: `diary-legacy-${suffix}`,
          ratingValue: 3.5,
          notes: "Known legacy event; earlier details are unavailable",
          listenCount: 3,
          userId,
          musicItemId,
        },
      ],
    });

    assert.equal(
      await prisma.rating.count({ where: { userId, musicItemId } }),
      withDuplicateRating ? 2 : 1,
    );
    assert.equal(await prisma.diaryLog.count({ where: { userId, musicItemId } }), 3);
    const representedListens = await prisma.diaryLog.aggregate({
      where: { userId, musicItemId },
      _sum: { listenCount: true },
    });
    assert.equal(representedListens._sum.listenCount, 5);
  } finally {
    await prisma.$disconnect();
  }
}

async function assertRepresentativeData(
  url: string,
  suffix: string,
  expectedRatingId: string,
): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  try {
    const userId = `user-${suffix}`;
    const musicItemId = `album-${suffix}`;
    assert.equal(await prisma.user.count({ where: { id: userId } }), 1);
    assert.equal(await prisma.review.count({ where: { userId, musicItemId } }), 1);
    const ratings = await prisma.rating.findMany({
      where: { userId, musicItemId },
      select: { id: true },
    });
    assert.deepEqual(ratings, [{ id: expectedRatingId }]);
    assert.equal(await prisma.diaryLog.count({ where: { userId, musicItemId } }), 3);
    const legacy = await prisma.diaryLog.findUnique({
      where: { id: `diary-legacy-${suffix}` },
      select: { listenCount: true, notes: true, ratingValue: true },
    });
    assert.deepEqual(legacy, {
      listenCount: 3,
      notes: "Known legacy event; earlier details are unavailable",
      ratingValue: 3.5,
    });
  } finally {
    await prisma.$disconnect();
  }
}

test("el historial crea una base vacía, coincide con Prisma y es reejecutable", async () => {
  const database = await temporaryDatabase("empty");
  try {
    const firstDeploy = runPrisma(["migrate", "deploy"], database.url);
    assertSucceeded(firstDeploy);

    const status = runPrisma(["migrate", "status"], database.url);
    assertSucceeded(status);
    assert.match(commandOutput(status), /Database schema is up to date/i);

    const drift = runPrisma(
      [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      database.url,
    );
    assertSucceeded(drift);

    await assertDatabaseShape(database.url);
    await writeRepresentativeData(database.url, "empty", false);
    await assertRepresentativeData(database.url, "empty", "rating-a-empty");

    const secondDeploy = runPrisma(["migrate", "deploy"], database.url);
    assertSucceeded(secondDeploy);
    assert.match(commandOutput(secondDeploy), /No pending migrations/i);
    await assertRepresentativeData(database.url, "empty", "rating-a-empty");
  } finally {
    await cleanup(database.directory);
  }
});

test("una base existente se adopta sin ejecutar el baseline ni perder datos", async () => {
  const database = await temporaryDatabase("existing");
  try {
    const baselineSql = await readFile(baselinePath, "utf8");
    const client = createClient({ url: database.url });
    await client.executeMultiple(baselineSql);
    client.close();
    await writeRepresentativeData(database.url, "existing", true);

    const resolveResult = runPrisma(
      ["migrate", "resolve", "--applied", baselineName],
      database.url,
    );
    assertSucceeded(resolveResult);

    const deploy = runPrisma(["migrate", "deploy"], database.url);
    assertSucceeded(deploy);
    assert.match(commandOutput(deploy), new RegExp(ratingMigrationName));
    await assertDatabaseShape(database.url);
    await assertRepresentativeData(database.url, "existing", "rating-b-existing");
  } finally {
    await cleanup(database.directory);
  }
});

test("el runner Turso controla orden, adopción, checksum e idempotencia", async () => {
  const empty = await temporaryDatabase("remote-empty");
  const existing = await temporaryDatabase("remote-existing");
  try {
    const apply = runRemoteRunner(["apply", baselineName], empty.url);
    assertSucceeded(apply);
    assert.match(commandOutput(apply), /aplicada y registrada atómicamente/i);

    const reapply = runRemoteRunner(["apply", baselineName], empty.url);
    assertSucceeded(reapply);
    assert.match(commandOutput(reapply), /ya está aplicada/i);
    const applyRatingMigration = runRemoteRunner(["apply", ratingMigrationName], empty.url);
    assertSucceeded(applyRatingMigration);
    const reapplyRatingMigration = runRemoteRunner(["apply", ratingMigrationName], empty.url);
    assertSucceeded(reapplyRatingMigration);
    assert.match(commandOutput(reapplyRatingMigration), /ya está aplicada/i);
    const applyCommentMigration = runRemoteRunner(
      ["apply", commentIdempotencyMigrationName],
      empty.url,
    );
    assertSucceeded(applyCommentMigration);
    const reapplyCommentMigration = runRemoteRunner(
      ["apply", commentIdempotencyMigrationName],
      empty.url,
    );
    assertSucceeded(reapplyCommentMigration);
    assert.match(commandOutput(reapplyCommentMigration), /ya está aplicada/i);
    await assertDatabaseShape(empty.url, { tables: 16, indexes: 20 });

    const baselineSql = await readFile(baselinePath, "utf8");
    const client = createClient({ url: existing.url });
    await client.executeMultiple(baselineSql);
    client.close();
    await writeRepresentativeData(existing.url, "remote-existing", true);

    const unsafeApply = runRemoteRunner(["apply", baselineName], existing.url);
    assert.notEqual(unsafeApply.status, 0);
    assert.match(commandOutput(unsafeApply), /sólo puede ejecutarse sobre una base vacía/i);

    const adopt = runRemoteRunner(["adopt", baselineName], existing.url);
    assertSucceeded(adopt);
    assert.match(commandOutput(adopt), /adoptada después de validar equivalencia/i);

    const readClient = createClient({ url: existing.url });
    const ledger = await readClient.execute(
      'SELECT name, checksum FROM "_musicbox_migrations"',
    );
    readClient.close();
    assert.equal(ledger.rows.length, 1);
    assert.equal(String(ledger.rows[0]?.name), baselineName);
    assert.equal(String(ledger.rows[0]?.checksum).length, 64);
    const applyExistingRatingMigration = runRemoteRunner(
      ["apply", ratingMigrationName],
      existing.url,
    );
    assertSucceeded(applyExistingRatingMigration);
    const applyExistingCommentMigration = runRemoteRunner(
      ["apply", commentIdempotencyMigrationName],
      existing.url,
    );
    assertSucceeded(applyExistingCommentMigration);
    await assertRepresentativeData(
      existing.url,
      "remote-existing",
      "rating-b-remote-existing",
    );

    const status = runRemoteRunner(["status"], existing.url);
    assertSucceeded(status);
    assert.match(commandOutput(status), new RegExp(`applied\\s+${baselineName}`));
    assert.match(commandOutput(status), new RegExp(`applied\\s+${ratingMigrationName}`));
    assert.match(
      commandOutput(status),
      new RegExp(`applied\\s+${commentIdempotencyMigrationName}`),
    );

    const mismatchClient = createClient({ url: existing.url });
    await mismatchClient.execute(
      'UPDATE "_musicbox_migrations" SET checksum = ? WHERE name = ?',
      ["checksum-incompatible", baselineName],
    );
    mismatchClient.close();

    const mismatchStatus = runRemoteRunner(["status"], existing.url);
    assertSucceeded(mismatchStatus);
    assert.match(commandOutput(mismatchStatus), /CHECKSUM_MISMATCH/);
    const mismatchApply = runRemoteRunner(["apply", baselineName], existing.url);
    assert.notEqual(mismatchApply.status, 0);
    assert.match(commandOutput(mismatchApply), /checksum remoto/i);
  } finally {
    await cleanup(empty.directory);
    await cleanup(existing.directory);
  }
});

test("the remote runner adopts an existing prefix without rerunning migration SQL", async () => {
  const database = await temporaryDatabase("remote-prefix-adoption");
  try {
    const client = createClient({ url: database.url });
    await client.executeMultiple(await readFile(baselinePath, "utf8"));
    client.close();
    await writeRepresentativeData(database.url, "remote-prefix", true);

    const ratingSql = await readFile(
      join(projectRoot, "prisma", "migrations", ratingMigrationName, "migration.sql"),
      "utf8",
    );
    const migratedClient = createClient({ url: database.url });
    await migratedClient.executeMultiple(ratingSql);
    migratedClient.close();

    const adopt = runRemoteRunner(["adopt", ratingMigrationName], database.url);
    assertSucceeded(adopt);

    const ledgerClient = createClient({ url: database.url });
    const ledger = await ledgerClient.execute(
      'SELECT name FROM "_musicbox_migrations" ORDER BY name',
    );
    ledgerClient.close();
    assert.deepEqual(
      ledger.rows.map((row) => String(row.name)),
      [baselineName, ratingMigrationName],
    );
    await assertRepresentativeData(database.url, "remote-prefix", "rating-b-remote-prefix");
  } finally {
    await cleanup(database.directory);
  }
});

test("the remote runner reconciles the known legacy collection indexes without deleting rows", async () => {
  const database = await temporaryDatabase("remote-legacy-indexes");
  const reconciliationName = "20260802183100_legacy_unique_collection_indexes";
  try {
    const client = createClient({ url: database.url });
    await client.executeMultiple(await readFile(baselinePath, "utf8"));
    client.close();
    await writeRepresentativeData(database.url, "legacy-indexes", true);

    const ratingSql = await readFile(
      join(projectRoot, "prisma", "migrations", ratingMigrationName, "migration.sql"),
      "utf8",
    );
    const migratedClient = createClient({ url: database.url });
    await migratedClient.executeMultiple(ratingSql);
    await migratedClient.execute('DROP INDEX "DiaryLog_userId_musicItemId_idx"');
    await migratedClient.execute('DROP INDEX "Review_userId_musicItemId_idx"');
    await migratedClient.execute(
      'CREATE UNIQUE INDEX "DiaryLog_userId_musicItemId_key" ON "DiaryLog"("userId", "musicItemId")',
    );
    await migratedClient.execute(
      'CREATE UNIQUE INDEX "Review_userId_musicItemId_key" ON "Review"("userId", "musicItemId")',
    );
    migratedClient.close();

    assertSucceeded(runRemoteRunner(["adopt", ratingMigrationName], database.url));
    assertSucceeded(runRemoteRunner(["apply", reconciliationName], database.url));

    const verificationClient = createClient({ url: database.url });
    const indexes = await verificationClient.execute(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN " +
        "('DiaryLog_userId_musicItemId_idx', 'Review_userId_musicItemId_idx', " +
        "'DiaryLog_userId_musicItemId_key', 'Review_userId_musicItemId_key') ORDER BY name",
    );
    verificationClient.close();
    assert.deepEqual(
      indexes.rows.map((row) => String(row.name)),
      ["DiaryLog_userId_musicItemId_idx", "Review_userId_musicItemId_idx"],
    );
    await assertRepresentativeData(database.url, "legacy-indexes", "rating-b-legacy-indexes");
  } finally {
    await cleanup(database.directory);
  }
});
