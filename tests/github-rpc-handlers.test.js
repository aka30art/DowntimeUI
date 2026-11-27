import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubTableClient } from "../src/infrastructure/github-table-client.js";
import { GITHUB_YARDHUB_RPC_HANDLERS } from "../src/infrastructure/github-rpc-handlers.js";

function memoryStore(initial = {}) {
  let revision = 0;
  let tables = structuredClone(initial);
  let commits = 0;
  return {
    async readDatabase() { return { revision, tables: structuredClone(tables), manifest: { revision } }; },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== revision) { const error = new Error("VERSION_CONFLICT"); error.status = 409; throw error; }
      const draft = structuredClone(tables);
      const result = await mutate(draft);
      tables = draft; revision += 1; commits += 1;
      return { committed: true, revision, result, commitSha: "commit-" + commits };
    },
    getCommits() { return commits; }
  };
}

const fixedNow = () => new Date("2026-11-27T10:30:00.000Z");

test("GATELOG arrival creates customer vehicle visit waste links and audit atomically", async () => {
  const store = memoryStore({ gatelog_customers: [{ id: "customer-1", customer_name: "Example", active: true }] });
  const db = createGitHubTableClient({ store, rpcHandlers: GITHUB_YARDHUB_RPC_HANDLERS, now: fixedNow });
  const result = await db.rpc("gatelog_create_arrival", {
    p_customer_id: "customer-1", p_registration: "ab12 cde",
    p_waste_types: ["GENERAL", "WOOD"], p_actor: "Jan"
  });
  assert.equal(result.error, null);
  assert.ok(result.data);
  const snapshot = await store.readDatabase();
  assert.equal(snapshot.tables.gatelog_vehicles.length, 1);
  assert.equal(snapshot.tables.gatelog_visits.length, 1);
  assert.equal(snapshot.tables.gatelog_visit_waste_types.length, 2);
  assert.equal(snapshot.tables.gatelog_audit[0].action, "ARRIVAL");
  assert.equal(snapshot.tables.gatelog_visits[0].vehicle_registration_snapshot, "AB12 CDE");
  assert.equal(store.getCommits(), 1);
});

test("GATELOG customer arrival creates/reuses customer and returns the API row shape", async () => {
  const store = memoryStore();
  const db = createGitHubTableClient({ store, rpcHandlers: GITHUB_YARDHUB_RPC_HANDLERS, now: fixedNow });
  const result = await db.rpc("gatelog_create_customer_arrival", {
    p_customer_name: "Example Ltd", p_registration: "XY99 ZZZ",
    p_waste_types: ["SCRAP"], p_actor: "Mick"
  });
  assert.equal(result.error, null);
  assert.equal(result.data[0].customer_name, "Example Ltd");
  assert.ok(result.data[0].customer_id);
  assert.ok(result.data[0].visit_id);
  assert.equal((await store.readDatabase()).tables.gatelog_customers.length, 1);
});

test("GATELOG departure, visit correction and deletion preserve audit history", async () => {
  const store = memoryStore({
    gatelog_customers: [{ id: "c1", customer_name: "Customer", active: true }],
    gatelog_visits: [{
      id: "v1", customer_id: "c1", vehicle_registration_snapshot: "AB12 CDE",
      visit_date: "2026-11-27", time_in: "2026-11-27T08:00:00.000Z",
      time_out: null, status: "ON_SITE", created_by: "Jan"
    }],
    gatelog_waste_types: [{ id: "w1", label: "GENERAL", active: true }],
    gatelog_visit_waste_types: [{ visit_id: "v1", waste_type_id: "w1" }]
  });
  const db = createGitHubTableClient({ store, rpcHandlers: GITHUB_YARDHUB_RPC_HANDLERS, now: fixedNow });
  const departed = await db.rpc("gatelog_register_departure", { p_visit_id: "v1", p_actor: "Jan" });
  assert.equal(departed.error, null);
  assert.equal(departed.data[0].status, "DEPARTED");

  const updated = await db.rpc("gatelog_update_visit", {
    p_visit_id: "v1", p_customer_id: "c1", p_registration: "CD34 EFG",
    p_visit_date: "2026-11-27", p_time_in: "2026-11-27T08:30:00.000Z",
    p_time_out: null, p_waste_types: ["WOOD"], p_actor: "Admin"
  });
  assert.equal(updated.error, null);
  assert.equal(updated.data, "v1");
  const beforeDelete = await store.readDatabase();
  assert.equal(beforeDelete.tables.gatelog_visits[0].status, "ON_SITE");
  assert.equal(beforeDelete.tables.gatelog_visits[0].vehicle_registration_snapshot, "CD34 EFG");
  assert.equal(beforeDelete.tables.gatelog_audit.some(x => x.action === "VISIT_UPDATED"), true);

  const deleted = await db.rpc("gatelog_delete_visit", { p_visit_id: "v1", p_actor: "Admin" });
  assert.equal(deleted.error, null);
  assert.equal(deleted.data, "v1");
  const final = await store.readDatabase();
  assert.equal(final.tables.gatelog_visits.length, 0);
  assert.equal(final.tables.gatelog_audit.some(x => x.action === "VISIT_DELETED"), true);
});

