import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubDataStore, GitHubStoreError } from "../src/infrastructure/github-data-store.js";

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

function createMockGitHub() {
  let counter = 0;
  let head = "commit-0";
  let failNextCas = false;
  const commits = new Map([[head, { tree: "tree-0", parent: null }]]);
  const trees = new Map([["tree-0", new Map([[ "control/authority.json", JSON.stringify(INITIAL_AUTHORITY) + "\n" ]])]]);
  const blobs = new Map();

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
      const content = tree?.get(filePath);
      if (content === undefined) return response(404, { message: "Not found" });
      return response(200, {
        type: "file", encoding: "base64",
        content
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
        else base.set(entry.path, blobs.get(entry.sha));
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
