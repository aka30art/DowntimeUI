import test from "node:test";
import assert from "node:assert/strict";
import { GITHUB_YARDHUB_TABLES, GITHUB_YARDHUB_SOURCE_TABLES, GITHUB_YARDHUB_BROKER_TABLES } from "../src/infrastructure/github-database-bootstrap.js";
import { YARDHUB_TABLES, YARDHUB_STORAGE_BUCKETS } from "../scripts/yardhub-backup-to-github.mjs";
import { GITHUB_YARDHUB_RPC_HANDLERS } from "../src/infrastructure/github-rpc-handlers.js";

const expectedTables = [
  "downtime_shared_state", "downtime_reports", "downtime_attachments",
  "downtime_central_bank", "downtime_central_sessions", "downtime_central_audit",
  "downtime_central_config_state", "downtime_central_config_history",
  "repair_maintenance_faults", "repair_maintenance_notes", "repair_maintenance_attachments",
  "repair_maintenance_audit", "yard_hub_tier_config", "yard_hub_access_audit",
  "repair_maintenance_machine_presets", "repair_maintenance_pdf_exports",
  "repair_maintenance_assets", "repair_maintenance_machine_settings",
  "repair_maintenance_machine_models", "downtime_daily_operator_assignments",
  "downtime_daily_operator_audit", "gatelog_customers", "gatelog_vehicles",
  "gatelog_visits", "gatelog_waste_types", "gatelog_visit_waste_types",
  "gatelog_audit", "gatelog_daily_gateman_assignments", "gatelog_report_archive",
  "yard_roles", "yard_role_department_permissions", "yard_role_assignments",
  "yard_role_assignment_audit", "downtime_roots_assignments",
  "downtime_roots_assignment_audit", "yard_role_definition_audit",
  "downtime_roots_bootstrap", "downtime_identity_reset_runs",
  "downtime_roots_role_definitions"
].sort();

const expectedBuckets = [
  "downtime-evidence",
  "downtime-pdfs",
  "downtime-staff-photos",
  "repair-maintenance-evidence",
  "repair-maintenance-reports"
].sort();

const expectedRpcHandlers = [
  "downtime_get_bootstrap_code",
  "downtime_central_commit_identity_event",
  "downtime_commit_central_bank",
  "yard_hub_save_tier_settings",
  "gatelog_create_arrival",
  "gatelog_create_customer_arrival",
  "gatelog_register_departure",
  "gatelog_assign_gateman",
  "gatelog_lock_gateman",
  "gatelog_customer_visit_stats",
  "gatelog_overall_statistics",
  "gatelog_period_statistics",
  "gatelog_update_visit",
  "gatelog_delete_visit",
  "downtime_roots_manage_identity",
  "yard_role_save_definition",
  "yard_role_assign_user",
  "yard_role_reassign_user",
  "downtime_identity_reset_preserve_dev"
].sort();

test("GitHub database preserves the 39-table source inventory and isolates two broker tables", () => {
  const expectedBrokerTables = [
    "downtime_github_broker_requests",
    "downtime_github_identities",
    "downtime_github_broker_identity_audit"
  ].sort();
  assert.equal(new Set(GITHUB_YARDHUB_TABLES).size, GITHUB_YARDHUB_TABLES.length, "database table names must not be duplicated");
  assert.equal(new Set(YARDHUB_TABLES).size, YARDHUB_TABLES.length, "backup table names must not be duplicated");
  assert.deepEqual([...GITHUB_YARDHUB_SOURCE_TABLES].sort(), expectedTables);
  assert.deepEqual([...YARDHUB_TABLES].sort(), expectedTables, "primary backup must contain only source YARDHUB tables");
  assert.deepEqual([...GITHUB_YARDHUB_BROKER_TABLES].sort(), expectedBrokerTables);
  assert.deepEqual([...GITHUB_YARDHUB_TABLES].sort(), [...expectedTables, ...expectedBrokerTables].sort());
});

test("primary backup covers all five private YARDHUB storage buckets", () => {
  assert.equal(new Set(YARDHUB_STORAGE_BUCKETS).size, YARDHUB_STORAGE_BUCKETS.length);
  assert.deepEqual([...YARDHUB_STORAGE_BUCKETS].sort(), expectedBuckets);
});

test("GitHub runtime implements every RPC name called by the seven source services", () => {
  const names = Object.keys(GITHUB_YARDHUB_RPC_HANDLERS).sort();
  assert.equal(new Set(names).size, names.length, "RPC handler names must be unique");
  assert.deepEqual(names, expectedRpcHandlers);
});

console.log("PASS: YARDHUB source parity — 39 source tables, two isolated broker tables, five Storage buckets and 19 RPC handlers are mapped");
