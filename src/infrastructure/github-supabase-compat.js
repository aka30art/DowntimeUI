import { createGitHubTableClient } from "./github-table-client.js";
import { createGitHubStorageClient } from "./github-storage-client.js";

function makeResponseError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function createGitHubSupabaseCompat({
  store,
  actorId = "YARDHUB-EDGE-SERVICE",
  rpcHandlers = {},
  handlers = globalThis.__YARDHUB_EDGE_HANDLERS__ || {},
  sessionProvider = () => globalThis.DowntimeCentral?.session || null,
  originProvider = () => globalThis.location?.origin || "https://aka30art.github.io",
  pollIntervalMs = 15000
} = {}) {
  if (!store) throw new TypeError("A GitHub data store is required.");
  const tables = createGitHubTableClient({ store, actorId, rpcHandlers });
  const storage = createGitHubStorageClient({ store });

  const auth = {
    async getSession() {
      const current = sessionProvider();
      return { data: { session: current ? { access_token: current.token, user: current.user || null } : null }, error: null };
    },
    async signInAnonymously() {
      const current = sessionProvider();
      return { data: { session: { access_token: current?.token || "github-native-local-session", user: current?.user || null } }, error: null };
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

  const channel = (name) => {
    const listeners = [];
    let timer = null, polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        for (const listener of listeners) {
          if (listener.event !== "postgres_changes" || !listener.filter?.table) continue;
          const current = await store.readTable(listener.filter.table);
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
        if (timer === null && listeners.some(listener => listener.event === "postgres_changes")) {
          timer = globalThis.setInterval(poll, Math.max(5000, pollIntervalMs));
        }
        return instance;
      },
      unsubscribe() {
        if (timer !== null) globalThis.clearInterval(timer);
        timer = null; listeners.length = 0;
        return Promise.resolve("ok");
      },
      send() { return Promise.resolve({ status: "ok" }); },
      topic: name
    };
    return instance;
  };

  return Object.freeze({
    from: tables.from,
    storage,
    auth,
    functions,
    channel,
    async removeChannel(target) { await target?.unsubscribe?.(); return "ok"; },
    rpc: tables.rpc
  });
}
