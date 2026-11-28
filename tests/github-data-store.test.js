import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createGitHubDataStore, GitHubStoreError } from "../src/infrastructure/github-data-store.js";
import { GITHUB_YARDHUB_TABLES, GITHUB_YARDHUB_SOURCE_TABLES } from "../src/infrastructure/github-database-bootstrap.js";

const INITIAL_AUTHORITY = {
  schemaVersion: 1,
  systemId: "YARDHUB-ECOSYSTEM",
  primarySystemId: "YARDHUB-PRIMARY",
  secondarySystemId: "DOWNTIMEUI-GITHUB",
  epoch: 1,
  status: "ACTIVE",
  replication: { direction: "YARDHUB-PRIMARY_TO_DOWNTIMEUI-GITHUB", status: "NOT_CONFIGURED", lastSuccessfulCheckpoint: null }
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === null ? "" : JSON.stringify(body); }
  };
}

function createMockGitHub({ includeAuthority = true, includePrimaryBackup = false, tamperPrimaryBackupChecksum = false, authority = INITIAL_AUTHORITY } = {}) {
  let counter = 0;
  let head = "commit-0";
  let failNextCas = false;
  const commits = new Map([[head, { tree: "tree-0", parent: null }]]);
  const initialAuthority = Buffer.from(JSON.stringify(authority) + "\n", "utf8").toString("base64");
  const blobs = new Map([["initial-blob", initialAuthority]]);
  const initialFiles = new Map();
  if (includeAuthority) initialFiles.set("control/authority.json", { sha: "initial-blob", content: initialAuthority });
  const trees = new Map([["tree-0", initialFiles]]);
  function addInitialFile(filePath, bytes) {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const sha = createHash("sha1").update(Buffer.concat([
      Buffer.from("blob " + body.length + "\0"), body
    ])).digest("hex");
    const encoded = body.toString("base64");
    blobs.set(sha, encoded);
    initialFiles.set(filePath, { sha, content: encoded });
    return sha;
  }
  if (includePrimaryBackup) {
    const checksums = {};
    const tableCounts = {};
    for (const table of GITHUB_YARDHUB_SOURCE_TABLES) {
      const rows = table === "downtime_shared_state"
        ? [{ id: 1, version: 7, payload: { source: "YARDHUB", checks: 24 } }]
        : table === "downtime_central_bank"
          ? [{ id: 1, version: 4, payload: { users: [{ username: "DEV", userId: "root-dev-id" }] } }]
          : [];
      tableCounts[table] = rows.length;
      const path = "replication/yardhub-primary/tables/" + table + ".json";
      checksums[path] = addInitialFile(path, JSON.stringify(rows) + "\n");
    }
    const objectPath = "downtime-evidence/week-1/photo.png";
    const storagePath = "replication/yardhub-primary/storage/" + objectPath;
    checksums[storagePath] = addInitialFile(storagePath, Buffer.from([1, 2, 3, 4]));
    const metadataPath = "replication/yardhub-primary/storage-metadata/" + objectPath + ".json";
    checksums[metadataPath] = addInitialFile(metadataPath, JSON.stringify({
      bucket: "downtime-evidence", path: "week-1/photo.png",
      mimeType: "image/png", size: 4, updatedAt: "2026-11-27T10:00:00.000Z"
    }) + "\n");
    if (tamperPrimaryBackupChecksum) {
      checksums["replication/yardhub-primary/tables/downtime_shared_state.json"] = "incorrect-checksum";
    }
    addInitialFile("replication/yardhub-primary/manifest.json", JSON.stringify({
      schemaVersion: 1, source: "YARDHUB-SUPABASE",
      sourceProjectRef: "source-project", exportedAt: "2026-11-27T10:00:00.000Z",
      tableCounts, tableCount: GITHUB_YARDHUB_SOURCE_TABLES.length,
      storageObjectCount: 1, storageBytes: 4, sessionsExcluded: true, checksums
    }) + "\n");
  }

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const prefix = "/repos/aka30art/DowntimeUI";
    const path = parsed.pathname.slice(prefix.length);
    const method = options.method || "GET";
    if (options.headers?.Authorization !== "Bearer test-token") {
      return response(401, { message: "Bad credentials" });
    }

    if (method === "GET" && path === "/git/ref/heads/data/yardhub") {
      return response(200, { ref: "refs/heads/data/yardhub", object: { sha: head } });
    }
    if (method === "GET" && path.startsWith("/git/trees/")) {
      const sha = decodeURIComponent(path.slice("/git/trees/".length));
      const tree = trees.get(sha);
      if (!tree) return response(404, { message: "Not found" });
      return response(200, {
        sha, truncated: false,
        tree: [...tree.entries()].map(([filePath, file]) => ({
          path: filePath, type: "blob", sha: file.sha,
          size: Buffer.from(file.content, "base64").length
        }))
      });
    }
    if (method === "GET" && path.startsWith("/git/commits/")) {
      const sha = decodeURIComponent(path.slice("/git/commits/".length));
      const commit = commits.get(sha);
      return commit ? response(200, { sha, tree: { sha: commit.tree } }) : response(404, { message: "Not found" });
    }
    if (method === "GET" && path.startsWith("/git/blobs/")) {
      const sha = decodeURIComponent(path.slice("/git/blobs/".length));
      const value = blobs.get(sha);
      return value === undefined ? response(404, { message: "Not found" }) : response(200, {
        sha, encoding: "base64", content: value
      });
    }
    if (method === "GET" && path.startsWith("/contents/")) {
      const filePath = decodeURIComponent(path.slice("/contents/".length));
      const ref = parsed.searchParams.get("ref");
      const commit = commits.get(ref);
      const tree = commit && trees.get(commit.tree);
      const file = tree?.get(filePath);
      if (file === undefined) return response(404, { message: "Not found" });
      return response(200, {
        type: "file", encoding: "base64",
        sha: file.sha,
        content: file.content
      });
    }
    if (method === "POST" && path === "/git/blobs") {
      const body = JSON.parse(options.body);
      const sha = "blob-" + (++counter);
      blobs.set(sha, body.encoding === "base64" ? body.content : Buffer.from(body.content, "utf8").toString("base64"));
      return response(201, { sha });
    }
    if (method === "POST" && path === "/git/trees") {
      const body = JSON.parse(options.body);
      const base = new Map(trees.get(body.base_tree) || []);
      for (const entry of body.tree) {
        if (entry.sha === null) base.delete(entry.path);
        else base.set(entry.path, { sha: entry.sha, content: blobs.get(entry.sha) });
      }
      const sha = "tree-" + (++counter);
      trees.set(sha, base);
      return response(201, { sha });
    }
    if (method === "POST" && path === "/git/commits") {
      const body = JSON.parse(options.body);
      const sha = "commit-" + (++counter);
      commits.set(sha, { tree: body.tree, parent: body.parents?.[0] || null });
      return response(201, { sha });
    }
    if (method === "PATCH" && path === "/git/refs/heads/data/yardhub") {
      const body = JSON.parse(options.body);
      const commit = commits.get(body.sha);
      if (failNextCas) {
        failNextCas = false;
        const current = commits.get(head);
        const external = "commit-external-" + (++counter);
        commits.set(external, { tree: current.tree, parent: head });
        head = external;
        return response(422, { message: "Update is not a fast forward" });
      }
      if (!commit || commit.parent !== head || body.force !== false) {
        return response(422, { message: "Update is not a fast forward" });
      }
      head = body.sha;
      return response(200, { ref: "refs/heads/data/yardhub", object: { sha: head } });
    }
    return response(404, { message: "Unhandled mock endpoint: " + method + " " + path });
  };

  return {
    fetchImpl,
    forceNextCompareAndSwapConflict() { failNextCas = true; },
    getHead() { return head; }
  };
}

