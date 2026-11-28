import { GITHUB_YARDHUB_RPC_HANDLERS } from "../../src/infrastructure/github-rpc-handlers.js";
import { ensureGitHubDatabaseReady } from "../../src/infrastructure/github-database-bootstrap.js";
import { createGitHubStorageClient } from "../../src/infrastructure/github-storage-client.js";
import { createGitHubBrokerTransactionStore } from "../../src/infrastructure/github-supabase-compat.js";

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
    const transactionContext = globalThis.__YARDHUB_BROKER_TRANSACTION__;
    const activeStore = transactionContext ? createGitHubBrokerTransactionStore(transactionContext) : store;
    const client = createGitHubSupabaseCompat({
      store: activeStore, storageClient: sharedStorage, actorId, rpcHandlers, handlers,
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
      if (previousSharedStorage === undefined) delete globalThis.__YARDHUB_GITHUB_STORAGE__;
      else globalThis.__YARDHUB_GITHUB_STORAGE__ = previousSharedStorage;
      if (previousSupabase === undefined) delete globalThis.supabase;
      else globalThis.supabase = previousSupabase;
    }
  };
}


/**
 * Runs one preserved YARDHUB Edge action inside a single GitHub database
 * transaction. Table/RPC operations issued by the Supabase compatibility
 * clients share the same staged table snapshot and commit together.
 */
export async function executeGitHubEdgeAction({
  store,
  handlers,
  service,
  action,
  args = {},
  sessionToken = null,
  requestId,
  actorUserId = null,
  expectedAuthorityEpoch = null,
  now = () => new Date(),
  origin = "https://aka30art.github.io"
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A GitHub data store is required for broker execution.");
  }
  if (!handlers || typeof handlers[service] !== "function") {
    throw new Error("The requested YARDHUB service is not registered.");
  }
  if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new TypeError("A valid broker request ID is required for atomic execution.");
  }
  if (typeof action !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(action)) {
    throw new TypeError("A valid YARDHUB action is required.");
  }
  const blockedRuntimeActions = new Set([
    "central-bank:identity-reset",
    "central-bank:staff-original-upload",
    "central-bank:staff-photo-url",
    "central-bank:staff-photo-read",
    "photo-evidence:create-upload",
    "photo-evidence:view",
    "photo-evidence:cleanup",
    "repair-maintenance-api:upload",
    "repair-maintenance-api:export-create",
    "repair-maintenance-api:export-url"
  ]);
  if (blockedRuntimeActions.has(service + ":" + action)) {
    throw new Error("This source action is blocked in the GitHub twin because its protected-repository or binary transport path is not supported.");
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("YARDHUB action arguments must be an object.");
  }

  const baseline = await store.readDatabase();
  const previousContext = globalThis.__YARDHUB_BROKER_TRANSACTION__;
  let responseBody = null;
  let responseStatus = 500;
  try {
    const committed = await store.transactDatabase({
      expectedRevision: baseline.revision,
      expectedAuthorityEpoch,
      actorId: "YARDHUB-GITHUB-ACTIONS-BROKER",
      operationId: "broker-" + requestId,
      mutate: async tables => {
        if (expectedAuthorityEpoch !== null) {
          const currentAuthority = await store.readAuthority();
          if (!currentAuthority || currentAuthority.status !== "ACTIVE" ||
              currentAuthority.primarySystemId !== "DOWNTIMEUI-GITHUB" ||
              currentAuthority.epoch !== expectedAuthorityEpoch) {
            const error = new Error("YARDHUB authority changed before the broker action could commit.");
            error.status = 409;
            error.code = "BROKER_AUTHORITY_EPOCH_CHANGED";
            throw error;
          }
        }
        globalThis.__YARDHUB_BROKER_TRANSACTION__ = { tables, revision: baseline.revision };
        const headers = {
          origin,
          "content-type": "application/json"
        };
        if (sessionToken) headers["x-downtime-session"] = String(sessionToken);
        const request = new Request("https://github-native.invalid/functions/v1/" + service, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...args, action })
        });
        const response = await handlers[service](request);
        responseStatus = response.status;
        const raw = await response.text();
        try { responseBody = raw ? JSON.parse(raw) : null; } catch { responseBody = raw; }
        if (!response.ok) {
          const error = new Error(responseBody?.error || "YARDHUB action failed.");
          error.status = response.status;
          error.response = responseBody;
          throw error;
        }
        if (actorUserId) {
          const ledger = Array.isArray(tables.downtime_github_broker_requests)
            ? tables.downtime_github_broker_requests
            : [];
          const claim = ledger.find(row => row.request_id === requestId && row.actor_user_id === actorUserId);
          if (!claim || claim.state !== "PROCESSING") {
            throw new Error("The broker idempotency claim is missing or no longer active.");
          }
          claim.state = "COMMITTED";
          claim.committed_at = now().toISOString();
          claim.updated_at = now().toISOString();
          claim.lease_until = null;
        }
        return { status: responseStatus, body: responseBody };
      }
    });
    return { status: responseStatus, body: responseBody, revision: committed.revision, commitSha: committed.commitSha };
  } finally {
    if (previousContext === undefined) delete globalThis.__YARDHUB_BROKER_TRANSACTION__;
    else globalThis.__YARDHUB_BROKER_TRANSACTION__ = previousContext;
  }
}
