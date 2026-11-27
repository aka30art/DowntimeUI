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

function makeBootstrapCode() {
  const cryptoProvider = globalThis.crypto;
  if (!cryptoProvider?.getRandomValues || !cryptoProvider?.subtle?.digest) {
    throw new Error("Secure random generation is unavailable. DEV bootstrap is blocked in this browser.");
  }
  const bytes = new Uint8Array(24);
  cryptoProvider.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function hashBootstrapCode(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

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
    singleton: true, user_id: bootstrapUserId, created_at: timestamp,
    bootstrap_code_hash: null, bootstrap_code_expires_at: null
  }];
  return [];
}

export async function ensureGitHubDatabaseReady({
  store,
  now = () => new Date(),
  generateBootstrapCode = makeBootstrapCode
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A GitHub data store is required.");
  }
  const current = await store.readDatabase();
  const missing = TABLES.filter(name => !Object.prototype.hasOwnProperty.call(current.tables, name));
  const bootstrapRow = (current.tables.downtime_roots_bootstrap || []).find(row => row.singleton === true);
  const bootstrapMissing = !bootstrapRow;
  const singletonMissing = [
    ["downtime_shared_state", row => Number(row.id) === 1],
    ["downtime_central_bank", row => Number(row.id) === 1],
    ["downtime_central_config_state", row => Number(row.id) === 1],
    ["yard_hub_tier_config", row => Number(row.id) === 1]
  ].some(([name, predicate]) => !(current.tables[name] || []).some(predicate));
  const bank = (current.tables.downtime_central_bank || []).find(row => Number(row.id) === 1);
  const hasDevUser = Array.isArray(bank?.payload?.users) && bank.payload.users.length > 0;
  const existingExpiry = Date.parse(bootstrapRow?.bootstrap_code_expires_at || "");
  const existingCode = globalThis.__YARDHUB_BOOTSTRAP_CODE__;
  const reuseCode = !hasDevUser && existingCode && bootstrapRow?.bootstrap_code_hash &&
    Number.isFinite(existingExpiry) && existingExpiry > now().getTime() &&
    await hashBootstrapCode(existingCode) === bootstrapRow.bootstrap_code_hash;
  const bootstrapCode = !hasDevUser ? (reuseCode ? existingCode : generateBootstrapCode()) : null;
  const bootstrapCodeHash = bootstrapCode ? await hashBootstrapCode(bootstrapCode) : null;
  const bootstrapCodeExpiresAt = bootstrapCode ? new Date(now().getTime() + 15 * 60 * 1000).toISOString() : null;
  const needsBootstrapCodeUpdate = Boolean(bootstrapCode && !reuseCode);
  const needsChange = missing.length || bootstrapMissing || singletonMissing || needsBootstrapCodeUpdate;
  if (!needsChange) {
    globalThis.__YARDHUB_BOOTSTRAP_CODE__ = bootstrapCode;
    return {
      ready: true, initialized: false, revision: current.revision,
      tableCount: Object.keys(current.tables).length, bootstrapCode,
      bootstrapCodeExpiresAt
    };
  }

  const bootstrapUserId = bootstrapRow?.user_id || makeId();
  const result = await store.transactDatabase({
    expectedRevision: current.revision,
    actorId: "GITHUB-INSTALLER",
    operationId: "github-database-bootstrap-" + bootstrapUserId + "-" + (bootstrapCodeHash || "schema"),
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
      const root = tables.downtime_roots_bootstrap.find(row => row.singleton === true);
      if (!root) throw new Error("Immutable DEV bootstrap record could not be created.");
      if (bootstrapCode) {
        root.bootstrap_code_hash = bootstrapCodeHash;
        root.bootstrap_code_expires_at = bootstrapCodeExpiresAt;
        root.bootstrap_code_created_at = now().toISOString();
      }
      return { tableCount: TABLES.length, bootstrapIdentityPrepared: true, bootstrapCodeRotated: Boolean(bootstrapCode) };
    }
  });
  globalThis.__YARDHUB_BOOTSTRAP_CODE__ = bootstrapCode;
  return {
    ready: true, initialized: true, revision: result.revision,
    tableCount: TABLES.length, bootstrapIdentityPrepared: true,
    bootstrapCode, bootstrapCodeExpiresAt
  };
}

export { TABLES as GITHUB_YARDHUB_TABLES };