function makeStore(server, systemId = "DOWNTIMEUI-GITHUB") {
  return createGitHubDataStore({
    owner: "aka30art",
    repo: "DowntimeUI",
    branch: "data/yardhub",
    token: "test-token",
    systemId,
    fetchImpl: server.fetchImpl,
    sleep: async () => {},
    now: () => new Date("2026-11-27T10:30:00.000Z")
  });
}

test("secondary system can write isolated events without changing primary authority", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const result = await store.appendEvent({
    eventId: "evt-00000001",
    entityId: "fault-0001",
    module: "RM",
    eventType: "FAULT_CREATED",
    actorId: "operator-1",
    date: "2026-11-27",
    payload: { machine: "KIVERCO", priority: "HIGH" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.event.writeMode, "SECONDARY_LOCAL");
  assert.equal(result.event.authorityEpoch, 1);
  assert.equal((await store.readEvents({ module: "RM", date: "2026-11-27" })).length, 1);
  assert.equal((await store.readAuthority()).primarySystemId, "YARDHUB-PRIMARY");
});

test("event IDs are idempotent and duplicate retries do not create duplicate records", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const input = {
    eventId: "evt-00000002", entityId: "visit-1", module: "GATELOG",
    eventType: "VISIT_CREATED", actorId: "operator-2",
    date: "2026-11-27", payload: { vehicle: "AB12 CDE" }
  };
  const first = await store.appendEvent(input);
  const duplicate = await store.appendEvent(input);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal((await store.readEvents({ module: "GATELOG", date: "2026-11-27" })).length, 1);
});

