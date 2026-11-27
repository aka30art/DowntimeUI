import { createGitHubDataStore, GitHubStoreError } from "./github-data-store.js";
import { createGitHubTableClient } from "./github-table-client.js";
import { createGitHubStorageClient } from "./github-storage-client.js";

export const DEFAULT_GITHUB_DATA_CONNECTION = Object.freeze({
  owner: "aka30art",
  repo: "",
  branch: "main"
});

const CONNECTION_KEY = "downtimeui:github-data-connection:v2";
const FORBIDDEN_REPOSITORIES = new Set([
  "aka30art/downtimeui",
  "aka30art/downtime"
]);

// A token is never written to localStorage or sessionStorage. It exists only
// in this module's memory and must be re-entered after a reload.
let activeToken = null;

function safeStorage(storage) {
  return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function" ? storage : null;
}

function normaliseRepository(owner, repo) {
  return (String(owner || "").trim() + "/" + String(repo || "").trim()).toLowerCase();
}

export function loadGitHubConnection({ storage = globalThis.localStorage } = {}) {
  const configStore = safeStorage(storage);
  let saved = {};
  try {
    const raw = configStore?.getItem(CONNECTION_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch { saved = {}; }
  return {
    owner: String(saved.owner || DEFAULT_GITHUB_DATA_CONNECTION.owner),
    repo: String(saved.repo || DEFAULT_GITHUB_DATA_CONNECTION.repo),
    branch: String(saved.branch || DEFAULT_GITHUB_DATA_CONNECTION.branch),
    connected: Boolean(activeToken)
  };
}

export function saveGitHubConnection(connection, {
  storage = globalThis.localStorage
} = {}) {
  if (!connection || typeof connection !== "object") throw new TypeError("GitHub connection settings are required.");
  const owner = String(connection.owner || "").trim();
  const repo = String(connection.repo || "").trim();
  const branch = String(connection.branch || "").trim();
  const token = String(connection.token || "").trim();
  if (!/^[A-Za-z0-9-]+$/.test(owner)) throw new TypeError("Enter a valid GitHub owner.");
  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) throw new TypeError("Enter a valid GitHub repository.");
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new TypeError("Enter a valid GitHub data branch.");
  if (!token) throw new TypeError("Enter a GitHub access token.");
  if (FORBIDDEN_REPOSITORIES.has(normaliseRepository(owner, repo))) {
    throw new GitHubStoreError("The application source and protected DOWNTIME repositories cannot be used as operational data stores.", 403);
  }
  const configStore = safeStorage(storage);
  if (!configStore) throw new Error("Browser storage is unavailable.");
  const config = { owner, repo, branch };
  configStore.setItem(CONNECTION_KEY, JSON.stringify(config));
  activeToken = token;
  return { ...config, connected: true };
}

export function clearGitHubConnection({ storage = globalThis.localStorage } = {}) {
  try { safeStorage(storage)?.removeItem(CONNECTION_KEY); } catch { /* Ignore unavailable storage. */ }
  activeToken = null;
  return true;
}

async function verifyPrivateRepository({ owner, repo, token, fetchImpl }) {
  const fullName = normaliseRepository(owner, repo);
  if (FORBIDDEN_REPOSITORIES.has(fullName)) {
    throw new GitHubStoreError("Use a dedicated private data repository. The DOWNTIME and DOWNTIMEUI code repositories are blocked.", 403);
  }
  let response;
  try {
    response = await fetchImpl("https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo), {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
  } catch {
    throw new GitHubStoreError("GitHub repository privacy could not be verified. Check the connection and try again.");
  }
  let metadata = null;
  try {
    metadata = typeof response.json === "function"
      ? await response.json()
      : JSON.parse(await response.text());
  } catch {
    throw new GitHubStoreError("GitHub returned unreadable repository metadata.", response.status || 0);
  }
  if (!response.ok) {
    throw new GitHubStoreError(metadata?.message || "GitHub repository access could not be verified.", response.status);
  }
  if (metadata?.private !== true) {
    throw new GitHubStoreError("The operational data repository must be PRIVATE. No data connection was opened.", 403);
  }
  if (metadata?.full_name && metadata.full_name.toLowerCase() !== fullName) {
    throw new GitHubStoreError("GitHub returned a different repository identity than the one configured.", 403);
  }
  return metadata;
}

export function createConnectedGitHubStore({
  storage = globalThis.localStorage,
  systemId = "DOWNTIMEUI-GITHUB",
  fetchImpl = globalThis.fetch
} = {}) {
  const configStore = safeStorage(storage);
  if (!configStore) throw new Error("Browser storage is unavailable.");
  const saved = loadGitHubConnection({ storage: configStore });
  const token = activeToken;
  if (!token) throw new Error("Enter a GitHub access token to connect. Tokens are memory-only and must be re-entered after a reload.");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  return verifyPrivateRepository({ owner: saved.owner, repo: saved.repo, token, fetchImpl }).then(() =>
    createGitHubDataStore({
      owner: saved.owner, repo: saved.repo, branch: saved.branch,
      token, systemId, fetchImpl
    })
  );
}

export async function createConnectedGitHubServices({
  storage = globalThis.localStorage,
  systemId = "DOWNTIMEUI-GITHUB",
  fetchImpl = globalThis.fetch,
  actorId = "LOCAL-OPERATOR"
} = {}) {
  const store = await createConnectedGitHubStore({ storage, systemId, fetchImpl });
  return Object.freeze({
    store,
    database: createGitHubTableClient({ store, actorId }),
    storage: createGitHubStorageClient({ store })
  });
}
