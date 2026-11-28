import test from "node:test";
import assert from "node:assert/strict";
import { installGitHubEdgeRuntime, executeGitHubEdgeAction } from "../yardhub/runtime/github-edge-runtime.js";

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
  assert.equal(globalThis.Deno.env.get("DOWNTIME_CANONICAL_AUTH_READY"), "false");
  assert.equal(globalThis.Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "GITHUB_NATIVE_COMPAT_ADAPTER");
  assert.equal(globalThis.Deno.env.get("DOWNTIME_IDENTITY_FINGERPRINT_SECRET"), undefined);
  assert.equal(globalThis.Deno.env.get("GITHUB_STAFF_IMAGE_TOKEN"), undefined);
  assert.equal(globalThis.Deno.env.get("PHOTO_CLEANUP_SECRET"), undefined);
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

test("Edge Function and browser compatibility clients fail closed for unsupported signed binary uploads", async () => {
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
    assert.equal(ticket.data, null);
    assert.match(ticket.error.message, /binary upload transport is not implemented/);
    const download = await browserClient.storage.from("downtime-evidence").createSignedUrl("2026-11-27/evidence.jpg");
    assert.equal(download.data, null);
    assert.match(download.error.message, /binary download transport is not implemented/);
  } finally {
    await runtime.dispose();
    globalThis.fetch = previousFetch;
  }
});


test("Central Config admin reads the published YARDHUB launcher and photo-evidence upload fails closed without browser transport", async () => {
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
    assert.equal(uploadResponse.status, 500);
    const uploadError = await uploadResponse.json();
    assert.match(uploadError.error, /binary upload transport is not implemented/);
    const after = await store.readDatabase();
    assert.equal((after.tables.downtime_attachments || []).length, 0, "failed upload setup must not create attachment metadata");
  } finally {
    await runtime.dispose();
    globalThis.fetch = originalFetch;
    if (previousSession === undefined) delete globalThis.DowntimeCentral;
    else globalThis.DowntimeCentral = previousSession;
  }
});


test("R&M machinery register and GATELOG customer visit complete authenticated CRUD flows", async () => {
  const store = createMemoryStore();
  const originalFetch = globalThis.fetch;
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
    const bootstrapResponse = await request("central-bank", {
      action: "bootstrap", bootstrapCode: runtime.bootstrapCode, username: "DEV", pin: "4826"
    });
    assert.equal(bootstrapResponse.status, 200);
    const loginResponse = await request("central-bank", { action: "login", username: "DEV", pin: "4826" });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json();

    const machineType = "KIVERCO_PICKING_LINE";
    const addedMachineResponse = await request("repair-maintenance-api", {
      action: "asset-add", machineType, makeModel: "Kiverco Test Line 01", assetCode: "QA-RM-001"
    }, login.token);
    assert.equal(addedMachineResponse.status, 201);
    const addedMachine = (await addedMachineResponse.json()).asset;
    assert.equal(addedMachine.make_model, "Kiverco Test Line 01");
    assert.equal(addedMachine.asset_code, "QA-RM-001");

    const machineListResponse = await request("repair-maintenance-api", {
      action: "asset-list", machineType
    }, login.token);
    assert.equal(machineListResponse.status, 200);
    const machineList = await machineListResponse.json();
    assert.ok(machineList.assets.some(asset => asset.id === addedMachine.id));
    assert.equal(machineList.unassignedCount, 0);

    const customerResponse = await request("gatelog-api", {
      action: "customer-save", customerName: "QA Test Haulage"
    }, login.token);
    assert.equal(customerResponse.status, 200);
    const customer = (await customerResponse.json()).customer;
    assert.ok(customer.id);

    const wasteResponse = await request("gatelog-api", {
      action: "waste-type-create", label: "QA Mixed Waste"
    }, login.token);
    assert.equal(wasteResponse.status, 200);
    assert.equal((await wasteResponse.json()).wasteType.label, "QA Mixed Waste");

    const vehicleResponse = await request("gatelog-api", {
      action: "vehicle-save", customerId: customer.id, registration: "QA26 YRD"
    }, login.token);
    assert.equal(vehicleResponse.status, 200);
    assert.equal((await vehicleResponse.json()).vehicle.registration, "QA26 YRD");

    const arrivalResponse = await request("gatelog-api", {
      action: "arrival", customerId: customer.id,
      registration: "QA26 YRD", wasteTypes: ["QA Mixed Waste"]
    }, login.token);
    assert.equal(arrivalResponse.status, 200);
    const visit = (await arrivalResponse.json()).visit;
    assert.ok(visit.id);
    assert.equal(visit.status, "ON_SITE");

    const departureResponse = await request("gatelog-api", {
      action: "departure", visitId: visit.id
    }, login.token);
    assert.equal(departureResponse.status, 200);
    const departure = (await departureResponse.json()).visit;
    assert.equal(departure.id, visit.id);
    assert.equal(departure.status, "DEPARTED");
    assert.ok(departure.time_out);
  } finally {
    await runtime.dispose();
    assert.equal(globalThis.__YARDHUB_BOOTSTRAP_CODE__, null);
    if (previousBootstrapCode === undefined) delete globalThis.__YARDHUB_BOOTSTRAP_CODE__;
    else globalThis.__YARDHUB_BOOTSTRAP_CODE__ = previousBootstrapCode;
    globalThis.fetch = originalFetch;
    if (previousSession === undefined) delete globalThis.DowntimeCentral;
    else globalThis.DowntimeCentral = previousSession;
  }
});


