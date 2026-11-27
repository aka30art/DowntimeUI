const DEFAULT_PRIMARY_KEYS = Object.freeze({
  downtime_shared_state: ["id"],
  downtime_reports: ["id"],
  downtime_attachments: ["id"],
  downtime_central_bank: ["id"],
  downtime_central_sessions: ["id"],
  downtime_central_audit: ["id"],
  downtime_central_config_state: ["id"],
  downtime_central_config_history: ["id"],
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
  gatelog_visit_waste_types: ["id"],
  gatelog_audit: ["id"],
  gatelog_daily_gateman_assignments: ["duty_date"],
  gatelog_report_archive: ["id"],
  yard_roles: ["id"],
  yard_role_department_permissions: ["id"],
  yard_role_assignments: ["id"],
  yard_role_assignment_audit: ["id"],
  downtime_roots_assignments: ["id"],
  downtime_roots_assignment_audit: ["id"],
  yard_role_definition_audit: ["id"],
  downtime_roots_bootstrap: ["id"],
  downtime_identity_reset_runs: ["id"],
  downtime_roots_role_definitions: ["id"]
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
      case "ilike": return new RegExp("^" + String(value).replace(/[.+^$\{\}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i").test(String(actual ?? ""));
      default: throw new TypeError("Unsupported GitHub table filter: " + operator);
    }
  });
}

function project(row, columns) {
  if (!columns || columns.trim() === "*" || columns.includes("(")) return clone(row);
  const selected = columns.split(",").map(part => part.trim()).filter(Boolean);
  const result = {};
  for (const path of selected) {
    const [source, alias] = path.split(":").map(value => value.trim());
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
  maxConflictRetries = 2
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
      conflictColumns: primaryKeys[table] || ["id"],
      select(columns = "*") { this.columns = String(columns); if (this.operation !== "select") this.returning = true; return this; },
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
      like(column, value) { this.filters.push({ column, operator: "like", value }); return this; },
      ilike(column, value) { this.filters.push({ column, operator: "ilike", value }); return this; },
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
            const count = rows.length;
            if (this.offset) rows = rows.slice(this.offset);
            if (this.maxRows !== null) rows = rows.slice(0, this.maxRows);
            rows = rows.map(row => project(row, this.columns));
            if (this.singleMode === "single" && rows.length !== 1) throw new GitHubTableQueryError("Expected exactly one row, received " + rows.length + ".", "PGRST116", 406);
            if (this.singleMode === "maybe" && rows.length > 1) throw new GitHubTableQueryError("Expected zero or one row, received " + rows.length + ".", "PGRST116", 406);
            return { data: this.singleMode ? (rows[0] ?? null) : rows, error: null, count, status: 200, statusText: "OK" };
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
            const db = await store.readDatabase();
            try {
              const transaction = await store.transactDatabase({
                expectedRevision: db.revision,
                actorId,
                operationId: "db-" + now().getTime() + "-" + Math.random().toString(36).slice(2, 10),
                mutate(tables) {
                  const rows = tables[table] || [];
                  if (this.operation === "insert") {
                    for (const row of inputRows) {
                      const keys = this.conflictColumns;
                      if (rows.some(existing => keys.every(key => existing[key] === row[key]))) {
                        throw new GitHubTableQueryError("Duplicate key violates unique constraint on " + table + ".", "23505", 409);
                      }
                      rows.push({ created_at: now().toISOString(), ...clone(row) });
                    }
                    resultRows = inputRows.map(clone);
                  } else if (this.operation === "upsert") {
                    resultRows = [];
                    for (const row of inputRows) {
                      const index = rows.findIndex(existing => this.conflictColumns.every(key => existing[key] === row[key]));
                      if (index < 0) {
                        const inserted = { created_at: now().toISOString(), ...clone(row) };
                        rows.push(inserted); resultRows.push(inserted);
                      } else {
                        rows[index] = { ...rows[index], ...clone(row), updated_at: now().toISOString() };
                        resultRows.push(rows[index]);
                      }
                    }
                  } else {
                    const matched = rows.filter(row => matches(row, this.filters));
                    resultRows = matched.map(clone);
                    if (this.operation === "update") {
                      for (const row of rows) if (matches(row, this.filters)) Object.assign(row, clone(this.payload), { updated_at: now().toISOString() });
                      resultRows = rows.filter(row => matches(row, this.filters)).map(clone);
                    } else if (this.operation === "delete") {
                      tables[table] = rows.filter(row => !matches(row, this.filters));
                    }
                  }
                  tables[table] = rows;
                  return { affected: resultRows.length };
                }.bind(this)
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
          return { data: this.singleMode ? (selectedRows?.[0] ?? null) : selectedRows, error: null, count: resultRows.length, status: 201, statusText: "Created" };
        } catch (error) {
          return { data: null, error: { message: error.message, code: error.code || "GITHUB_TABLE_ERROR", status: error.status || 500 }, count: null, status: error.status || 500, statusText: "Error" };
        }
      }
    };
    return query;
  }

  return Object.freeze({
    from,
    async rpc() { throw new GitHubTableQueryError("RPC compatibility is not implemented; use a GitHub-native action handler.", "42883", 501); },
    async health() { const db = await store.readDatabase(); return { ok: true, revision: db.revision, tableCount: Object.keys(db.tables).length }; }
  });
}

export { DEFAULT_PRIMARY_KEYS };