test("compare-and-swap conflicts are retried without losing the new event", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  server.forceNextCompareAndSwapConflict();
  const result = await store.appendEvent({
    eventId: "evt-00000003", entityId: "day-1", module: "DOWNTIME",
    eventType: "CHECKSHEET_SAVED", actorId: "operator-3",
    date: "2026-11-27", payload: { completed: 12 }
  });
  assert.equal(result.ok, true);
  assert.equal((await store.readEvents({ module: "DOWNTIME", date: "2026-11-27" })).length, 1);
  assert.notEqual(server.getHead(), "commit-0");
});

test("primary authority switch requires preparation, freeze and matching reconciliation", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const prepared = await store.beginPrimarySwitch({
    targetSystemId: "DOWNTIMEUI-GITHUB", expectedEpoch: 1,
    actorId: "root-dev", note: "Controlled failover rehearsal"
  });
  assert.equal(prepared.authority.status, "PREPARING");

  const frozen = await store.freezePrimarySwitch({ expectedEpoch: 1 });
  assert.equal(frozen.authority.status, "FROZEN");

  await assert.rejects(
    store.completePrimarySwitch({
      expectedEpoch: 1, actorId: "root-dev",
      reconciliation: { verified: true, unresolvedConflicts: 1, sourceChecksum: "same", targetChecksum: "same" }
    }),
    /reconciliation/
  );

  const completed = await store.completePrimarySwitch({
    expectedEpoch: 1, actorId: "root-dev",
    reconciliation: {
      verified: true, unresolvedConflicts: 0,
      sourceChecksum: "sha256:matched-checkpoint",
      targetChecksum: "sha256:matched-checkpoint"
    }
  });
  assert.equal(completed.authority.primarySystemId, "DOWNTIMEUI-GITHUB");
  assert.equal(completed.authority.secondarySystemId, "YARDHUB-PRIMARY");
  assert.equal(completed.authority.epoch, 2);
  assert.equal(completed.authority.status, "ACTIVE");
});

test("events are labelled PRIMARY only after the twin owns the authority epoch", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  await store.beginPrimarySwitch({ targetSystemId: "DOWNTIMEUI-GITHUB", expectedEpoch: 1, actorId: "root-dev" });
  await store.freezePrimarySwitch({ expectedEpoch: 1 });
  await store.completePrimarySwitch({
    expectedEpoch: 1, actorId: "root-dev",
    reconciliation: { verified: true, unresolvedConflicts: 0, sourceChecksum: "x", targetChecksum: "x" }
  });
  const result = await store.appendEvent({
    eventId: "evt-00000004", entityId: "day-2", module: "DOWNTIME",
    eventType: "SHIFT_STARTED", actorId: "operator-4",
    date: "2026-11-27", payload: { start: "06:30" }
  });
  assert.equal(result.event.writeMode, "PRIMARY");
  assert.equal(result.event.authorityEpoch, 2);
});

test("stale authority epochs and invalid event payloads are rejected", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  await assert.rejects(
    store.beginPrimarySwitch({ targetSystemId: "DOWNTIMEUI-GITHUB", expectedEpoch: 99, actorId: "root-dev" }),
    (error) => error instanceof GitHubStoreError && error.status === 409
  );
  await assert.rejects(
    store.appendEvent({
      eventId: "evt-00000005", entityId: "x", module: "DOWNTIME",
      eventType: "BAD", actorId: "operator", date: "27-11-2026", payload: []
    }),
    /Event payload/
  );
});

