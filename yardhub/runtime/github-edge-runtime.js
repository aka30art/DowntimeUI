import { GITHUB_YARDHUB_RPC_HANDLERS } from "../../src/infrastructure/github-rpc-handlers.js";
import { ensureGitHubDatabaseReady } from "../../src/infrastructure/github-database-bootstrap.js";

const DEFAULT_FUNCTIONS = [
  "central-bank",
  "central-config-admin",
  "gatelog-api",
  "photo-evidence",
  "repair-maintenance-api",
  "spectator-read",
  "yard-hub-settings-api"
];

export async function installGitHubEdgeRuntime({
  store,
  rpcHandlers = GITHUB_YARDHUB_RPC_HANDLERS,
  actorId = "YARDHUB-EDGE-SERVICE",
  env = {},
  functionNames = DEFAULT_FUNCTIONS,
  importFunction = (name) => import("./functions/" + name + ".js"),
  fetchImpl = globalThis.fetch
} = {}) {
  if (!store) throw new TypeError("A GitHub data store is required.");
  if (typeof store.ensureAuthority === "function") await store.ensureAuthority();
  const databaseStatus = await ensureGitHubDatabaseReady({ store });
  globalThis.__YARDHUB_BOOTSTRAP_CODE__ = databaseStatus.bootstrapCode || null;
  const handlers = globalThis.__YARDHUB_EDGE_HANDLERS__ || (globalThis.__YARDHUB_EDGE_HANDLERS__ = {});
  const previousDeno = globalThis.Deno;
  const previousFetch = globalThis.fetch;
  const previousSupabase = globalThis.supabase;
  const environment = {
    SUPABASE_URL: "https://github-native.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "github-native-service-adapter",
    DOWNTIME_IDENTITY_FINGERPRINT_SECRET: "github-native-fingerprint",
    DOWNTIME_CANONICAL_AUTH_READY: "true",
    GITHUB_STAFF_IMAGE_TOKEN: "github-native-storage",
    PHOTO_CLEANUP_SECRET: "github-native-cleanup",
    ...env
  };

  globalThis.Deno = {
    env: { get(name) { return Object.prototype.hasOwnProperty.call(environment, name) ? String(environment[name]) : undefined; } },
    serve(handler) {
      const name = globalThis.__YARDHUB_CURRENT_FUNCTION__;
      if (!name || typeof handler !== "function") throw new Error("A named GitHub-native function handler is required.");
      handlers[name] = handler;
    }
  };
  globalThis.__YARDHUB_GITHUB_COMPAT__ = {
    createClient() { return createCompatClient(); }
  };
  globalThis.supabase = {
    createClient() { return createCompatClient(); }
  };
  const { createGitHubSupabaseCompat } = await import("../../src/infrastructure/github-supabase-compat.js");
  const compatClients = new Set();
  function createCompatClient() {
    const client = createGitHubSupabaseCompat({
      store, actorId, rpcHandlers, handlers,
      sessionProvider: () => globalThis.DowntimeCentral?.session || null
    });
    compatClients.add(client);
    return client;
  }

  for (const name of functionNames) {
    globalThis.__YARDHUB_CURRENT_FUNCTION__ = name;
    await importFunction(name);
    if (typeof handlers[name] !== "function") throw new Error("YARDHUB service failed to register: " + name);
  }
  delete globalThis.__YARDHUB_CURRENT_FUNCTION__;

  const routePattern = /\/functions\/v1\/([a-z0-9-]+)(?:[/?#]|$)/i;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    const match = String(url || "").match(routePattern);
    const handler = match && handlers[match[1]];
    if (!handler) return fetchImpl(input, init);
    const request = input instanceof Request && !init ? input : new Request(url, init);
    return handler(request);
  };

  return {
    handlers,
    bootstrapCode: databaseStatus.bootstrapCode || null,
    bootstrapCodeExpiresAt: databaseStatus.bootstrapCodeExpiresAt || null,
    async dispose() {
      await Promise.all([...compatClients].map(client => client.dispose?.()));
      compatClients.clear();
      globalThis.fetch = previousFetch;
      if (previousDeno === undefined) delete globalThis.Deno;
      else globalThis.Deno = previousDeno;
      delete globalThis.__YARDHUB_GITHUB_COMPAT__;
      delete globalThis.__YARDHUB_CURRENT_FUNCTION__;
      globalThis.__YARDHUB_BOOTSTRAP_CODE__ = null;
      if (previousSupabase === undefined) delete globalThis.supabase;
      else globalThis.supabase = previousSupabase;
    }
  };
}