test("GATELOG statistics return daily, weekly, monthly and all-time summaries", async () => {
  const store = memoryStore({
    gatelog_visits: [
      { id: "v1", customer_id: "c1", visit_date: "2026-11-27", time_in: "2026-11-27T08:00:00.000Z", time_out: "2026-11-27T09:00:00.000Z", status: "DEPARTED" },
      { id: "v2", customer_id: "c1", visit_date: "2026-11-26", time_in: "2026-11-26T08:00:00.000Z", time_out: null, status: "ON_SITE" }
    ],
    gatelog_waste_types: [{ id: "w1", label: "GENERAL" }],
    gatelog_visit_waste_types: [{ visit_id: "v1", waste_type_id: "w1" }, { visit_id: "v2", waste_type_id: "w1" }]
  });
  const db = createGitHubTableClient({ store, rpcHandlers: GITHUB_YARDHUB_RPC_HANDLERS, now: fixedNow });
  const overall = await db.rpc("gatelog_overall_statistics");
  assert.equal(overall.error, null);
  assert.equal(overall.data[0].total_visits, 2);
  assert.equal(overall.data[0].average_minutes, 60);
  const periods = await db.rpc("gatelog_period_statistics", { p_today: "2026-11-27" });
  assert.equal(periods.error, null);
  assert.deepEqual(periods.data.map(x => x.period_key), ["daily", "weekly", "monthly", "all_time"]);
  assert.equal(periods.data[0].total_visits, 1);
  assert.equal(periods.data[3].total_visits, 2);
});

test("Central Bank writes enforce optimistic versions and append audit records", async () => {
  const store = memoryStore({
    downtime_central_bank: [{ id: 1, version: 4, payload: { users: [] }, updated_at: "2026-11-27T09:00:00.000Z" }]
  });
  const db = createGitHubTableClient({ store, rpcHandlers: GITHUB_YARDHUB_RPC_HANDLERS, now: fixedNow });
  const committed = await db.rpc("downtime_central_commit_identity_event", {
    p_expected_version: 4, p_payload: { users: [{ id: "u1" }] },
    p_actor_username: "DEV", p_action: "USER_STAFF_PROVISIONING_STARTED",
    p_details: { userId: "u1" }
  });
  assert.equal(committed.error, null);
  assert.equal(committed.data.version, 5);
  const conflict = await db.rpc("downtime_central_commit_identity_event", {
    p_expected_version: 4, p_payload: { users: [] },
    p_actor_username: "DEV", p_action: "USER_STAFF_PROVISIONING_ACTIVATED",
    p_details: {}
  });
  assert.equal(conflict.error.status, 409);
  const snapshot = await store.readDatabase();
  assert.equal(snapshot.tables.downtime_central_bank[0].version, 5);
  assert.equal(snapshot.tables.downtime_central_audit.length, 1);
});

test("Central Bank settings save includes staff audit events in one commit", async () => {
  const store = memoryStore({
    downtime_central_bank: [{ id: 1, version: 2, payload: { staff: [] } }]
  });
  const db = createGitHubTableClient({ store, rpcHandlers: GITHUB_YARDHUB_RPC_HANDLERS, now: fixedNow });
  const result = await db.rpc("downtime_commit_central_bank", {
    p_expected_version: 2, p_payload: { staff: [{ id: "s1" }] }, p_username: "DEV",
    p_audit_details: { staff: true },
    p_staff_audit_events: [{ action: "staff-created", details: { staffId: "s1" } }]
  });
  assert.equal(result.error, null);
  assert.equal(result.data.version, 3);
  const snapshot = await store.readDatabase();
  assert.deepEqual(snapshot.tables.downtime_central_audit.map(x => x.action), ["save-settings", "staff-created"]);
  assert.equal(store.getCommits(), 1);
});

test("YARD HUB tier settings save checks versions and writes access audit", async () => {
  const store = memoryStore({
    yard_hub_tier_config: [{ id: 1, version: 1, payload: { tiers: [] } }]
  });
  const db = createGitHubTableClient({ store, rpcHandlers: GITHUB_YARDHUB_RPC_HANDLERS, now: fixedNow });
  const result = await db.rpc("yard_hub_save_tier_settings", {
    p_expected_version: 1, p_next_payload: { tiers: ["ADMIN"] }, p_actor: "DEV"
  });
  assert.equal(result.error, null);
  assert.equal(result.data, 2);
  const snapshot = await store.readDatabase();
  assert.equal(snapshot.tables.yard_hub_access_audit.length, 1);
  assert.equal(snapshot.tables.yard_hub_tier_config[0].version, 2);
});