test("primary switch can be cancelled without changing the authority epoch", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  await store.beginPrimarySwitch({ targetSystemId: "DOWNTIMEUI-GITHUB", expectedEpoch: 1, actorId: "root-dev" });
  const cancelled = await store.cancelPrimarySwitch({ expectedEpoch: 1, actorId: "root-dev", reason: "Rehearsal stopped" });
  assert.equal(cancelled.authority.status, "ACTIVE");
  assert.equal(cancelled.authority.primarySystemId, "YARDHUB-PRIMARY");
  assert.equal(cancelled.authority.epoch, 1);
});

test("workspace snapshots use compare-and-swap versions", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const first = await store.writeSnapshot({
    module: "YARDHUB_WORKSPACE", snapshotId: "site-main", actorId: "operator-1",
    payload: { configuration: { site: "Main" }, operations: { week: "2026-11-23" } },
    expectedVersion: null
  });
  assert.equal(first.snapshot.version, 1);
  assert.equal(first.snapshot.writeMode, "SECONDARY_LOCAL");

  await assert.rejects(
    store.writeSnapshot({
      module: "YARDHUB_WORKSPACE", snapshotId: "site-main", actorId: "operator-2",
      payload: { operations: { week: "2026-11-23", changed: true } },
      expectedVersion: null
    }),
    (error) => error instanceof GitHubStoreError && error.status === 409
  );

  const second = await store.writeSnapshot({
    module: "YARDHUB_WORKSPACE", snapshotId: "site-main", actorId: "operator-2",
    payload: { configuration: { site: "Main" }, operations: { week: "2026-11-23", changed: true } },
    expectedVersion: 1
  });
  assert.equal(second.snapshot.version, 2);

  await assert.rejects(
    store.writeSnapshot({
      module: "YARDHUB_WORKSPACE", snapshotId: "site-main", actorId: "operator-3",
      payload: { operations: {} }, expectedVersion: 1
    }),
    (error) => error instanceof GitHubStoreError && error.status === 409
  );

  const restored = await store.readSnapshot({ module: "YARDHUB_WORKSPACE", snapshotId: "site-main" });
  assert.equal(restored.version, 2);
  assert.equal(restored.payload.operations.changed, true);
});

test("multi-table GitHub database transaction commits all tables at one revision", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const first = await store.transactDatabase({
    expectedRevision: 0, actorId: "root-dev", operationId: "op-db-create-0001",
    mutate(tables) {
      tables.downtime_central_bank = [{ id: 1, payload: { users: [], appData: {} }, version: 1 }];
      tables.gatelog_customers = [{ id: "cust-1", customer_name: "Test Customer" }];
      return { created: true };
    }
  });
  assert.equal(first.committed, true);
  assert.equal(first.revision, 1);
  const db = await store.readDatabase();
  assert.equal(db.revision, 1);
  assert.equal(db.tables.downtime_central_bank[0].payload.users.length, 0);
  assert.equal(db.tables.gatelog_customers[0].customer_name, "Test Customer");
  assert.equal(db.manifest.tables.downtime_central_bank.version, 1);
  assert.equal(db.manifest.tables.gatelog_customers.version, 1);
});

test("two independent device clients share GitHub records and reject stale revisions", async () => {
  const server = createMockGitHub();
  const deviceA = makeStore(server, "YARDHUB-PRIMARY");
  const deviceB = makeStore(server, "YARDHUB-PRIMARY");
  const [initialA, initialB] = await Promise.all([deviceA.readDatabase(), deviceB.readDatabase()]);
  assert.equal(initialA.revision, 0);
  assert.equal(initialB.revision, 0);

  await deviceA.transactDatabase({
    expectedRevision: 0, actorId: "DEV-device-A",
    mutate(tables) { tables.gatelog_customers = [{ id: "customer-1", customer_name: "Shared Customer" }]; }
  });
  const refreshedB = await deviceB.readDatabase();
  assert.equal(refreshedB.revision, 1);
  assert.equal(refreshedB.tables.gatelog_customers[0].customer_name, "Shared Customer");

  await deviceB.transactDatabase({
    expectedRevision: 1, actorId: "DEV-device-B",
    mutate(tables) { tables.repair_maintenance_assets = [{ id: "machine-1", name: "Shared Machine" }]; }
  });
  const refreshedA = await deviceA.readDatabase();
  assert.equal(refreshedA.revision, 2);
  assert.equal(refreshedA.tables.gatelog_customers[0].id, "customer-1");
  assert.equal(refreshedA.tables.repair_maintenance_assets[0].id, "machine-1");

  await assert.rejects(
    deviceA.transactDatabase({
      expectedRevision: 1, actorId: "DEV-device-A",
      mutate(tables) { tables.gatelog_customers[0].customer_name = "Stale overwrite"; }
    }),
    error => error instanceof GitHubStoreError && error.status === 409
  );
  const finalB = await deviceB.readDatabase();
  assert.equal(finalB.revision, 2);
  assert.equal(finalB.tables.gatelog_customers[0].customer_name, "Shared Customer");
});

