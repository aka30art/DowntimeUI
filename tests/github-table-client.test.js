import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubTableClient } from "../src/infrastructure/github-table-client.js";

function createMemoryStore(initial = {}) {
  let revision = 0;
  let tables = structuredClone(initial);
  let conflictNext = false;
  let commits = 0;
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
      commits += 1;
      return { committed: true, revision, result };
    },
    forceConflict() { conflictNext = true; },
    getCommits() { return commits; }
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
    .select("id,customer_name", { count: "exact" })
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

test("select count/head, filter and match helpers preserve PostgREST request semantics", async () => {
  const store = createMemoryStore({
    downtime_central_audit: [
      { id: 1, username: "dev", action: "login" },
      { id: 2, username: "admin", action: "login-failed" },
      { id: 3, username: "dev", action: "bootstrap" }
    ]
  });
  const client = createGitHubTableClient({ store });
  const count = await client.from("downtime_central_audit")
    .select("id", { count: "exact", head: true })
    .filter("action", "like", "login%");
  assert.equal(count.data, null);
  assert.equal(count.count, 2);

  const matched = await client.from("downtime_central_audit")
    .select("*")
    .match({ username: "dev", action: "bootstrap" })
    .maybeSingle();
  assert.equal(matched.data.id, 3);
});

test("update returns changed rows even when an updated column no longer matches the filter", async () => {
  const store = createMemoryStore({ gatelog_customers: [{ id: "c1", status: "ACTIVE" }] });
  const client = createGitHubTableClient({ store });
  const result = await client.from("gatelog_customers")
    .update({ status: "ARCHIVED" })
    .eq("status", "ACTIVE")
    .select("*")
    .single();
  assert.equal(result.error, null);
  assert.equal(result.data.status, "ARCHIVED");
});

test("multiple GitHub table actions inside one transaction produce one atomic commit", async () => {
  const store = createMemoryStore();
  const client = createGitHubTableClient({ store });
  const transaction = await client.transaction(async tx => {
    const user = await tx.from("downtime_central_bank")
      .insert({ id: 1, payload: { users: [] }, version: 1 })
      .select("*")
      .single();
    const customer = await tx.from("gatelog_customers")
      .insert({ id: "c-1", customer_name: "Example Customer" })
      .select("*")
      .single();
    return { user: user.data, customer: customer.data };
  }, { operationId: "op-atomic-2001" });

  assert.equal(transaction.committed, true);
  assert.equal(transaction.revision, 1);
  assert.equal(store.getCommits(), 1);
  assert.equal(transaction.result.customer.customer_name, "Example Customer");
  assert.equal((await store.readDatabase()).tables.downtime_central_bank.length, 1);
});

test("failed GitHub table transaction does not commit staged writes", async () => {
  const store = createMemoryStore();
  const client = createGitHubTableClient({ store });
  await assert.rejects(client.transaction(async tx => {
    await tx.from("gatelog_customers").insert({ id: "c-fail", customer_name: "Rejected" });
    throw new Error("Action rejected");
  }), /Action rejected/);
  assert.equal(store.getCommits(), 0);
  assert.deepEqual((await store.readDatabase()).tables, {});
});

test("registered atomic RPC handlers update multiple JSON tables in one commit", async () => {
  const store = createMemoryStore();
  const client = createGitHubTableClient({
    store,
    rpcHandlers: {
      gatelog_create_arrival({ tables, args, now }) {
        tables.gatelog_visits ||= [];
        const row = { id: args.p_visit_id, customer_id: args.p_customer_id, status: "ACTIVE", created_at: now().toISOString() };
        tables.gatelog_visits.push(row);
        tables.gatelog_audit ||= [];
        tables.gatelog_audit.push({ id: "audit-1", action: "arrival" });
        return row;
      }
    }
  });
  const result = await client.rpc("gatelog_create_arrival", { p_visit_id: "v-1", p_customer_id: "c-1" });
  assert.equal(result.error, null);
  assert.equal(result.data.id, "v-1");
  assert.equal(store.getCommits(), 1);
  const db = await store.readDatabase();
  assert.equal(db.tables.gatelog_visits.length, 1);
  assert.equal(db.tables.gatelog_audit.length, 1);
});

test("nested GATELOG relation projections resolve customer and waste labels", async () => {
  const store = createMemoryStore({
    gatelog_customers: [{ id: "c1", customer_name: "Example Customer" }],
    gatelog_visits: [{ id: "v1", customer_id: "c1", vehicle_registration_snapshot: "AB12 CDE" }],
    gatelog_visit_waste_types: [
      { visit_id: "v1", waste_type_id: "w1" },
      { visit_id: "v1", waste_type_id: "w2" }
    ],
    gatelog_waste_types: [
      { id: "w1", label: "GENERAL" },
      { id: "w2", label: "WOOD" }
    ]
  });
  const client = createGitHubTableClient({ store });
  const result = await client.from("gatelog_visits")
    .select("id,vehicle_registration_snapshot,gatelog_customers(customer_name),gatelog_visit_waste_types(gatelog_waste_types(label))")
    .eq("id", "v1")
    .single();
  assert.equal(result.error, null);
  assert.equal(result.data.gatelog_customers.customer_name, "Example Customer");
  assert.deepEqual(result.data.gatelog_visit_waste_types.map(x => x.gatelog_waste_types.label), ["GENERAL", "WOOD"]);
});

test("first DEV bootstrap update binds the immutable ROOTS identity and seeds protected ROOTED definitions", async () => {
  const store = createMemoryStore({
    downtime_central_bank: [{ id: 1, version: 0, payload: { users: [] } }],
    downtime_roots_bootstrap: [{ singleton: true, user_id: "immutable-dev-user" }],
    downtime_roots_role_definitions: []
  });
  const client = createGitHubTableClient({ store });
  const result = await client.from("downtime_central_bank")
    .update({ version: 1, payload: { users: [{ username: "DEV", enabled: true }] } })
    .eq("id", 1)
    .select()
    .single();
  assert.equal(result.error, null);
  assert.equal(result.data.payload.users[0].userId, "immutable-dev-user");
  const snapshot = await store.readDatabase();
  assert.deepEqual(snapshot.tables.downtime_roots_role_definitions.map(x => x.role_key).sort(), ["ADMIN", "DEV1"]);
  assert.equal(snapshot.tables.downtime_roots_role_definitions.every(x => x.created_by_user_id === "immutable-dev-user"), true);
});

test("DEV bootstrap update is rejected when the immutable ROOTS bootstrap row is missing", async () => {
  const store = createMemoryStore({
    downtime_central_bank: [{ id: 1, version: 0, payload: { users: [] } }],
    downtime_roots_role_definitions: []
  });
  const client = createGitHubTableClient({ store });
  const result = await client.from("downtime_central_bank")
    .update({ version: 1, payload: { users: [{ username: "DEV", enabled: true }] } })
    .eq("id", 1);
  assert.equal(result.error.code, "ROOTS_BOOTSTRAP_MISSING");
  assert.equal((await store.readDatabase()).tables.downtime_central_bank[0].version, 0);
});
