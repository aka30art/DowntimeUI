const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function safeRecord(value, label = "Record") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be an object.");
  }
  return value;
}

function compareValue(actual, operator, expected) {
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (operator === "gt") return actual > expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "is") return actual === expected;
  if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (operator === "ilike") {
    const pattern = String(expected).replace(/[.+^$|{}()\[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp("^" + pattern + "$", "i").test(String(actual ?? ""));
  }
  if (operator === "like") {
    const pattern = String(expected).replace(/[.+^$|{}()\[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp("^" + pattern + "$").test(String(actual ?? ""));
  }
  if (operator === "contains") {
    if (Array.isArray(actual)) return Array.isArray(expected) && expected.every((item) => actual.includes(item));
    if (actual && typeof actual === "object" && expected && typeof expected === "object") {
      return Object.entries(expected).every(([key, value]) => actual[key] === value);
    }
    return false;
  }
  return false;
}

function projectRow(row, columns) {
  if (!columns || columns === "*" || columns.includes("(")) return clone(row);
  const names = columns.split(",").map((value) => value.trim()).filter(Boolean);
  if (!names.length) return clone(row);
  const result = {};
  for (const name of names) {
    if (name in row) result[name] = clone(row[name]);
    else if (name.includes(":")) {
      const [alias, source] = name.split(":");
      if (source in row) result[alias] = clone(row[source]);
    }
  }
  return result;
}

function errorResult(message, code = "PGRST_ERROR", status = 400) {
  return { data: null, error: { message, code, status }, count: null };
}

class GitHubQueryBuilder {
  constructor(context, table) {
    this.context = context;
    this.table = table;
    this.operation = "select";
    this.columns = "*";
    this.returning = false;
    this.values = null;
    this.conflictKeys = [];
    this.filters = [];
    this.orders = [];
    this.maxRows = null;
    this.start = null;
    this.end = null;
    this.countMode = null;
    this.headOnly = false;
    this.executed = null;
  }

  select(columns = "*", options = {}) {
    this.columns = String(columns || "*");
    this.returning = this.operation !== "select";
    this.countMode = options?.count || null;
    this.headOnly = options?.head === true;
    return this;
  }
  insert(values) { this.operation = "insert"; this.values = values; return this; }
  update(values) { this.operation = "update"; this.values = safeRecord(values, "Update values"); return this; }
  delete() { this.operation = "delete"; return this; }
  upsert(values, options = {}) {
    this.operation = "upsert"; this.values = values;
    this.conflictKeys = String(options.onConflict || "id").split(",").map((x) => x.trim()).filter(Boolean);
    return this;
  }
  eq(column, value) { this.filters.push({ column, operator: "eq", value }); return this; }
  neq(column, value) { this.filters.push({ column, operator: "neq", value }); return this; }
  gt(column, value) { this.filters.push({ column, operator: "gt", value }); return this; }
  gte(column, value) { this.filters.push({ column, operator: "gte", value }); return this; }
  lt(column, value) { this.filters.push({ column, operator: "lt", value }); return this; }
  lte(column, value) { this.filters.push({ column, operator: "lte", value }); return this; }
  is(column, value) { this.filters.push({ column, operator: "is", value }); return this; }
  in(column, values) { this.filters.push({ column, operator: "in", value: values }); return this; }
  ilike(column, value) { this.filters.push({ column, operator: "ilike", value }); return this; }
  like(column, value) { this.filters.push({ column, operator: "like", value }); return this; }
  contains(column, value) { this.filters.push({ column, operator: "contains", value }); return this; }
  filter(column, operator, value) { this.filters.push({ column, operator: String(operator), value }); return this; }
  match(values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new TypeError("Match filters must be an object.");
    for (const [column, value] of Object.entries(values)) this.filters.push({ column, operator: "eq", value });
    return this;
  }
  not(column, operator, value) { this.filters.push({ column, operator: operator === "is" ? "neq" : "not", value }); return this; }
  order(column, options = {}) { this.orders.push({ column, ascending: options.ascending !== false }); return this; }
  limit(value) { this.maxRows = Math.max(0, Number(value) || 0); return this; }
  range(from, to) { this.start = Math.max(0, Number(from) || 0); this.end = Math.max(this.start, Number(to) || this.start); return this; }

  maybeSingle() { return this.execute("maybeSingle"); }
  single() { return this.execute("single"); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  matches(row) {
    return this.filters.every(({ column, operator, value }) => {
      const actual = row?.[column];
      if (operator === "not") return !compareValue(actual, "eq", value);
      return compareValue(actual, operator, value);
    });
  }

  rows() {
    if (!Array.isArray(this.context.tables[this.table])) this.context.tables[this.table] = [];
    return this.context.tables[this.table];
  }

  async execute(singleMode = null) {
    if (this.executed) return this.executed;
    this.executed = this.run(singleMode);
    return this.executed;
  }

  async run(singleMode) {
    if (!IDENTIFIER.test(this.table)) return errorResult("Invalid table name.");
    const rows = this.rows();
    let data = [];
    try {
      if (this.operation === "select") {
        data = rows.filter((row) => this.matches(row));
      } else if (this.operation === "insert") {
        const incoming = Array.isArray(this.values) ? this.values : [this.values];
        for (const raw of incoming) {
          const row = safeRecord(raw, "Insert record");
          const inserted = { ...clone(row) };
          if (!inserted.id && globalThis.crypto?.randomUUID) inserted.id = globalThis.crypto.randomUUID();
          if (!inserted.created_at && this.table.endsWith("_audit")) inserted.created_at = this.context.now().toISOString();
          rows.push(inserted);
          data.push(inserted);
        }
      } else if (this.operation === "update") {
        for (let index = 0; index < rows.length; index += 1) {
          if (!this.matches(rows[index])) continue;
          rows[index] = { ...rows[index], ...clone(this.values) };
          data.push(rows[index]);
        }
      } else if (this.operation === "delete") {
        const retained = [];
        for (const row of rows) {
          if (this.matches(row)) data.push(row);
          else retained.push(row);
        }
        this.context.tables[this.table] = retained;
      } else if (this.operation === "upsert") {
        const incoming = Array.isArray(this.values) ? this.values : [this.values];
        for (const raw of incoming) {
          const row = safeRecord(raw, "Upsert record");
          const keys = this.conflictKeys.length ? this.conflictKeys : ["id"];
          const existing = rows.find((item) => keys.every((key) => item[key] === row[key]));
          if (existing) {
            Object.assign(existing, clone(row));
            data.push(existing);
          } else {
            const inserted = { ...clone(row) };
            if (!inserted.id && globalThis.crypto?.randomUUID) inserted.id = globalThis.crypto.randomUUID();
            rows.push(inserted);
            data.push(inserted);
          }
        }
      } else {
        return errorResult("Unsupported database operation: " + this.operation);
      }

      const count = this.countMode ? data.length : null;
      for (const order of this.orders.slice().reverse()) {
        data.sort((a, b) => {
          const av = a?.[order.column], bv = b?.[order.column];
          if (av === bv) return 0;
          if (av === null || av === undefined) return order.ascending ? -1 : 1;
          if (bv === null || bv === undefined) return order.ascending ? 1 : -1;
          return (av > bv ? 1 : -1) * (order.ascending ? 1 : -1);
        });
      }
      if (this.start !== null) data = data.slice(this.start, (this.end ?? this.start) + 1);
      else if (this.maxRows !== null) data = data.slice(0, this.maxRows);
      if (singleMode === "maybeSingle") {
        if (data.length > 1) return errorResult("JSON object requested, multiple rows returned.", "PGRST116", 406);
        return { data: data.length ? projectRow(data[0], this.columns) : null, error: null, count };
      }
      if (singleMode === "single") {
        if (data.length !== 1) return errorResult("JSON object requested, no or multiple rows returned.", "PGRST116", 406);
        return { data: projectRow(data[0], this.columns), error: null, count };
      }
      return { data: this.headOnly ? null : data.map((row) => projectRow(row, this.columns)), error: null, count };
    } catch (error) {
      return errorResult(error?.message || "Database operation failed.");
    }
  }
}

export function createGitHubDatabaseClient(store, {
  now = () => new Date(),
  rpcHandlers = {}
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A GitHub data store with database transaction support is required.");
  }

  return Object.freeze({
    async transaction(callback, { actorId = "SYSTEM", operationId = null } = {}) {
      if (typeof callback !== "function") throw new TypeError("A transaction callback is required.");
      const baseline = await store.readDatabase();
      const workingTables = clone(baseline.tables) || {};
      const rpcContext = { tables: workingTables, now };
      const db = {
        from(table) { return new GitHubQueryBuilder(rpcContext, String(table)); },
        async rpc(name, args = {}) {
          const handler = rpcHandlers[name];
          if (typeof handler !== "function") return { data: null, error: { message: "Unsupported RPC: " + name, code: "42883" } };
          try { return { data: await handler(rpcContext, args), error: null }; }
          catch (error) { return { data: null, error: { message: error?.message || "RPC failed", code: error?.code || "P0001" } }; }
        },
        storage: null
      };
      const result = await callback(db);
      const changed = Object.keys(workingTables).some((name) =>
        JSON.stringify(workingTables[name]) !== JSON.stringify(baseline.tables[name])
      ) || Object.keys(baseline.tables).some((name) => !(name in workingTables));
      if (!changed) return { result, revision: baseline.revision, committed: false };
      const committed = await store.transactDatabase({
        expectedRevision: baseline.revision,
        actorId,
        operationId,
        mutate(tables) {
          for (const [name, rows] of Object.entries(workingTables)) tables[name] = clone(rows);
          for (const name of Object.keys(tables)) {
            if (!(name in workingTables)) throw new Error("Database table deletion is not supported.");
          }
        }
      });
      return { result, revision: committed.revision, commitSha: committed.commitSha, committed: committed.committed };
    }
  });
}
