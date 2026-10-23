import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const tsxCli = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const groups = [
  ["test/backend-integration.test.ts"],
  ["test/architecture-refactor.test.ts"],
  ["test/auth-me-contract.test.ts"],
  ["test/auth-route-handlers.test.ts", "test/revocable-sessions.test.ts"],
  ["test/deezer-http.test.ts", "test/deezer-routes.test.ts"],
  ["test/diary-events.test.ts"],
  ["test/listen-later-authorization.test.ts"],
  ["test/playlist-import.test.ts"],
  ["test/rating-integrity.test.ts"],
  ["test/user-derived-cache.test.ts"],
  ["test/social-actions.test.ts"],
  ["test/security-hardening.test.ts"],
];

for (const files of groups) {
  const result = spawnSync(process.execPath, [tsxCli, "--test", ...files], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
