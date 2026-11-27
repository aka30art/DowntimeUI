import test from "node:test";
import assert from "node:assert/strict";
import { installGitHubEdgeRuntime } from "../yardhub/runtime/github-edge-runtime.js";

function createMemoryStore() {
  let revision = 0;
  let tables = {
    downtime_central_bank: [{ id: 1, version: 1, payload: { users: [], staff: {}, appData: {} } }],
    downtime_central_sessions: [],
    downtime_central_audit: []
  };
  return {
    async readDatabase() {
      return { revision, tables: structuredClone(tables), manifest: { revision } };
    },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== revision) {
        const error = new Error("VERSION_CONFLICT");
        error.status = 409;
        throw error;
      }
      const draft = structuredClone(tables);
      const result = await mutate(draft);
      tables = draft;
      revision += 1;
      return { committed: true, revision, result, commitSha: "runtime-test-" + revision };
    },
    async uploadObject({ path, bytes, mimeType }) {
      return { path, size: bytes?.length || 0, mimeType };
    },
    async downloadObject() { return null; },
    async deleteObject() { return true; },
    async createSignedObjectUrl() { return "https://github-native.invalid/test-object"; },
    async readObjectMetadata() { return null; },
    async readObjectBytes() { return null; }
  };
}

test("all seven YARDHUB GitHub-native Edge services register and answer local CORS preflight", async () => {
  const store = createMemoryStore();
  const previousFetch = globalThis.fetch;
  const previousSession = globalThis.DowntimeCentral;
  const previousBootstrapCode = globalThis.__YARDHUB_BOOTSTRAP_CODE__;
  const runtime = await installGitHubEdgeRuntime({ store });
  assert.match(runtime.bootstrapCode, /^[A-F0-9]{48}$/);
  assert.equal(globalThis.__YARDHUB_BOOTSTRAP_CODE__, runtime.bootstrapCode);

  try {
    const expected = [
      "central-bank", "central-config-admin", "gatelog-api",
      "photo-evidence", "repair-maintenance-api", "spectator-read",
      "yard-hub-settings-api"
    ];
    assert.deepEqual(Object.keys(runtime.handlers).sort(), expected.slice().sort());

    for (const name of expected) {
      const response = await globalThis.fetch(
        "https://ygwfipksbbprqynvbklk.supabase.co/functions/v1/" + name,
        {
          method: "OPTIONS",
          headers: { origin: "https://aka30art.github.io" }
        }
      );
      assert.ok(response instanceof Response, name + " must route to a local Response.");
      assert.equal(response.status, 200, name + " CORS preflight must succeed.");
    }
  } finally {
    await runtime.dispose();
    assert.equal(globalThis.__YARDHUB_BOOTSTRAP_CODE__, null);
    if (previousBootstrapCode === undefined) delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    else globalThis.__YARDHUB_BOOTSTRAP_CODE__ = previousBootstrapCode;
    globalThis.fetch = previousFetch;
    if (previousSession === undefined) delete globalThis.DowntimeCentral;
    else globalThis.DowntimeCentral = previousSession;
  }
});

test("GitHub-native runtime restores global fetch and Deno hooks on dispose", async () => {
  const store = createMemoryStore();
  const originalFetch = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  const runtime = await installGitHubEdgeRuntime({ store, functionNames: ["central-bank"] });
  assert.notEqual(globalThis.fetch, originalFetch);
  assert.ok(globalThis.Deno);
  await runtime.dispose();
  assert.equal(globalThis.fetch, originalFetch);
  if (originalDeno === undefined) assert.equal(globalThis.Deno, undefined);
  else assert.equal(globalThis.Deno, originalDeno);
});
