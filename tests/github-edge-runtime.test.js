import test from "node:test";
import assert from "node:assert/strict";
import { installGitHubEdgeRuntime } from "../yardhub/runtime/github-edge-runtime.js";

function createMemoryStore() {
  let revision = 0;
  const objects = new Map();
  let tables = {
    downtime_central_bank: [{ id: 1, version: 1, payload: { users: [], staff: {}, appData: {} } }],
    downtime_central_sessions: [],
    downtime_central_audit: [],
    downtime_central_config_state: [{ id: 1, draft_version: 1, published_version: 1, next_version: 2, draft_payload: {}, published_payload: {} }],
    downtime_central_config_history: []
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
    async uploadObject({ bucket, path, data, mimeType }) {
      const key = bucket + "/" + path;
      const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data || []);
      objects.set(key, { bytes, mimeType: mimeType || "application/octet-stream" });
      return { path, size: bytes.byteLength, mimeType };
    },
    async downloadObject({ bucket, path }) {
      const item = objects.get(bucket + "/" + path);
      if (!item) { const error = new Error("Object not found"); error.status = 404; throw error; }
      return { bytes: new Uint8Array(item.bytes), mimeType: item.mimeType };
    },
    async deleteObject({ bucket, path }) {
      const deleted = objects.delete(bucket + "/" + path);
      return { deleted, bucket, path };
    },
    async createSignedObjectUrl() { return "https://github-native.invalid/test-object"; },
    async readObjectMetadata({ bucket, path }) {
      const item = objects.get(bucket + "/" + path);
      return item ? { size: item.bytes.byteLength, mimeType: item.mimeType } : null;
    },
    async readObjectBytes({ bucket, path }) {
      const item = objects.get(bucket + "/" + path);
      return item ? new Uint8Array(item.bytes) : null;
    }
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


test("first-run DEV bootstrap signs in and authorises protected YARDHUB module services", async () => {
  const store = createMemoryStore();
  const previousFetch = globalThis.fetch;
  const previousSession = globalThis.DowntimeCentral;
  const previousBootstrapCode = globalThis.__YARDHUB_BOOTSTRAP_CODE__;
  const runtime = await installGitHubEdgeRuntime({ store });
  const request = async (name, body, token = null) => {
    const headers = {
      origin: "https://aka30art.github.io",
      "content-type": "application/json"
    };
    if (token) headers["x-downtime-session"] = token;
    return globalThis.fetch("https://github-native.invalid/functions/v1/" + name, {
      method: "POST", headers, body: JSON.stringify(body)
    });
  };

  try {
    const setupCode = runtime.bootstrapCode;
    assert.match(setupCode, /^[A-F0-9]{48}$/);

    const bootstrapResponse = await request("central-bank", {
      action: "bootstrap", bootstrapCode: setupCode, username: "DEV", pin: "4826"
    });
    assert.equal(bootstrapResponse.status, 200);
    const bootstrapResult = await bootstrapResponse.json();
    assert.equal(bootstrapResult.ok, true);

    const persisted = await store.readDatabase();
    const root = persisted.tables.downtime_roots_bootstrap.find(row => row.singleton === true);
    const dev = persisted.tables.downtime_central_bank[0].payload.users.find(user => user.username === "DEV");
    assert.ok(root?.user_id);
    assert.equal(dev?.userId, root.user_id, "DEV must be bound to the immutable ROOTS bootstrap UUID");
    assert.equal(dev?.tier, "OWNER");
    assert.equal(persisted.tables.downtime_roots_bootstrap[0].bootstrap_code_hash, root.bootstrap_code_hash);

    const listResponse = await request("central-bank", { action: "list-users" });
    assert.equal(listResponse.status, 200);
    assert.deepEqual((await listResponse.json()).users.map(user => user.username), ["DEV"]);

    const loginResponse = await request("central-bank", { action: "login", username: "DEV", pin: "4826" });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    assert.ok(login.token);
    assert.equal(login.user.username, "DEV");

    const centralStateResponse = await request("central-bank", { action: "get-state" }, login.token);
    assert.equal(centralStateResponse.status, 200);
    assert.ok((await centralStateResponse.json()).payload);

    const rmResponse = await request("repair-maintenance-api", { action: "access" }, login.token);
    assert.equal(rmResponse.status, 200);
    const rmAccess = await rmResponse.json();
    assert.equal(rmAccess.user.username, "DEV");
    assert.equal(rmAccess.permissions.canAccessRepairMaintenance, true);
    assert.equal(rmAccess.permissions.canManageRepairMaintenanceMachinery, true);

    const trafficResponse = await request("gatelog-api", { action: "bootstrap" }, login.token);
    assert.equal(trafficResponse.status, 200);
    const traffic = await trafficResponse.json();
    assert.equal(traffic.canInputTraffic, true);
    assert.equal(traffic.canManageGateman, true);
    assert.ok(Array.isArray(traffic.customers));
    assert.ok(Array.isArray(traffic.wasteTypes));

    const settingsResponse = await request("yard-hub-settings-api", { action: "my-access" }, login.token);
    assert.equal(settingsResponse.status, 200);
    const settings = await settingsResponse.json();
    assert.ok(settings && typeof settings === "object");
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

test("Edge Function and browser clients share one-time GitHub storage upload tickets", async () => {
  const store = createMemoryStore();
  const previousFetch = globalThis.fetch;
  const runtime = await installGitHubEdgeRuntime({ store, functionNames: [] });
  try {
    const edgeClient = globalThis.__YARDHUB_GITHUB_COMPAT__.createClient();
    const browserClient = globalThis.supabase.createClient();
    assert.equal(edgeClient.storage, browserClient.storage);
    const ticket = await edgeClient.storage.from("downtime-evidence").createSignedUploadUrl(
      "2026-11-27/evidence.jpg",
      { contentType: "image/jpeg", size: 3 }
    );
    assert.equal(ticket.error, null);
    const result = await browserClient.storage.from("downtime-evidence").uploadToSignedUrl(
      ticket.data.path, ticket.data.token,
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      { contentType: "image/jpeg" }
    );
    assert.equal(result.error, null);
    assert.equal(result.data.path, "2026-11-27/evidence.jpg");
  } finally {
    await runtime.dispose();
    globalThis.fetch = previousFetch;
  }
});


test("Central Config admin reads the published YARDHUB launcher and photo-evidence uploads use private Storage tickets", async () => {
  const store = createMemoryStore();
  const originalFetch = globalThis.fetch;
  const previousSession = globalThis.DowntimeCentral;
  const runtime = await installGitHubEdgeRuntime({ store });
  const request = async (name, body, token = null) => {
    const headers = {
      origin: "https://aka30art.github.io",
      "content-type": "application/json"
    };
    if (token) headers["x-downtime-session"] = token;
    return globalThis.fetch("https://github-native.invalid/functions/v1/" + name, {
      method: "POST", headers, body: JSON.stringify(body)
    });
  };

  try {
    const bootstrapResponse = await request("central-bank", {
      action: "bootstrap", bootstrapCode: runtime.bootstrapCode, username: "DEV", pin: "4826"
    });
    assert.equal(bootstrapResponse.status, 200);
    const loginResponse = await request("central-bank", { action: "login", username: "DEV", pin: "4826" });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();

    const menuResponse = await request("central-config-admin", { action: "yard-hub-menu" }, login.token);
    assert.equal(menuResponse.status, 200);
    const menu = await menuResponse.json();
    assert.ok(menu.yardHubMenu.departments.some(item => item.id === "downtime"));
    assert.ok(menu.repairMaintenanceCategories.categories.some(item => item.key === "OTHER_EQUIPMENT"));

    const entryKey = "00000000-0000-4000-8000-000000000001";
    const recordId = "00000000-0000-4000-8000-000000000002";
    const uploadResponse = await request("photo-evidence", {
      action: "create-upload", entryKey, recordId, mimeType: "image/jpeg", size: 3
    }, login.token);
    assert.equal(uploadResponse.status, 200);
    const upload = await uploadResponse.json();
    assert.ok(upload.attachmentId);
    assert.ok(upload.token);
    assert.match(upload.path, new RegExp("^" + entryKey + "/"));

    const browserClient = globalThis.supabase.createClient();
    const uploaded = await browserClient.storage.from("downtime-evidence").uploadToSignedUrl(
      upload.path, upload.token,
      new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
      { contentType: "image/jpeg" }
    );
    assert.equal(uploaded.error, null);
    assert.equal(uploaded.data.path, upload.path);

    const current = await store.readDatabase();
    await store.transactDatabase({
      expectedRevision: current.revision,
      actorId: "runtime-test",
      mutate(tables) {
        const bank = tables.downtime_central_bank.find(row => Number(row.id) === 1);
        bank.payload.appData ||= {};
        bank.payload.appData.weeks ||= {};
        bank.payload.appData.weeks["2026-11-23"] = {
          days: [{
            date: "2026-11-23",
            entries: [{ recordId, attachmentId: upload.attachmentId }]
          }]
        };
      }
    });
    const viewResponse = await request("photo-evidence", {
      action: "view", attachmentId: upload.attachmentId
    }, login.token);
    assert.equal(viewResponse.status, 200);
    const view = await viewResponse.json();
    assert.ok(view.url);
    assert.equal(view.expiresIn, 60);

    const deleteResponse = await request("photo-evidence", {
      action: "delete", attachmentId: upload.attachmentId
    }, login.token);
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).ok, true);
  } finally {
    await runtime.dispose();
    globalThis.fetch = originalFetch;
    if (previousSession === undefined) delete globalThis.DowntimeCentral;
    else globalThis.DowntimeCentral = previousSession;
  }
});
