import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubSupabaseCompat } from "../src/infrastructure/github-supabase-compat.js";

function mockStore() {
  const tables = {
    downtime_shared_state: [{ id: 1, payload: { value: 1 } }],
    downtime_central_bank: [{ id: 1, version: 1, updated_at: "2026-11-27T10:00:00.000Z" }]
  };
  return {
    async readTable(name) { return structuredClone(tables[name] || []); },
    async readDatabase() { return { revision: 0, tables: structuredClone(tables) }; },
    async transactDatabase() { throw new Error("not used"); },
    async uploadObject() { return {}; },
    async downloadObject() { return { bytes: new Uint8Array(), mimeType: "application/octet-stream" }; },
    async deleteObject() { return { deleted: true }; },
    setTable(value, name = "downtime_shared_state") { tables[name] = structuredClone(value); }
  };
}

test("GitHub compatibility channel polls shared state and notifies postgres-change subscribers", async () => {
  const store = mockStore();
  const client = createGitHubSupabaseCompat({ store, pollIntervalMs: 50 });
  let updates = 0;
  let latest = null;
  const channel = client.channel("shared-state")
    .on("postgres_changes", { event: "*", schema: "public", table: "downtime_shared_state" }, payload => {
      updates += 1;
      latest = payload.new;
    })
    .subscribe();
  await new Promise(resolve => setTimeout(resolve, 25));
  store.setTable([{ id: 1, payload: { value: 2 } }]);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(updates, 1);
  assert.equal(latest[0].payload.value, 2);
  await channel.unsubscribe();
});


test("GitHub compatibility channel translates Central Bank version changes into broadcast events", async () => {
  const store = mockStore();
  const client = createGitHubSupabaseCompat({ store, pollIntervalMs: 50 });
  let message = null;
  const channel = client.channel("downtime-central-state", { config: { private: true } })
    .on("broadcast", { event: "central_state_changed" }, payload => { message = payload; })
    .subscribe();
  await new Promise(resolve => setTimeout(resolve, 25));
  store.setTable([
    { id: 1, version: 2, updated_at: "2026-11-27T10:01:00.000Z" }
  ], "downtime_central_bank");
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(message?.event, "central_state_changed");
  assert.equal(message?.payload?.version, 2);
  assert.equal(message?.payload?.updated_at, "2026-11-27T10:01:00.000Z");
  await channel.unsubscribe();
});

test("disposing the GitHub compatibility client closes every polling channel", async () => {
  const store = mockStore();
  const client = createGitHubSupabaseCompat({ store, pollIntervalMs: 50 });
  const channel = client.channel("shared-state")
    .on("postgres_changes", { event: "*", schema: "public", table: "downtime_shared_state" }, () => {})
    .subscribe();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await client.dispose(), true);
  assert.equal(await channel.unsubscribe(), "ok");
});
