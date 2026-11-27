const TABLES = [
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
];

const makeId = () => globalThis.crypto?.randomUUID?.() || ("gh-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12));

function initialRows(table, bootstrapUserId, now) {
  const timestamp = now().toISOString();
  if (table === "downtime_shared_state") return [{ id: 1, payload: {}, version: 0, updated_at: timestamp }];
  if (table === "downtime_central_bank") return [{
    id: 1, version: 0, updated_at: timestamp,
    payload: { users: [], tiers: {}, staff: { roster: [], profiles: {} }, appData: {} }
  }];
  if (table === "downtime_central_config_state") return [{
    id: 1, draft_payload: {}, published_payload: {},
    draft_version: 0, published_version: 0, updated_at: timestamp
  }];
  if (table === "yard_hub_tier_config") return [{
    id: 1, version: 0, payload: { userTiers: {}, tiers: {} },
    updated_by: null, updated_at: timestamp
  }];
  if (table === "downtime_roots_bootstrap") return [{
    singleton: true, user_id: bootstrapUserId, created_at: timestamp
  }];
  return [];
}

export async function ensureGitHubDatabaseReady({ store, now = () => new Date() } = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A GitHub data store is required.");
  }
  const current = await store.readDatabase();
  const missing = TABLES.filter(name => !Object.prototype.hasOwnProperty.call(current.tables, name));
  const bootstrapMissing = !(current.tables.downtime_roots_bootstrap || []).some(row => row.singleton === true);
  const singletonMissing = [
    ["downtime_shared_state", row => Number(row.id) === 1],
    ["downtime_central_bank", row => Number(row.id) === 1],
    ["downtime_central_config_state", row => Number(row.id) === 1],
    ["yard_hub_tier_config", row => Number(row.id) === 1]
  ].some(([name, predicate]) => !(current.tables[name] || []).some(predicate));
  if (!missing.length && !bootstrapMissing && !singletonMissing) {
    return { ready: true, initialized: false, revision: current.revision, tableCount: Object.keys(current.tables).length };
  }

  const bootstrapUserId = (current.tables.downtime_roots_bootstrap || []).find(row => row.singleton === true)?.user_id || makeId();
  const result = await store.transactDatabase({
    expectedRevision: current.revision,
    actorId: "GITHUB-INSTALLER",
    operationId: "github-database-bootstrap-" + bootstrapUserId,
    mutate(tables) {
      for (const name of TABLES) {
        if (!Array.isArray(tables[name])) tables[name] = [];
        const seeded = initialRows(name, bootstrapUserId, now);
        for (const row of seeded) {
          const exists = name === "downtime_roots_bootstrap"
            ? tables[name].some(current => current.singleton === true)
            : tables[name].some(current => current.id !== undefined && Number(current.id) === Number(row.id));
          if (!exists) tables[name].push(row);
        }
      }
      if (!(tables.downtime_roots_bootstrap || []).some(row => row.singleton === true)) {
        tables.downtime_roots_bootstrap.push(initialRows("downtime_roots_bootstrap", bootstrapUserId, now)[0]);
      }
      return { tableCount: TABLES.length, bootstrapIdentityPrepared: true };
    }
  });
  return { ready: true, initialized: true, revision: result.revision, tableCount: TABLES.length, bootstrapIdentityPrepared: true };
}

export { TABLES as GITHUB_YARDHUB_TABLES };
