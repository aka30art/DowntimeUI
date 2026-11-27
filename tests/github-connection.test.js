import test from "node:test";
import assert from "node:assert/strict";
import {
  clearGitHubConnection,
  createConnectedGitHubStore,
  loadGitHubConnection,
  saveGitHubConnection
} from "../src/infrastructure/github-connection.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); }
  };
}

test("GitHub connection saves repository metadata separately from the session token", () => {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  const saved = saveGitHubConnection({
    owner: "aka30art", repo: "DowntimeUI", branch: "data/yardhub", token: "ghp-example-token"
  }, { storage, sessionStorage });
  assert.equal(saved.connected, true);
  assert.equal(loadGitHubConnection({ storage, sessionStorage }).connected, true);
  assert.equal(storage.snapshot()["downtimeui:github-data-connection:v1"].includes("ghp-example-token"), false);
  assert.equal(sessionStorage.snapshot()["downtimeui:github-data-token:session:v1"], "ghp-example-token");
});

test("GitHub connection rejects invalid settings and missing access tokens", () => {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  assert.throws(() => saveGitHubConnection({
    owner: "bad owner", repo: "DowntimeUI", branch: "data/yardhub", token: "token"
  }, { storage, sessionStorage }), /owner/);
  assert.throws(() => saveGitHubConnection({
    owner: "aka30art", repo: "DowntimeUI", branch: "data/yardhub", token: ""
  }, { storage, sessionStorage }), /access token/);
});

test("disconnect removes the configured repository and current-session token", () => {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  saveGitHubConnection({
    owner: "aka30art", repo: "DowntimeUI", branch: "data/yardhub", token: "ghp-example-token"
  }, { storage, sessionStorage });
  clearGitHubConnection({ storage, sessionStorage });
  assert.equal(loadGitHubConnection({ storage, sessionStorage }).connected, false);
});

test("a connected store cannot be created without a session token", () => {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  saveGitHubConnection({
    owner: "aka30art", repo: "DowntimeUI", branch: "data/yardhub", token: "ghp-example-token"
  }, { storage, sessionStorage });
  clearGitHubConnection({ storage, sessionStorage });
  assert.throws(() => createConnectedGitHubStore({ storage, sessionStorage, fetchImpl: async () => {} }), /access token/);
});
