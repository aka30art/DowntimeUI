import test from "node:test";
import assert from "node:assert/strict";
import { ensureGitHubDatabaseReady, GITHUB_YARDHUB_TABLES } from "../src/infrastructure/github-database-bootstrap.js";

function memoryStore(initial = {}) {
  let revision = 0;
  let tables = structuredClone(initial);
  let commits = 0;
  return {
    async readDatabase() { return { revision, tables: structuredClone(tables), manifest: { revision } }; },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== revision) { const error = new Error("stale"); error.status = 409; throw error; }
      const draft = structuredClone(tables);
      const result = await mutate(draft);
      tables = draft; revision += 1; commits += 1;
      return { committed: true, revision, result };
    },
    get tables() { return structuredClone(tables); },
    get commits() { return commits; }
  };
}

test("first GitHub installation seeds all operational tables and immutable DEV bootstrap identity", async () => {
  const store = memoryStore();
  const result = await ensureGitHubDatabaseReady({ store, now: () => new Date("2026-11-27T12:00:00.000Z") });
  assert.equal(result.ready, true);
  assert.equal(result.initialized, true);
  assert.equal(result.tableCount, 39);
  assert.deepEqual(Object.keys(store.tables).sort(), [...GITHUB_YARDHUB_TABLES].sort());
  assert.equal(store.tables.downtime_central_bank[0].version, 0);
  assert.deepEqual(store.tables.downtime_central_bank[0].payload.users, []);
  assert.equal(store.tables.downtime_roots_bootstrap.length, 1);
  assert.ok(store.tables.downtime_roots_bootstrap[0].user_id);
  assert.equal(store.tables.downtime_roots_bootstrap[0].singleton, true);
  assert.equal(store.tables.yard_hub_tier_config[0].version, 0);
  assert.equal(store.commits, 1);
});

test("database bootstrap is idempotent and does not overwrite existing operational data", async () => {
  const store = memoryStore();
  await ensureGitHubDatabaseReady({ store });
  const originalUserId = store.tables.downtime_roots_bootstrap[0].user_id;
  await store.transactDatabase({
    expectedRevision: 1,
    actorId: "test-operator",
    mutate(tables) { tables.downtime_reports = [{ id: "report-1", title: "Preserve me" }]; }
  });
  const second = await ensureGitHubDatabaseReady({ store });
  assert.equal(second.initialized, false);
  assert.equal(store.tables.downtime_reports[0].title, "Preserve me");
  assert.equal(store.tables.downtime_roots_bootstrap[0].user_id, originalUserId);
  assert.equal(store.commits, 2);
});

test("existing bootstrap identity is retained when filling missing schema tables", async () => {
  const store = memoryStore({
    downtime_roots_bootstrap: [{ singleton: true, user_id: "existing-dev-id" }]
  });
  await ensureGitHubDatabaseReady({ store });
  assert.equal(store.tables.downtime_roots_bootstrap[0].user_id, "existing-dev-id");
  assert.equal(store.tables.downtime_central_bank.length, 1);
});
