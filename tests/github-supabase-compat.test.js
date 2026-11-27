import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubSupabaseCompat } from "../src/infrastructure/github-supabase-compat.js";

function mockStore() {
  let table = [{ id: 1, payload: { value: 1 } }];
  return {
    async readTable() { return structuredClone(table); },
    async readDatabase() { return { revision: 0, tables: { downtime_shared_state: structuredClone(table) } }; },
    async transactDatabase() { throw new Error("not used"); },
    async uploadObject() { return {}; },
    async downloadObject() { return { bytes: new Uint8Array(), mimeType: "application/octet-stream" }; },
    async deleteObject() { return { deleted: true }; },
    setTable(value) { table = structuredClone(value); }
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
