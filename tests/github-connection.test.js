import test from "node:test";
import assert from "node:assert/strict";
import {
  clearGitHubConnection,
  createConnectedGitHubStore,
  createPrivateGitHubDataRepository,
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

function privateRepoFetch(metadata = { private: true, full_name: "example/yardhub-data" }) {
  return async (url, options = {}) => {
    assert.equal(url, "https://api.github.com/repos/example/yardhub-data");
    assert.equal(options.method, "GET");
    assert.match(options.headers.Authorization, /^Bearer /);
    return { ok: true, status: 200, async json() { return metadata; } };
  };
}

function configure(storage, sessionStorage, overrides = {}) {
  return saveGitHubConnection({
    owner: "example", repo: "yardhub-data", branch: "main", token: "github-token-memory-only",
    ...overrides
  }, { storage, sessionStorage });
}

test("connection settings are persisted without writing the token to browser storage", () => {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  clearGitHubConnection({ storage });
  const saved = configure(storage, sessionStorage);
  assert.equal(saved.connected, true);
  assert.equal(loadGitHubConnection({ storage }).connected, true);
  assert.equal(JSON.stringify(storage.snapshot()).includes("github-token-memory-only"), false);
  assert.deepEqual(sessionStorage.snapshot(), {});
  assert.equal(loadGitHubConnection({ storage }).repo, "yardhub-data");
  clearGitHubConnection({ storage });
  assert.equal(loadGitHubConnection({ storage }).connected, false);
});

test("connection rejects invalid settings, missing tokens and protected source repositories", () => {
  const storage = memoryStorage();
  assert.throws(() => saveGitHubConnection({
    owner: "bad owner", repo: "yardhub-data", branch: "main", token: "token"
  }, { storage }), /owner/);
  assert.throws(() => saveGitHubConnection({
    owner: "example", repo: "yardhub-data", branch: "main", token: ""
  }, { storage }), /access token/);
  assert.throws(() => saveGitHubConnection({
    owner: "aka30art", repo: "DOWNTIME", branch: "main", token: "token"
  }, { storage }), /protected DOWNTIME/);
  assert.throws(() => saveGitHubConnection({
    owner: "aka30art", repo: "DowntimeUI", branch: "main", token: "token"
  }, { storage }), /protected DOWNTIME/);
});

test("disconnect removes repository settings and the in-memory token", () => {
  const storage = memoryStorage();
  configure(storage, memoryStorage());
  clearGitHubConnection({ storage });
  assert.equal(loadGitHubConnection({ storage }).connected, false);
  assert.equal(loadGitHubConnection({ storage }).repo, "");
});

test("connection refuses a public repository before opening the data store", async () => {
  const storage = memoryStorage();
  clearGitHubConnection({ storage });
  configure(storage, memoryStorage());
  await assert.rejects(
    createConnectedGitHubStore({
      storage,
      fetchImpl: privateRepoFetch({ private: false, full_name: "example/yardhub-data" })
    }),
    (error) => error.status === 403 && /must be PRIVATE/.test(error.message)
  );
  clearGitHubConnection({ storage });
});

test("connection verifies the exact private repository before creating a store", async () => {
  const storage = memoryStorage();
  clearGitHubConnection({ storage });
  configure(storage, memoryStorage());
  const store = await createConnectedGitHubStore({
    storage,
    fetchImpl: privateRepoFetch()
  });
  assert.equal(typeof store.readAuthority, "function");
  clearGitHubConnection({ storage });
});

test("connection rejects a repository identity mismatch", async () => {
  const storage = memoryStorage();
  clearGitHubConnection({ storage });
  configure(storage, memoryStorage());
  await assert.rejects(
    createConnectedGitHubStore({
      storage,
      fetchImpl: privateRepoFetch({ private: true, full_name: "someone-else/yardhub-data" })
    }),
    (error) => error.status === 403 && /different repository identity/.test(error.message)
  );
  clearGitHubConnection({ storage });
});

test("first-run setup creates only the exact private GitHub data repository", async () => {
  const storage = memoryStorage();
  clearGitHubConnection({ storage });
  let requestBody = null;
  const result = await createPrivateGitHubDataRepository({
    owner: "example", repo: "yardhub-data", token: "create-repo-token",
    storage,
    fetchImpl: async (url, options) => {
      if (url === "https://api.github.com/user") {
        assert.equal(options.method, "GET");
        return { ok: true, status: 200, async json() { return { login: "example" }; } };
      }
      assert.equal(url, "https://api.github.com/user/repos");
      assert.equal(options.method, "POST");
      assert.match(options.headers.Authorization, /^Bearer /);
      requestBody = JSON.parse(options.body);
      return {
        ok: true, status: 201,
        async json() {
          return {
            private: true,
            full_name: "example/yardhub-data",
            default_branch: "main",
            html_url: "https://github.com/example/yardhub-data"
          };
        }
      };
    }
  });
  assert.equal(requestBody.private, true);
  assert.equal(result.private, true);
  assert.equal(result.fullName, "example/yardhub-data");
  assert.equal(loadGitHubConnection({ storage }).connected, true);
  assert.equal(JSON.stringify(storage.snapshot()).includes("create-repo-token"), false);
  clearGitHubConnection({ storage });
});

test("first-run setup rejects a repository that GitHub reports as public or mismatched", async () => {
  const storage = memoryStorage();
  clearGitHubConnection({ storage });
  await assert.rejects(
    createPrivateGitHubDataRepository({
      owner: "example", repo: "yardhub-data", token: "create-repo-token", storage,
      fetchImpl: async () => ({
        ok: true, status: 201,
        async json() { return { private: false, full_name: "example/yardhub-data", default_branch: "main" }; }
      })
    }),
    (error) => error.status === 403 && /exact requested private repository/.test(error.message)
  );
  assert.equal(loadGitHubConnection({ storage }).connected, false);
});

test("first-run setup refuses to create a repository under a different token owner", async () => {
  const storage = memoryStorage();
  clearGitHubConnection({ storage });
  let creationAttempted = false;
  await assert.rejects(
    createPrivateGitHubDataRepository({
      owner: "example", repo: "yardhub-data", token: "wrong-owner-token", storage,
      fetchImpl: async (url) => {
        if (url === "https://api.github.com/user") {
          return { ok: true, status: 200, async json() { return { login: "someone-else" }; } };
        }
        creationAttempted = true;
        throw new Error("Repository creation must not be attempted.");
      }
    }),
    (error) => error.status === 403 && /must belong to the configured owner/.test(error.message)
  );
  assert.equal(creationAttempted, false);
  assert.equal(loadGitHubConnection({ storage }).connected, false);
});
