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
  originProvider = () => globalThis.location?.origin || "https://aka30art.github.io"
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
    const instance = {
      on(event, filter, callback) {
        if (typeof callback === "function") listeners.push({ event, filter, callback });
        return instance;
      },
      subscribe(callback) {
        if (typeof callback === "function") callback("SUBSCRIBED");
        return instance;
      },
      unsubscribe() { listeners.length = 0; return Promise.resolve("ok"); },
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
