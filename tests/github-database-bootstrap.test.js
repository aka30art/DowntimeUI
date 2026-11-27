import test from "node:test";
import assert from "node:assert/strict";
import { ensureGitHubDatabaseReady, GITHUB_YARDHUB_TABLES, GITHUB_YARDHUB_SOURCE_TABLES, GITHUB_YARDHUB_BROKER_TABLES } from "../src/infrastructure/github-database-bootstrap.js";

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
    setTable(name, value) { tables[name] = structuredClone(value); },
    get commits() { return commits; }
  };
}

test("first GitHub installation seeds all operational tables and immutable DEV bootstrap identity", async () => {
  const store = memoryStore();
  const result = await ensureGitHubDatabaseReady({ store, now: () => new Date("2026-11-27T12:00:00.000Z") });
  assert.equal(result.ready, true);
  assert.equal(result.initialized, true);
  assert.equal(result.tableCount, 41);
  assert.equal(GITHUB_YARDHUB_SOURCE_TABLES.length, 39);
  assert.equal(GITHUB_YARDHUB_BROKER_TABLES.length, 2);
  assert.deepEqual(store.tables.downtime_github_identities, []);
  assert.deepEqual(store.tables.downtime_github_broker_requests, []);
  assert.deepEqual(Object.keys(store.tables).sort(), [...GITHUB_YARDHUB_TABLES].sort());
  assert.equal(store.tables.downtime_central_bank[0].version, 0);
  assert.deepEqual(store.tables.downtime_central_bank[0].payload.users, []);
  assert.equal(store.tables.downtime_roots_bootstrap.length, 1);
  assert.ok(store.tables.downtime_roots_bootstrap[0].user_id);
  assert.match(store.tables.downtime_roots_bootstrap[0].user_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(store.tables.downtime_roots_bootstrap[0].singleton, true);
  assert.match(result.bootstrapCode, /^[A-F0-9]{48}$/);
  assert.notEqual(result.bootstrapCode, "YARDHUB-INITIAL-SETUP");
  assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash.length, 64);
  assert.notEqual(store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash, result.bootstrapCode);
  assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code_expires_at, result.bootstrapCodeExpiresAt);
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

test("bootstrap adds missing singleton records without replacing non-empty tables", async () => {
  const store = memoryStore({
    downtime_shared_state: [{ id: 7, payload: { preserved: true }, version: 4 }],
    downtime_central_bank: [{ id: 7, version: 8, payload: { users: [{ username: "EXISTING" }] } }],
    downtime_central_config_state: [{ id: 7, draft_payload: { preserved: true }, published_payload: {} }],
    yard_hub_tier_config: [{ id: 7, version: 3, payload: { preserved: true } }],
    downtime_reports: [{ id: "report-existing", title: "Keep this report" }]
  });
  await ensureGitHubDatabaseReady({ store });
  assert.equal(store.tables.downtime_shared_state.find(row => row.id === 7).payload.preserved, true);
  assert.ok(store.tables.downtime_shared_state.some(row => row.id === 1));
  assert.ok(store.tables.downtime_central_bank.some(row => row.id === 1));
  assert.equal(store.tables.downtime_central_bank.find(row => row.id === 7).payload.users[0].username, "EXISTING");
  assert.ok(store.tables.downtime_central_config_state.some(row => row.id === 1));
  assert.ok(store.tables.yard_hub_tier_config.some(row => row.id === 1));
  assert.equal(store.tables.downtime_reports[0].title, "Keep this report");
});

test("DEV bootstrap code rotates after a reload and expires after fifteen minutes", async () => {
  const store = memoryStore();
  const first = await ensureGitHubDatabaseReady({ store, generateBootstrapCode: () => "A".repeat(48) });
  delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
  const second = await ensureGitHubDatabaseReady({ store, generateBootstrapCode: () => "B".repeat(48) });
  assert.equal(first.bootstrapCode, "A".repeat(48));
  assert.equal(second.bootstrapCode, "B".repeat(48));
  assert.notEqual(store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash, first.bootstrapCode);
  assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code_expires_at, second.bootstrapCodeExpiresAt);
});

test("DEV bootstrap code is not generated once a DEV account exists", async () => {
  const store = memoryStore();
  await ensureGitHubDatabaseReady({ store, generateBootstrapCode: () => "C".repeat(48) });
  const current = await store.readDatabase();
  await store.transactDatabase({
    expectedRevision: current.revision,
    actorId: "test-installer",
    mutate(tables) {
      tables.downtime_central_bank[0].payload.users = [{
        username: "DEV",
        userId: tables.downtime_roots_bootstrap[0].user_id
      }];
    }
  });
  const result = await ensureGitHubDatabaseReady({ store });
  assert.equal(result.bootstrapCode, null);
  assert.equal(globalThis.__YARDHUB_BOOTSTRAP_CODE__, null);
});
