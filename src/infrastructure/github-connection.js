import { createGitHubDataStore } from "./github-data-store.js";

export const DEFAULT_GITHUB_DATA_CONNECTION = Object.freeze({
  owner: "aka30art",
  repo: "DowntimeUI",
  branch: "data/yardhub"
});

const CONNECTION_KEY = "downtimeui:github-data-connection:v1";
const TOKEN_KEY = "downtimeui:github-data-token:session:v1";

function safeStorage(storage) {
  return storage && typeof storage.getItem === "function" && typeof storage.setItem === "function" ? storage : null;
}

export function loadGitHubConnection({
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage
} = {}) {
  const configStore = safeStorage(storage);
  const tokenStore = safeStorage(sessionStorage);
  let saved = {};
  try {
    const raw = configStore?.getItem(CONNECTION_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch { saved = {}; }
  let hasToken = false;
  try { hasToken = Boolean(tokenStore?.getItem(TOKEN_KEY)); } catch { hasToken = false; }
  return {
    owner: String(saved.owner || DEFAULT_GITHUB_DATA_CONNECTION.owner),
    repo: String(saved.repo || DEFAULT_GITHUB_DATA_CONNECTION.repo),
    branch: String(saved.branch || DEFAULT_GITHUB_DATA_CONNECTION.branch),
    connected: hasToken
  };
}

export function saveGitHubConnection(connection, {
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage
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
  const configStore = safeStorage(storage);
  const tokenStore = safeStorage(sessionStorage);
  if (!configStore || !tokenStore) throw new Error("Browser storage is unavailable.");
  const config = { owner, repo, branch };
  configStore.setItem(CONNECTION_KEY, JSON.stringify(config));
  tokenStore.setItem(TOKEN_KEY, token);
  return { ...config, connected: true };
}

export function clearGitHubConnection({
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage
} = {}) {
  try { safeStorage(storage)?.removeItem(CONNECTION_KEY); } catch { /* Ignore unavailable storage. */ }
  try { safeStorage(sessionStorage)?.removeItem(TOKEN_KEY); } catch { /* Ignore unavailable storage. */ }
  return true;
}

export function createConnectedGitHubStore({
  storage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
  systemId = "DOWNTIMEUI-GITHUB",
  fetchImpl = globalThis.fetch
} = {}) {
  const configStore = safeStorage(storage);
  const tokenStore = safeStorage(sessionStorage);
  if (!configStore || !tokenStore) throw new Error("Browser storage is unavailable.");
  const saved = loadGitHubConnection({ storage: configStore, sessionStorage: tokenStore });
  const token = tokenStore.getItem(TOKEN_KEY);
  if (!token) throw new Error("Connect a GitHub access token first.");
  return createGitHubDataStore({
    owner: saved.owner, repo: saved.repo, branch: saved.branch,
    token, systemId, fetchImpl
  });
}
