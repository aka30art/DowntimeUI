import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubSupabaseCompat } from "../src/infrastructure/github-supabase-compat.js";

test("GitHub compatibility channels do not start realtime polling", async () => {
  let reads = 0;
  const store = {
    async readDatabase() { reads += 1; return { revision: 0, tables: {}, manifest: { revision: 0 } }; },
    async readTable() { reads += 1; return []; },
    async transactDatabase() { throw new Error("not used"); }
  };
  const client = createGitHubSupabaseCompat({ store, storageClient: { from() { return {}; } } });
  let status = null;
  const channel = client.channel("yardhub-central")
    .on("broadcast", { event: "central_state_changed" }, () => {})
    .subscribe(value => { status = value; });
  assert.equal(status, "SUBSCRIBED");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(reads, 0, "no background GitHub API reads are permitted");
  await channel.unsubscribe();
  await client.dispose();
});

test("manual reads observe the latest central revision without a subscription", async () => {
  let revision = 1;
  const store = {
    async readDatabase() { return { revision, tables: {}, manifest: { revision } }; },
    async readTable() { return []; },
    async transactDatabase() { throw new Error("not used"); }
  };
  const client = createGitHubSupabaseCompat({ store, storageClient: { from() { return {}; } } });
  assert.equal((await store.readDatabase()).revision, 1);
  revision = 2;
  assert.equal((await store.readDatabase()).revision, 2);
  await client.dispose();
});
