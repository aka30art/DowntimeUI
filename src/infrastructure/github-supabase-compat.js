import { createGitHubTableClient } from "./github-table-client.js";
import { createGitHubStorageClient } from "./github-storage-client.js";

function makeResponseError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Creates a transaction-scoped table store for one broker request. All
 * compatibility-client writes are staged into the broker's outer transaction
 * rather than committing one Git ref per SQL statement.
 */
export function createGitHubBrokerTransactionStore(context) {
  if (!context || !context.tables || !Number.isInteger(context.revision)) {
    throw new TypeError("A broker transaction context with tables and revision is required.");
  }
  return {
    async readDatabase() {
      return {
        revision: context.revision,
        tables: structuredClone(context.tables),
        manifest: { revision: context.revision }
      };
    },
    async readTable(name) {
      return structuredClone(context.tables[name] || []);
    },
    async transactDatabase({ expectedRevision, mutate } = {}) {
      if (expectedRevision !== context.revision) {
        const error = new Error("Broker-local transaction revision changed.");
        error.status = 409;
        throw error;
      }
      if (typeof mutate !== "function") throw new TypeError("A broker-local table mutator is required.");
      const draft = structuredClone(context.tables);
      const result = await mutate(draft);
      for (const name of Object.keys(draft)) context.tables[name] = draft[name];
      context.revision += 1;
      return { committed: true, revision: context.revision, result };
    }
  };
}

export function createGitHubSupabaseCompat({
  store,
  storageClient = null,
  actorId = "YARDHUB-EDGE-SERVICE",
  rpcHandlers = {},
  handlers = globalThis.__YARDHUB_EDGE_HANDLERS__ || {},
  sessionProvider = () => globalThis.DowntimeCentral?.session || null,
  originProvider = () => globalThis.location?.origin || "https://aka30art.github.io",
  pollIntervalMs = 15000
} = {}) {
  if (!store) throw new TypeError("A GitHub data store is required.");
  const tables = createGitHubTableClient({ store, actorId, rpcHandlers });
  const storage = storageClient || createGitHubStorageClient({ store });

  const auth = {
    async getSession() {
      const current = sessionProvider();
      return { data: { session: current ? { access_token: current.token, user: current.user || null } : null }, error: null };
    },
    async signInAnonymously() {
      return {
        data: { session: null, user: null },
        error: makeResponseError("Anonymous authentication is disabled. Sign in through the trusted YARDHUB identity service.", 401)
      };
    },
    async signOut() { return { error: null }; }
  };

  const functions = {
    async invoke(name, options = {}) {
      const handler = handlers[String(name || "")];
      if (typeof handler !== "function") return { data: null, error: makeResponseError("GitHub-native function is not registered: " + name, 404) };
      try {
        const request = new Request("https://github-native.invalid/functions/v1/" + encodeURIComponent(name), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            origin: originProvider(),
            ...(options.headers || {})
          },
          body: JSON.stringify(options.body || {})
        });
        const response = await handler(request);
        const raw = await response.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        return response.ok ? { data, error: null } : { data: null, error: makeResponseError(data?.error || "GitHub-native function request failed.", response.status) };
      } catch (error) {
        return { data: null, error };
      }
    }
  };

  const activeChannels = new Set();
  const channel = (name) => {
    const listeners = [];
    let timer = null, polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const tableReads = new Map();
        const readTable = async (table) => {
          if (!tableReads.has(table)) tableReads.set(table, await store.readTable(table));
          return tableReads.get(table);
        };
        for (const listener of listeners) {
          if (listener.event === "postgres_changes" && listener.filter?.table) {
            const current = await readTable(listener.filter.table);
            const serialised = JSON.stringify(current);
            if (listener.lastSerialised === undefined) {
              listener.lastSerialised = serialised;
              listener.lastValue = current;
              continue;
            }
            if (serialised !== listener.lastSerialised) {
              const previous = listener.lastValue;
              listener.lastSerialised = serialised;
              listener.lastValue = current;
              try {
                listener.callback({
                  schema: listener.filter.schema || "public",
                  table: listener.filter.table,
                  eventType: listener.filter.event || "*",
                  new: current,
                  old: previous
                });
              } catch { /* A subscriber cannot break the polling loop. */ }
            }
          } else if (listener.event === "broadcast" && listener.filter?.event === "central_state_changed") {
            const rows = await readTable("downtime_central_bank");
            const row = rows.find(item => Number(item.id) === 1);
            const signal = row ? {
              version: Number(row.version) || 0,
              updated_at: row.updated_at || null
            } : { version: 0, updated_at: null };
            const serialised = JSON.stringify(signal);
            if (listener.lastSerialised === undefined) {
              listener.lastSerialised = serialised;
              continue;
            }
            if (serialised !== listener.lastSerialised) {
              listener.lastSerialised = serialised;
              try {
                listener.callback({
                  event: "central_state_changed",
                  payload: signal
                });
              } catch { /* A subscriber cannot break the polling loop. */ }
            }
          }
        }
      } catch { /* Temporary GitHub API failures are retried on the next poll. */ }
      finally { polling = false; }
    };
    const instance = {
      on(event, filter, callback) {
        if (typeof callback === "function") listeners.push({ event, filter, callback });
        return instance;
      },
      subscribe(callback) {
        if (typeof callback === "function") callback("SUBSCRIBED");
        void poll();
        if (timer === null && listeners.some(listener => listener.event === "postgres_changes" || listener.event === "broadcast")) {
          timer = globalThis.setInterval(poll, Math.max(50, pollIntervalMs));
        }
        return instance;
      },
      unsubscribe() {
        if (timer !== null) globalThis.clearInterval(timer);
        timer = null; listeners.length = 0; activeChannels.delete(instance);
        return Promise.resolve("ok");
      },
      send() { return Promise.resolve({ status: "ok" }); },
      topic: name
    };
    activeChannels.add(instance);
    return instance;
  };

  return Object.freeze({
    from: tables.from,
    storage,
    auth,
    functions,
    channel,
    async removeChannel(target) { await target?.unsubscribe?.(); return "ok"; },
    async dispose() { await Promise.all([...activeChannels].map(target => target.unsubscribe())); return true; },
    rpc: tables.rpc
  });
}
