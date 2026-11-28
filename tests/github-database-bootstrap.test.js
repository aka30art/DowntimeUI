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
    setTable(name, value) { tables[name] = structuredClone(value); },
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
  assert.match(store.tables.downtime_roots_bootstrap[0].user_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(store.tables.downtime_roots_bootstrap[0].singleton, true);
  assert.match(result.bootstrapCode, /^[A-F0-9]{48}$/);
  assert.notEqual(result.bootstrapCode, "YARDHUB-INITIAL-SETUP");
  assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash.length, 64);
  assert.notEqual(store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash, result.bootstrapCode);
  assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code, result.bootstrapCode);
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

test("all browser profiles reuse the same unexpired DEV bootstrap code without another commit", async () => {
  const store = memoryStore();
  const previousCode = globalThis.__YARDHUB_BOOTSTRAP_CODE__;
  try {
    delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    const first = await ensureGitHubDatabaseReady({ store, generateBootstrapCode: () => "A".repeat(48) });
    const firstHash = store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash;
    const firstExpiry = store.tables.downtime_roots_bootstrap[0].bootstrap_code_expires_at;
    delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;

    let generationCount = 0;
    const second = await ensureGitHubDatabaseReady({
      store,
      generateBootstrapCode() {
        generationCount += 1;
        return "B".repeat(48);
      }
    });

    assert.equal(first.bootstrapCode, "A".repeat(48));
    assert.equal(second.bootstrapCode, first.bootstrapCode, "a second browser must receive the same active one-time code");
    assert.equal(second.initialized, false);
    assert.equal(store.commits, 1, "opening another browser must not create another repository commit");
    assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code, first.bootstrapCode);
    assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash, firstHash);
    assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code_expires_at, firstExpiry);
    assert.equal(generationCount, 0, "an active code must not be regenerated before expiry");
    assert.equal(globalThis.__YARDHUB_BOOTSTRAP_CODE__, first.bootstrapCode);
  } finally {
    if (previousCode === undefined) delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    else globalThis.__YARDHUB_BOOTSTRAP_CODE__ = previousCode;
  }
});

test("expired DEV bootstrap code is rotated after fifteen minutes", async () => {
  const store = memoryStore();
  const previousCode = globalThis.__YARDHUB_BOOTSTRAP_CODE__;
  try {
    let clock = new Date("2026-11-27T12:00:00.000Z");
    delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    const first = await ensureGitHubDatabaseReady({
      store,
      now: () => new Date(clock),
      generateBootstrapCode: () => "A".repeat(48)
    });
    const firstHash = store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash;
    delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    clock = new Date("2026-11-27T12:16:00.000Z");

    const second = await ensureGitHubDatabaseReady({
      store,
      now: () => new Date(clock),
      generateBootstrapCode: () => "B".repeat(48)
    });

    assert.equal(first.bootstrapCode, "A".repeat(48));
    assert.equal(second.bootstrapCode, "B".repeat(48));
    assert.notEqual(store.tables.downtime_roots_bootstrap[0].bootstrap_code_hash, firstHash);
    assert.equal(store.tables.downtime_roots_bootstrap[0].bootstrap_code_expires_at, second.bootstrapCodeExpiresAt);
    assert.equal(store.commits, 2);
  } finally {
    if (previousCode === undefined) delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    else globalThis.__YARDHUB_BOOTSTRAP_CODE__ = previousCode;
  }
});

test("database bootstrap re-reads and accepts a concurrent browser's first successful initialisation", async () => {
  const store = memoryStore();
  const previousCode = globalThis.__YARDHUB_BOOTSTRAP_CODE__;
  try {
    delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    let injectedRace = false;
    const competingStore = {
      readDatabase: () => store.readDatabase(),
      async transactDatabase(input) {
        if (!injectedRace) {
          injectedRace = true;
          const competingResult = await ensureGitHubDatabaseReady({
            store,
            generateBootstrapCode: () => "C".repeat(48)
          });
          assert.equal(competingResult.bootstrapCode, "C".repeat(48));
          const error = new Error("another browser advanced the branch");
          error.status = 409;
          throw error;
        }
        return store.transactDatabase(input);
      }
    };

    const result = await ensureGitHubDatabaseReady({
      store: competingStore,
      generateBootstrapCode: () => "D".repeat(48)
    });

    assert.equal(injectedRace, true);
    assert.equal(result.ready, true);
    assert.equal(result.initialized, false, "the competing browser already completed bootstrap");
    assert.equal(result.bootstrapCode, "C".repeat(48));
    assert.equal(store.commits, 1, "the losing browser must not create a second bootstrap commit");
    assert.equal(Object.keys(store.tables).length, 39);
  } finally {
    if (previousCode === undefined) delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    else globalThis.__YARDHUB_BOOTSTRAP_CODE__ = previousCode;
  }
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