test("GitHub database transaction rejects a stale revision without changing records", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  await store.transactDatabase({
    expectedRevision: 0, actorId: "root-dev",
    mutate(tables) { tables.downtime_central_bank = [{ id: 1, payload: { marker: "first" } }]; }
  });
  await assert.rejects(
    store.transactDatabase({
      expectedRevision: 0, actorId: "root-dev",
      mutate(tables) { tables.downtime_central_bank[0].payload.marker = "stale-write"; }
    }),
    (error) => error instanceof GitHubStoreError && error.status === 409
  );
  const db = await store.readDatabase();
  assert.equal(db.revision, 1);
  assert.equal(db.tables.downtime_central_bank[0].payload.marker, "first");
});

test("GitHub database transaction rejects a concurrent branch update atomically", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  server.forceNextCompareAndSwapConflict();
  await assert.rejects(
    store.transactDatabase({
      expectedRevision: 0, actorId: "root-dev",
      mutate(tables) {
        tables.downtime_central_bank = [{ id: 1, payload: { marker: "not-committed" } }];
        tables.gatelog_customers = [{ id: "cust-2", customer_name: "Also Not Committed" }];
      }
    }),
    (error) => error instanceof GitHubStoreError && error.status === 409
  );
  const db = await store.readDatabase();
  assert.equal(db.revision, 0);
  assert.equal(Object.keys(db.tables).length, 0);
});

test("primary and secondary GitHub databases are partitioned independently", async () => {
  const server = createMockGitHub();
  const secondary = makeStore(server, "DOWNTIMEUI-GITHUB");
  const primary = makeStore(server, "YARDHUB-PRIMARY");
  await secondary.transactDatabase({
    expectedRevision: 0, actorId: "operator",
    mutate(tables) { tables.gatelog_customers = [{ id: "secondary-only", customer_name: "Secondary" }]; }
  });
  const primaryDb = await primary.readDatabase();
  const secondaryDb = await secondary.readDatabase();
  assert.equal(primaryDb.revision, 0);
  assert.equal(Object.keys(primaryDb.tables).length, 0);
  assert.equal(secondaryDb.tables.gatelog_customers[0].id, "secondary-only");
});

test("GitHub binary object storage uploads, downloads and deletes versioned objects", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const original = new Uint8Array([0, 1, 2, 3, 127, 128, 254, 255]);
  const uploaded = await store.uploadObject({
    bucket: "downtime-pdfs",
    path: "2026-11-27/report.bin",
    data: original,
    mimeType: "application/octet-stream"
  });
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.size, original.byteLength);

  const downloaded = await store.downloadObject({
    bucket: "downtime-pdfs",
    path: "2026-11-27/report.bin"
  });
  assert.equal(downloaded.mimeType, "application/octet-stream");
  assert.deepEqual([...downloaded.bytes], [...original]);

  await assert.rejects(
    store.uploadObject({
      bucket: "downtime-pdfs",
      path: "2026-11-27/report.bin",
      data: original,
      mimeType: "application/octet-stream"
    }),
    (error) => error.status === 409
  );

  const deleted = await store.deleteObject({ bucket: "downtime-pdfs", path: "2026-11-27/report.bin" });
  assert.equal(deleted.deleted, true);
  await assert.rejects(
    store.downloadObject({ bucket: "downtime-pdfs", path: "2026-11-27/report.bin" }),
    (error) => error.status === 404
  );
});

test("a fresh private GitHub data repository receives the default YARDHUB authority manifest", async () => {
  const server = createMockGitHub({ includeAuthority: false });
  const store = makeStore(server);
  const authority = await store.ensureAuthority();
  assert.equal(authority.primarySystemId, "YARDHUB-PRIMARY");
  assert.equal(authority.secondarySystemId, "DOWNTIMEUI-GITHUB");
  assert.equal(authority.epoch, 1);
  assert.equal(authority.status, "ACTIVE");
  const readBack = await store.readAuthority();
  assert.deepEqual(readBack, authority);
});

