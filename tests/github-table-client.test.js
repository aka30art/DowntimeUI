import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubTableClient } from "../src/infrastructure/github-table-client.js";

function createMemoryStore(initial = {}) {
  let revision = 0;
  let tables = structuredClone(initial);
  let conflictNext = false;
  return {
    async readDatabase() {
      return { revision, tables: structuredClone(tables), manifest: { revision, tables: {} } };
    },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== revision) {
        const error = new Error("stale revision"); error.status = 409; throw error;
      }
      const draft = structuredClone(tables);
      const result = await mutate(draft);
      if (conflictNext) {
        conflictNext = false;
        const error = new Error("simulated concurrent write"); error.status = 409; throw error;
      }
      tables = draft;
      revision += 1;
      return { committed: true, revision, result };
    },
    forceConflict() { conflictNext = true; }
  };
}

test("GitHub table client selects, filters, orders, projects and paginates rows", async () => {
  const store = createMemoryStore({
    gatelog_customers: [
      { id: "c1", customer_name: "Zulu", status: "ACTIVE" },
      { id: "c2", customer_name: "Alpha", status: "ACTIVE" },
      { id: "c3", customer_name: "Beta", status: "ARCHIVED" }
    ]
  });
  const client = createGitHubTableClient({ store });
  const result = await client.from("gatelog_customers")
    .select("id,customer_name")
    .eq("status", "ACTIVE")
    .order("customer_name", { ascending: true })
    .limit(1);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: "c2", customer_name: "Alpha" }]);
  assert.equal(result.count, 2);
});

test("insert and upsert return projected rows and honour configured conflict keys", async () => {
  const store = createMemoryStore();
  const client = createGitHubTableClient({ store, now: () => new Date("2026-11-27T12:00:00.000Z") });
  const inserted = await client.from("gatelog_customers")
    .insert({ id: "customer-1", customer_name: "Example" })
    .select("id,customer_name")
    .single();
  assert.equal(inserted.error, null);
  assert.deepEqual(inserted.data, { id: "customer-1", customer_name: "Example" });

  const upserted = await client.from("gatelog_customers")
    .upsert({ id: "customer-1", customer_name: "Updated" })
    .select()
    .single();
  assert.equal(upserted.error, null);
  assert.equal(upserted.data.customer_name, "Updated");
  const rows = await client.from("gatelog_customers").select("*");
  assert.equal(rows.data.length, 1);
});

test("update and delete mutate only rows matching filters", async () => {
  const store = createMemoryStore({
    gatelog_customers: [
      { id: "c1", customer_name: "One", status: "ACTIVE" },
      { id: "c2", customer_name: "Two", status: "ACTIVE" }
    ]
  });
  const client = createGitHubTableClient({ store });
  const updated = await client.from("gatelog_customers")
    .update({ status: "ARCHIVED" })
    .eq("id", "c1")
    .select()
    .single();
  assert.equal(updated.error, null);
  assert.equal(updated.data.status, "ARCHIVED");

  const deleted = await client.from("gatelog_customers")
    .delete()
    .eq("id", "c2")
    .select()
    .single();
  assert.equal(deleted.error, null);
  assert.equal(deleted.data.id, "c2");

  const remaining = await client.from("gatelog_customers").select("*");
  assert.deepEqual(remaining.data.map(row => row.id), ["c1"]);
});

test("single and maybeSingle preserve PostgREST-style cardinality errors", async () => {
  const store = createMemoryStore({ downtime_reports: [{ id: "r1" }, { id: "r2" }] });
  const client = createGitHubTableClient({ store });
  const single = await client.from("downtime_reports").select("*").single();
  assert.equal(single.error.code, "PGRST116");
  const maybe = await client.from("downtime_reports").select("*").eq("id", "missing").maybeSingle();
  assert.equal(maybe.error, null);
  assert.equal(maybe.data, null);
});

test("duplicate inserts return a deterministic unique constraint error", async () => {
  const store = createMemoryStore({ gatelog_customers: [{ id: "c1", customer_name: "Existing" }] });
  const client = createGitHubTableClient({ store });
  const result = await client.from("gatelog_customers").insert({ id: "c1", customer_name: "Duplicate" });
  assert.equal(result.error.code, "23505");
  assert.equal(result.status, 409);
});

test("optimistic transaction conflict retries from the newest database revision", async () => {
  const store = createMemoryStore();
  store.forceConflict();
  const client = createGitHubTableClient({ store, maxConflictRetries: 2 });
  const result = await client.from("gatelog_customers").insert({ id: "c1", customer_name: "Retry" }).select().single();
  assert.equal(result.error, null);
  assert.equal(result.data.customer_name, "Retry");
  assert.equal((await client.from("gatelog_customers").select("*")).data.length, 1);
});

test("unknown table names are rejected before GitHub writes", async () => {
  const client = createGitHubTableClient({ store: createMemoryStore() });
  assert.throws(() => client.from("../control/authority"), /table name/);
});
