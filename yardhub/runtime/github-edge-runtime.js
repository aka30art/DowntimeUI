import { GITHUB_YARDHUB_RPC_HANDLERS } from "../../src/infrastructure/github-rpc-handlers.js";
import { ensureGitHubDatabaseReady } from "../../src/infrastructure/github-database-bootstrap.js";
import { createGitHubStorageClient } from "../../src/infrastructure/github-storage-client.js";

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
  offline = false,
  functionNames = DEFAULT_FUNCTIONS,
  importFunction = (name) => import("./functions/" + name + ".js"),
  fetchImpl = globalThis.fetch
} = {}) {
  if (!store) throw new TypeError("A GitHub data store is required.");
  if (typeof store.ensureAuthority === "function") await store.ensureAuthority();
  let databaseStatus;
  if (offline) {
    const cached = await store.readDatabase();
    if (!cached?.manifest || !cached?.tables) throw new Error("No cached YARDHUB database is available for offline viewing.");
    databaseStatus = { bootstrapCode: null, bootstrapCodeExpiresAt: null, offline: true };
  } else {
    databaseStatus = await ensureGitHubDatabaseReady({ store });
  }
  const previousOffline = globalThis.__YARDHUB_GITHUB_OFFLINE__;
  globalThis.__YARDHUB_GITHUB_OFFLINE__ = Boolean(offline);
  globalThis.__YARDHUB_BOOTSTRAP_CODE__ = databaseStatus.bootstrapCode || null;
  const handlers = globalThis.__YARDHUB_EDGE_HANDLERS__ || (globalThis.__YARDHUB_EDGE_HANDLERS__ = {});
  const previousSharedStorage = globalThis.__YARDHUB_GITHUB_STORAGE__;
  const sharedStorage = createGitHubStorageClient({ store });
  globalThis.__YARDHUB_GITHUB_STORAGE__ = sharedStorage;
  const previousDeno = globalThis.Deno;
  const previousFetch = globalThis.fetch;
  const previousSupabase = globalThis.supabase;
  // This is a local compatibility harness, not a trusted production broker.
  // The adapter marker is deliberately not a credential. Secret-bearing source
  // features remain unavailable unless explicitly supplied by an isolated test.
  const environment = {
    SUPABASE_URL: "https://github-native.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "GITHUB_NATIVE_COMPAT_ADAPTER",
    DOWNTIME_CANONICAL_AUTH_READY: "false",
    YARDHUB_OFFLINE_MODE: offline ? "true" : "false",
    ...env
  };

  globalThis.Deno = {
    env: { get(name) {
      if (!Object.prototype.hasOwnProperty.call(environment, name) || environment[name] == null) return undefined;
      return String(environment[name]);
    } },
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
      store, storageClient: sharedStorage, actorId, rpcHandlers, handlers,
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
  const storageUploadPattern = /\/storage-upload\//i;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    const request = input instanceof Request && !init ? input : new Request(url, init);
    if (storageUploadPattern.test(String(url || ""))) return sharedStorage.handleSignedUploadRequest(request);
    const match = String(url || "").match(routePattern);
    const handler = match && handlers[match[1]];
    if (!handler) return fetchImpl(input, init);
    try { return await handler(request); }
    catch (error) {
      if (offline) return new Response(JSON.stringify({ error: "OFFLINE — cached data is read-only. This change was not saved to GitHub." }), { status: 503, headers: { "Content-Type": "application/json" } });
      throw error;
    }
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
      if (previousOffline === undefined) delete globalThis.__YARDHUB_GITHUB_OFFLINE__;
      else globalThis.__YARDHUB_GITHUB_OFFLINE__ = previousOffline;
      if (previousSharedStorage === undefined) delete globalThis.__YARDHUB_GITHUB_STORAGE__;
      else globalThis.__YARDHUB_GITHUB_STORAGE__ = previousSharedStorage;
      if (previousSupabase === undefined) delete globalThis.supabase;
      else globalThis.supabase = previousSupabase;
    }
  };
}