test("GitHub storage listing returns nested folders and file metadata", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  await store.uploadObject({
    bucket: "downtime-staff-photos", path: "staff-1/front.jpg",
    data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg"
  });
  await store.uploadObject({
    bucket: "downtime-staff-photos", path: "staff-2/front.jpg",
    data: new Uint8Array([4, 5]), mimeType: "image/jpeg"
  });
  const folders = await store.listObjects({ bucket: "downtime-staff-photos", prefix: "" });
  assert.deepEqual(folders.map(x => x.name).sort(), ["staff-1", "staff-2"]);
  assert.equal(folders.every(x => x.id === null), true);
  const files = await store.listObjects({ bucket: "downtime-staff-photos", prefix: "staff-1" });
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "front.jpg");
  assert.equal(files[0].metadata.mimetype, "image/jpeg");
  assert.equal(files[0].metadata.size, 3);
});


test("single-table polling reads the rows inside the versioned GitHub shard", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const expected = [
    { id: "customer-1", customer_name: "North Yard" },
    { id: "customer-2", customer_name: "South Yard" }
  ];
  await store.transactDatabase({
    expectedRevision: 0,
    actorId: "root-dev",
    operationId: "op-realtime-table-0001",
    mutate(tables) { tables.gatelog_customers = expected; }
  });
  assert.deepEqual(await store.readTable("gatelog_customers"), expected);
  assert.deepEqual(await store.readTable("gatelog_visits"), []);
  await assert.rejects(store.readTable("../gatelog_customers"), /Database table/);
});


test("broker database writes are denied until GitHub is the active primary at the expected authority epoch", async () => {
  const server = createMockGitHub();
  const store = makeStore(server);
  const before = server.getHead();
  let mutated = false;
  await assert.rejects(
    store.transactDatabase({
      expectedRevision: 0,
      expectedAuthorityEpoch: 1,
      actorId: "YARDHUB-GITHUB-ACTIONS-BROKER",
      operationId: "broker-authority-gate-0001",
      mutate() { mutated = true; }
    }),
    error => error instanceof GitHubStoreError && error.status === 409 &&
      /authority changed or GitHub is not primary/.test(error.message)
  );
  assert.equal(mutated, false, "the service mutator must not run while YARDHUB remains primary");
  assert.equal(server.getHead(), before, "no Git ref may be committed while the GitHub twin is secondary");
});


test("broker transaction commits only for the exact active GitHub-primary authority epoch", async () => {
  const server = createMockGitHub({
    authority: {
      ...INITIAL_AUTHORITY,
      primarySystemId: "DOWNTIMEUI-GITHUB",
      secondarySystemId: "YARDHUB-PRIMARY",
      epoch: 7
    }
  });
  const store = makeStore(server);
  const before = await store.readDatabase();
  let mutated = false;
  const result = await store.transactDatabase({
    expectedRevision: before.revision,
    expectedAuthorityEpoch: 7,
    actorId: "YARDHUB-GITHUB-ACTIONS-BROKER",
    operationId: "broker-authority-epoch-commit-0001",
    mutate(tables) {
      mutated = true;
      tables.gatelog_customers = Array.isArray(tables.gatelog_customers) ? tables.gatelog_customers : [];
      tables.gatelog_customers.push({ id: "authority-gated-write", customer_name: "Committed" });
      return "accepted";
    }
  });
  assert.equal(mutated, true);
  assert.equal(result.committed, true);
  assert.equal(result.revision, before.revision + 1);
  assert.equal(result.result, "accepted");
  const after = await store.readDatabase();
  assert.equal(after.tables.gatelog_customers.at(-1).id, "authority-gated-write");

  const currentHead = server.getHead();
  await assert.rejects(
    store.transactDatabase({
      expectedRevision: after.revision,
      expectedAuthorityEpoch: 6,
      actorId: "YARDHUB-GITHUB-ACTIONS-BROKER",
      operationId: "broker-authority-stale-epoch-0002",
      mutate() { throw new Error("A stale authority epoch must not enter the mutator."); }
    }),
    error => error instanceof GitHubStoreError && error.status === 409
  );
  assert.equal(server.getHead(), currentHead, "a stale epoch cannot commit another Git ref");
});
