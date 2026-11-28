const DEFAULT_PRIMARY_KEYS = Object.freeze({
  downtime_shared_state: ["id"],
  downtime_reports: ["id"],
  downtime_attachments: ["id"],
  downtime_central_bank: ["id"],
  downtime_central_sessions: ["token_hash"],
  downtime_central_audit: ["id"],
  downtime_central_config_state: ["id"],
  downtime_central_config_history: ["version"],
  repair_maintenance_faults: ["id"],
  repair_maintenance_notes: ["id"],
  repair_maintenance_attachments: ["id"],
  repair_maintenance_audit: ["id"],
  yard_hub_tier_config: ["id"],
  yard_hub_access_audit: ["id"],
  repair_maintenance_machine_presets: ["id"],
  repair_maintenance_pdf_exports: ["id"],
  repair_maintenance_assets: ["id"],
  repair_maintenance_machine_settings: ["id"],
  repair_maintenance_machine_models: ["id"],
  downtime_daily_operator_assignments: ["duty_date"],
  downtime_daily_operator_audit: ["id"],
  gatelog_customers: ["id"],
  gatelog_vehicles: ["id"],
  gatelog_visits: ["id"],
  gatelog_waste_types: ["id"],
  gatelog_visit_waste_types: ["visit_id", "waste_type_id"],
  gatelog_audit: ["id"],
  gatelog_daily_gateman_assignments: ["duty_date"],
  gatelog_report_archive: ["id"],
  yard_roles: ["id"],
  yard_role_department_permissions: ["yard_role_id", "department"],
  yard_role_assignments: ["id"],
  yard_role_assignment_audit: ["id"],
  downtime_roots_assignments: ["id"],
  downtime_roots_assignment_audit: ["id"],
  yard_role_definition_audit: ["id"],
  downtime_roots_bootstrap: ["singleton"],
  downtime_identity_reset_runs: ["singleton"],
  downtime_roots_role_definitions: ["role_key"]
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function matches(row, filters) {
  return filters.every(({ column, operator, value }) => {
    const actual = column.split(".").reduce((current, key) => current?.[key], row);
    switch (operator) {
      case "eq": return actual === value;
      case "neq": return actual !== value;
      case "is": return value === null ? actual == null : actual === value;
      case "in": return Array.isArray(value) && value.includes(actual);
      case "gt": return compare(actual, value) > 0;
      case "gte": return compare(actual, value) >= 0;
      case "lt": return compare(actual, value) < 0;
      case "lte": return compare(actual, value) <= 0;
      case "like": return new RegExp("^" + String(value).replace(/[.+^$\{\}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i").test(String(actual ?? ""));
      case "contains": return Array.isArray(actual) ? Array.isArray(value) && value.every(item => actual.includes(item)) : !!actual && typeof actual === "object" && !!value && Object.entries(value).every(([key, item]) => actual[key] === item);
      case "not": return !matches({ value: actual }, [{ column: "value", operator: value.operator || "eq", value: value.value }]);
      case "ilike": return new RegExp("^" + String(value).replace(/[.+^$\{\}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i").test(String(actual ?? ""));
      default: throw new TypeError("Unsupported GitHub table filter: " + operator);
    }
  });
}

const RELATIONS = Object.freeze({
  gatelog_visits: {
    gatelog_customers: { table: "gatelog_customers", localKey: "customer_id", foreignKey: "id", many: false },
    gatelog_visit_waste_types: { table: "gatelog_visit_waste_types", localKey: "id", foreignKey: "visit_id", many: true }
  },
  gatelog_visit_waste_types: {
    gatelog_waste_types: { table: "gatelog_waste_types", localKey: "waste_type_id", foreignKey: "id", many: false }
  }
});

function splitSelectColumns(value) {
  const result = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "(") depth += 1;
    else if (value[i] === ")") depth -= 1;
    else if (value[i] === "," && depth === 0) {
      result.push(value.slice(start, i).trim()); start = i + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

function applyBootstrapIdentityTrigger(tables, tableName, values, now) {
  if (tableName !== "downtime_central_bank" || !values?.payload || !Array.isArray(values.payload.users)) return values;
  const dev = values.payload.users.find(account => String(account.username || "").trim().toUpperCase() === "DEV" && !account.userId);
  if (!dev) return values;
  const bootstrap = (tables.downtime_roots_bootstrap || []).find(row => row.singleton === true);
  if (!bootstrap?.user_id) throw new GitHubTableQueryError("The immutable DEV bootstrap identity has not been prepared.", "ROOTS_BOOTSTRAP_MISSING", 409);
  dev.userId = bootstrap.user_id;
  bootstrap.bootstrap_code_hash = null;
  bootstrap.bootstrap_code_expires_at = null;
  bootstrap.bootstrap_code_consumed_at = now().toISOString();
  globalThis.__YARDHUB_BOOTSTRAP_CODE__ = null;
  const definitions = tables.downtime_roots_role_definitions || (tables.downtime_roots_role_definitions = []);
  const timestamp = now().toISOString();
  const seeds = [
    {
      role_key: "DEV1", display_name: "DEV1", visibility: "DEV_ONLY",
      description: "Protected ROOTED role. May manage YARD ROLE definitions and assign ADMIN ROOTS; cannot browse the ROOTS directory, assign DEV1, reclassify or revoke ROOTS.",
      capabilities: {
        canBrowseRoots: false, canAssignDev1: false, canAssignAdmin: true,
        canManageYardRoles: true, hasAutomaticDepartmentManage: true,
        canReclassifyRoots: false, canRevokeRoots: false
      }
    },
    {
      role_key: "ADMIN", display_name: "ADMIN", visibility: "DEV_ONLY",
      description: "Protected ROOTED role. May manage YARD ROLE definitions; cannot browse the ROOTS directory or assign, reclassify or revoke ROOTS.",
      capabilities: {
        canBrowseRoots: false, canAssignDev1: false, canAssignAdmin: false,
        canManageYardRoles: true, hasAutomaticDepartmentManage: true,
        canReclassifyRoots: false, canRevokeRoots: false
      }
    }
  ];
  for (const seed of seeds) {
    if (!definitions.some(row => row.role_key === seed.role_key)) {
      definitions.push({
        ...seed, version: 1, created_by_user_id: bootstrap.user_id,
        created_at: timestamp, updated_at: timestamp
      });
    }
  }
  return values;
}

function project(row, columns, tableName = "", allTables = {}) {
  if (!columns || columns.trim() === "*") return clone(row);
  const result = {};
  const selected = splitSelectColumns(columns);
  if (selected.includes("*")) Object.assign(result, clone(row));
  for (const part of selected) {
    const relationMatch = /^([A-Za-z0-9_]+)(?::([A-Za-z0-9_]+))?\((.*)\)$/.exec(part);
    if (relationMatch) {
      const relationName = relationMatch[1];
      const outputName = relationMatch[2] || relationName;
      const relation = RELATIONS[tableName]?.[relationName];
      if (!relation) { result[outputName] = relationName === "gatelog_customers" ? null : []; continue; }
      const candidates = (allTables[relation.table] || []).filter(item => item[relation.foreignKey] === row[relation.localKey]);
      const projected = candidates.map(item => project(item, relationMatch[3], relation.table, allTables));
      result[outputName] = relation.many ? projected : (projected[0] || null);
      continue;
    }
    if (part === "*") continue;
    const [source, alias] = part.split(":").map(value => value.trim());
    const value = source.split(".").reduce((current, key) => current?.[key], row);
    if (value !== undefined) result[alias || source] = clone(value);
  }
  return result;
}

export class GitHubTableQueryError extends Error {
  constructor(message, code = "GITHUB_TABLE_QUERY_ERROR", status = 400) {
    super(message);
    this.name = "GitHubTableQueryError";
    this.code = code;
    this.status = status;
  }
}

export function createGitHubTableClient({
  store,
  actorId = "GITHUB-OPERATOR",
  primaryKeys = DEFAULT_PRIMARY_KEYS,
  now = () => new Date(),
  maxConflictRetries = 2,
  rpcHandlers = {}
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A GitHub data store with readDatabase and transactDatabase is required.");
  }

  function from(tableName) {
    const table = String(tableName || "").trim();
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) throw new TypeError("Invalid database table name.");

    const query = {
      table, operation: "select", columns: "*", payload: null, filters: [],
      orders: [], maxRows: null, offset: 0, singleMode: null, returning: false,
      headOnly: false, countMode: null,
      conflictColumns: primaryKeys[table] || ["id"],
      select(columns = "*", options = {}) {
        this.columns = String(columns);
        if (this.operation !== "select") this.returning = true;
        this.countMode = options?.count || null;
        this.headOnly = options?.head === true;
        return this;
      },
      insert(rows) { this.operation = "insert"; this.payload = Array.isArray(rows) ? clone(rows) : [clone(rows)]; return this; },
      upsert(rows, options = {}) {
        this.operation = "upsert"; this.payload = Array.isArray(rows) ? clone(rows) : [clone(rows)];
        if (options.onConflict) this.conflictColumns = String(options.onConflict).split(",").map(x => x.trim());
        return this;
      },
      update(values) { this.operation = "update"; this.payload = clone(values); return this; },
      delete() { this.operation = "delete"; return this; },
      eq(column, value) { this.filters.push({ column, operator: "eq", value }); return this; },
      neq(column, value) { this.filters.push({ column, operator: "neq", value }); return this; },
      is(column, value) { this.filters.push({ column, operator: "is", value }); return this; },
      in(column, value) { this.filters.push({ column, operator: "in", value: Array.isArray(value) ? clone(value) : [] }); return this; },
      gt(column, value) { this.filters.push({ column, operator: "gt", value }); return this; },
      gte(column, value) { this.filters.push({ column, operator: "gte", value }); return this; },
      lt(column, value) { this.filters.push({ column, operator: "lt", value }); return this; },
      lte(column, value) { this.filters.push({ column, operator: "lte", value }); return this; },
      filter(column, operator, value) {
        const supported = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]);
        const op = String(operator || "").trim();
        if (!supported.has(op)) throw new TypeError("Unsupported GitHub table filter: " + op);
        let parsed = value;
        if (op === "in" && typeof value === "string") {
          const raw = value.trim().replace(/^\(/, "").replace(/\)$/, "");
          parsed = raw ? raw.split(",").map(item => item.trim().replace(/^["']|["']$/g, "")) : [];
        }
        this.filters.push({ column, operator: op, value: parsed });
        return this;
      },
      like(column, value) { this.filters.push({ column, operator: "like", value }); return this; },
      ilike(column, value) { this.filters.push({ column, operator: "ilike", value }); return this; },
      match(values) {
        if (!values || typeof values !== "object" || Array.isArray(values)) throw new TypeError("Match filters must be an object.");
        for (const [column, value] of Object.entries(values)) this.filters.push({ column, operator: "eq", value });
        return this;
      },
      not(column, operator, value) { this.filters.push({ column, operator: "not", value: { operator, value } }); return this; },
      contains(column, value) { this.filters.push({ column, operator: "contains", value }); return this; },
      order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false, nullsFirst: options.nullsFirst }); return this; },
      limit(count) { this.maxRows = Math.max(0, Number(count) || 0); return this; },
      range(fromIndex, toIndex) { this.offset = Math.max(0, Number(fromIndex) || 0); this.maxRows = Math.max(0, Number(toIndex) - this.offset + 1); return this; },
      single() { this.singleMode = "single"; return this.execute(); },
      maybeSingle() { this.singleMode = "maybe"; return this.execute(); },
      then(resolve, reject) { return this.execute().then(resolve, reject); },
      async execute() {
        try {
          if (this.operation === "select") {
            const db = await store.readDatabase();
            let rows = (db.tables[table] || []).filter(row => matches(row, this.filters));
            for (const order of [...this.orders].reverse()) {
              rows.sort((a, b) => compare(a[order.column], b[order.column]) * (order.ascending ? 1 : -1));
            }
            const count = this.countMode ? rows.length : null;
            if (this.offset) rows = rows.slice(this.offset);
            if (this.maxRows !== null) rows = rows.slice(0, this.maxRows);
            rows = rows.map(row => project(row, this.columns, table, db.tables));
            if (this.singleMode === "single" && rows.length !== 1) throw new GitHubTableQueryError("Expected exactly one row, received " + rows.length + ".", "PGRST116", 406);
            if (this.singleMode === "maybe" && rows.length > 1) throw new GitHubTableQueryError("Expected zero or one row, received " + rows.length + ".", "PGRST116", 406);
            return { data: this.headOnly ? null : this.singleMode ? (rows[0] ?? null) : rows, error: null, count, status: 200, statusText: "OK" };
          }

          const inputRows = this.operation === "insert" || this.operation === "upsert" ? this.payload : [];
          if ((this.operation === "insert" || this.operation === "upsert") && (!Array.isArray(inputRows) || inputRows.some(row => !row || typeof row !== "object" || Array.isArray(row)))) {
            throw new GitHubTableQueryError("Insert rows must be JSON objects.");
          }
          if (this.operation === "update" && (!this.payload || typeof this.payload !== "object" || Array.isArray(this.payload))) {
            throw new GitHubTableQueryError("Update values must be a JSON object.");
          }

          let resultRows = [];
          let finalError = null;
          for (let attempt = 0; attempt <= maxConflictRetries; attempt += 1) {
            resultRows = [];
            const db = await store.readDatabase();
            try {
              const transaction = await store.transactDatabase({
                expectedRevision: db.revision,
                actorId,
                operationId: "db-" + now().getTime() + "-" + Math.random().toString(36).slice(2, 10),
                mutate: (tables) => {
                  const rows = tables[table] || [];
                  if (this.operation === "insert") {
                    for (const raw of inputRows) {
                      const row = clone(raw);
                      const keys = this.conflictColumns;
                      if (keys.length === 1 && keys[0] === "id" && row.id == null && globalThis.crypto?.randomUUID) row.id = globalThis.crypto.randomUUID();
                      if (keys.length === 1 && keys[0] === "singleton" && row.singleton == null) row.singleton = true;
                      if (rows.some(existing => keys.every(key => existing[key] === row[key]))) {
                        throw new GitHubTableQueryError("Duplicate key violates unique constraint on " + table + ".", "23505", 409);
                      }
                      rows.push({ created_at: now().toISOString(), ...row });
                      resultRows.push(row);
                    }
                  } else if (this.operation === "upsert") {
                    resultRows = [];
                    for (const row of inputRows) {
                      const index = rows.findIndex(existing => this.conflictColumns.every(key => existing[key] === row[key]));
                      if (index < 0) {
                        const inserted = clone(row);
                        if (this.conflictColumns.length === 1 && this.conflictColumns[0] === "id" && inserted.id == null && globalThis.crypto?.randomUUID) inserted.id = globalThis.crypto.randomUUID();
                        rows.push({ created_at: now().toISOString(), ...inserted }); resultRows.push(rows[rows.length - 1]);
                      } else {
                        rows[index] = { ...rows[index], ...clone(row), updated_at: now().toISOString() };
                        resultRows.push(rows[index]);
                      }
                    }
                  } else {
                    const matched = rows.filter(row => matches(row, this.filters));
                    resultRows = matched.map(clone);
                    if (this.operation === "update") {
                      const matchedRows = rows.filter(row => matches(row, this.filters));
                      for (const row of matchedRows) {
                        const values = applyBootstrapIdentityTrigger(tables, table, clone(this.payload), now);
                        Object.assign(row, values, { updated_at: now().toISOString() });
                      }
                      resultRows = matchedRows.map(clone);
                    } else if (this.operation === "delete") {
                      tables[table] = rows.filter(row => !matches(row, this.filters));
                      return { affected: resultRows.length };
                    }
                  }
                  tables[table] = rows;
                  return { affected: resultRows.length };
                }
              });
              finalError = null;
              break;
            } catch (error) {
              finalError = error;
              if (!(error?.status === 409) || attempt === maxConflictRetries) break;
            }
          }
          if (finalError) throw finalError;
          const selectedRows = this.returning ? resultRows.map(row => project(row, this.columns)) : null;
          if (this.singleMode === "single" && selectedRows && selectedRows.length !== 1) throw new GitHubTableQueryError("Expected exactly one row, received " + selectedRows.length + ".", "PGRST116", 406);
          if (this.singleMode === "maybe" && selectedRows && selectedRows.length > 1) throw new GitHubTableQueryError("Expected zero or one row, received " + selectedRows.length + ".", "PGRST116", 406);
          return { data: this.headOnly ? null : this.singleMode ? (selectedRows?.[0] ?? null) : selectedRows, error: null, count: this.countMode ? resultRows.length : null, status: 201, statusText: "Created" };
        } catch (error) {
          return { data: null, error: { message: error.message, code: error.code || "GITHUB_TABLE_ERROR", status: error.status || 500 }, count: null, status: error.status || 500, statusText: "Error" };
        }
      }
    };
    return query;
  }

  async function runRpc(name, args = {}) {
    const handler = rpcHandlers[name];
    if (typeof handler !== "function") {
      return { data: null, error: { message: "Unsupported RPC: " + name, code: "42883" }, status: 501 };
    }
    try {
      let result;
      const db = await store.readDatabase();
      await store.transactDatabase({
        expectedRevision: db.revision,
        actorId,
        operationId: "rpc-" + name + "-" + now().getTime() + "-" + Math.random().toString(36).slice(2, 8),
        mutate: async tables => { result = await handler({ tables, args, now }); }
      });
      return { data: result, error: null, status: 200 };
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code || "GITHUB_RPC_ERROR", status: error.status || 500 }, status: error.status || 500 };
    }
  }

  async function transaction(callback, { operationId = null } = {}) {
    if (typeof callback !== "function") throw new TypeError("A transaction callback is required.");
    const baseline = await store.readDatabase();
    let localRevision = baseline.revision;
    let localTables = clone(baseline.tables) || {};
    const localStore = {
      async readDatabase() {
        return { revision: localRevision, tables: clone(localTables), manifest: { revision: localRevision } };
      },
      async transactDatabase({ expectedRevision, mutate }) {
        if (expectedRevision !== localRevision) {
          const error = new Error("Local transaction revision changed.");
          error.status = 409;
          throw error;
        }
        const draft = clone(localTables);
        const result = await mutate(draft);
        localTables = draft;
        localRevision += 1;
        return { committed: true, revision: localRevision, result };
      }
    };
    const tx = createGitHubTableClient({
      store: localStore, actorId, primaryKeys, now, maxConflictRetries, rpcHandlers
    });
    const result = await callback(tx);
    const changedNames = new Set([...Object.keys(baseline.tables), ...Object.keys(localTables)]);
    const changed = [...changedNames].some(name => JSON.stringify(baseline.tables[name]) !== JSON.stringify(localTables[name]));
    if (!changed) return { result, revision: baseline.revision, committed: false };
    const committed = await store.transactDatabase({
      expectedRevision: baseline.revision,
      actorId,
      operationId: operationId || ("tx-" + now().getTime() + "-" + Math.random().toString(36).slice(2, 8)),
      mutate(tables) {
        for (const name of Object.keys(localTables)) tables[name] = clone(localTables[name]);
        for (const name of Object.keys(tables)) {
          if (!(name in localTables)) throw new GitHubTableQueryError("Whole-table deletion is not supported.");
        }
      }
    });
    return { result, revision: committed.revision, commitSha: committed.commitSha, committed: true };
  }

  return Object.freeze({
    from,
    rpc: runRpc,
    transaction,
    async health() { const db = await store.readDatabase(); return { ok: true, revision: db.revision, tableCount: Object.keys(db.tables).length }; }
  });
}

export { DEFAULT_PRIMARY_KEYS };