test("broker executes multiple YARDHUB table mutations in one atomic Git database commit", async () => {
  const store = createMemoryStore();
  const runtime = await installGitHubEdgeRuntime({ store, functionNames: [] });
  const before = (await store.readDatabase()).revision;
  const handlers = {
    "test-service": async () => {
      const db = globalThis.__YARDHUB_GITHUB_COMPAT__.createClient();
      const customer = await db.from("gatelog_customers")
        .insert({ id: "broker-customer-1", customer_name: "Atomic Broker Customer" })
        .select("*").single();
      assert.equal(customer.error, null);
      const visit = await db.from("gatelog_visits")
        .insert({ id: "broker-visit-1", customer_id: "broker-customer-1", status: "ON_SITE" })
        .select("*").single();
      assert.equal(visit.error, null);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  };
  try {
    const result = await executeGitHubEdgeAction({
      store, handlers, service: "test-service", action: "test-create",
      args: {}, requestId: "10fd938a-2107-4b8a-ade1-ba77bc542182"
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.revision, before + 1);
    const db = await store.readDatabase();
    assert.equal(db.tables.gatelog_customers.length, 1);
    assert.equal(db.tables.gatelog_visits.length, 1);
  } finally {
    await runtime.dispose();
  }
});

test("broker rolls back all staged table mutations when a YARDHUB action fails", async () => {
  const store = createMemoryStore();
  const runtime = await installGitHubEdgeRuntime({ store, functionNames: [] });
  const before = (await store.readDatabase()).revision;
  const handlers = {
    "test-service": async () => {
      const db = globalThis.__YARDHUB_GITHUB_COMPAT__.createClient();
      const result = await db.from("gatelog_customers")
        .insert({ id: "broker-customer-fail", customer_name: "Must Roll Back" })
        .select("*").single();
      assert.equal(result.error, null);
      return new Response(JSON.stringify({ error: "deliberate rejection" }), { status: 403 });
    }
  };
  try {
    await assert.rejects(executeGitHubEdgeAction({
      store, handlers, service: "test-service", action: "test-denied",
      args: {}, requestId: "20fd938a-2107-4b8a-ade1-ba77bc542182"
    }), /deliberate rejection/);
    const db = await store.readDatabase();
    assert.equal(db.revision, before);
    assert.equal((db.tables.gatelog_customers || []).length, 0);
  } finally {
    await runtime.dispose();
  }
});


test("atomic broker action aborts if primary authority epoch changes after request authorization", async () => {
  let handlerCalls = 0;
  let committed = false;
  const store = {
    async readDatabase() {
      return { revision: 0, tables: { downtime_github_broker_requests: [{
        request_id: "10fd938a-2107-4b8a-ade1-ba77bc542182",
        actor_user_id: "user-01",
        state: "PROCESSING"
      }] } };
    },
    async readAuthority() {
      return { status: "ACTIVE", primarySystemId: "DOWNTIMEUI-GITHUB", epoch: 5 };
    },
    async transactDatabase({ mutate }) {
      const draft = { downtime_github_broker_requests: [{
        request_id: "10fd938a-2107-4b8a-ade1-ba77bc542182",
        actor_user_id: "user-01",
        state: "PROCESSING"
      }] };
      const result = await mutate(draft);
      committed = true;
      return { committed: true, result };
    }
  };
  const handlers = {
    "gatelog-api": async () => {
      handlerCalls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  };
  await assert.rejects(executeGitHubEdgeAction({
    store,
    handlers,
    service: "gatelog-api",
    action: "history",
    args: {},
    sessionToken: "a".repeat(64),
    requestId: "10fd938a-2107-4b8a-ade1-ba77bc542182",
    actorUserId: "user-01",
    expectedAuthorityEpoch: 4
  }), error => error.code === "BROKER_AUTHORITY_EPOCH_CHANGED");
  assert.equal(handlerCalls, 0);
  assert.equal(committed, false);
});


test("GitHub edge runtime blocks protected DOWNTIME and unsupported binary actions before handler invocation", async () => {
  const store = createMemoryStore();
  const runtime = await installGitHubEdgeRuntime({ store, functionNames: [] });
  let invoked = false;
  const handlers = {
    "central-bank": async () => {
      invoked = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  };
  try {
    const blocked = [
      ["central-bank", "identity-reset"],
      ["central-bank", "staff-original-upload"],
      ["central-bank", "staff-photo-url"],
      ["central-bank", "staff-photo-read"],
      ["photo-evidence", "create-upload"],
      ["photo-evidence", "view"],
      ["photo-evidence", "cleanup"],
      ["repair-maintenance-api", "upload"],
      ["repair-maintenance-api", "export-create"],
      ["repair-maintenance-api", "export-url"]
    ];
    for (const [service, action] of blocked) {
      await assert.rejects(executeGitHubEdgeAction({
        store, handlers: { [service]: async () => { invoked = true; return new Response("{}", { status: 200 }); } },
        service, action, args: {},
        requestId: "30fd938a-2107-4b8a-ade1-ba77bc542182"
      }), /protected-repository or binary transport path/);
    }
    assert.equal(invoked, false);
  } finally {
    await runtime.dispose();
  }
});
