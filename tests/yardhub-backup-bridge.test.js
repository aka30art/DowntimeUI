import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createYardHubBackupRunner, YARDHUB_TABLES } from "../scripts/yardhub-backup-to-github.mjs";

function gitSha(bytes) {
  const body = Buffer.from(bytes);
  return crypto.createHash("sha1").update(Buffer.concat([Buffer.from("blob " + body.length + "\0"), body])).digest("hex");
}

function response(status, body, binary = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
    async arrayBuffer() {
      const value = Buffer.from(body);
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
  };
}

function createMockServices({ privateRepository = true } = {}) {
  let head = "commit-0";
  let currentTree = new Map();
  let counter = 0;
  let commits = 0;
  const blobs = new Map();
  const trees = new Map([["tree-0", currentTree]]);
  const tableCalls = new Map();

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || "GET";
    if (parsed.hostname === "example.supabase.co") {
      if (parsed.pathname.startsWith("/rest/v1/")) {
        const table = parsed.pathname.split("/").pop();
        tableCalls.set(table, (tableCalls.get(table) || 0) + 1);
        if (table === "downtime_reports") return response(200, [{ id: "report-1", title: "Test report" }]);
        if (table === "downtime_central_sessions") return response(200, [{ token_hash: "must-not-export" }]);
        return response(200, []);
      }
      if (parsed.pathname.startsWith("/storage/v1/object/list/")) {
        const bucket = decodeURIComponent(parsed.pathname.split("/").pop());
        if (bucket === "downtime-evidence") {
          return response(200, [{ name: "evidence.jpg", id: "object-1", metadata: { mimetype: "image/jpeg", size: 3 } }]);
        }
        return response(200, []);
      }
      if (parsed.pathname === "/storage/v1/object/downtime-evidence/evidence.jpg") {
        return response(200, Buffer.from([1, 2, 3]), true);
      }
      return response(404, { message: "Unknown Supabase path " + parsed.pathname });
    }

    if (parsed.hostname === "api.github.com") {
      const path = parsed.pathname.replace("/repos/owner/data", "");
      if (method === "GET" && path === "") return response(200, { private: privateRepository, full_name: "owner/data", archived: false });
      if (method === "GET" && path === "/git/ref/heads/main") {
        return response(200, { object: { sha: head } });
      }
      if (method === "GET" && path.startsWith("/git/commits/")) {
        const commit = path.split("/").pop();
        return response(200, { tree: { sha: commit === "commit-0" ? "tree-0" : trees.get(commit)?.treeSha } });
      }
      if (method === "GET" && path.startsWith("/git/trees/")) {
        const treeSha = path.split("/").pop();
        const tree = trees.get(treeSha) || currentTree;
        return response(200, {
          truncated: false,
          tree: [...tree.entries()].map(([filePath, entry]) => ({ path: filePath, type: "blob", sha: entry.sha }))
        });
      }
      if (method === "POST" && path === "/git/blobs") {
        const body = JSON.parse(options.body);
        const bytes = Buffer.from(body.content, "base64");
        const sha = gitSha(bytes);
        blobs.set(sha, bytes);
        return response(201, { sha });
      }
      if (method === "POST" && path === "/git/trees") {
        const body = JSON.parse(options.body);
        const tree = new Map(currentTree);
        for (const entry of body.tree) {
          if (entry.sha === null) tree.delete(entry.path);
          else tree.set(entry.path, { sha: entry.sha, bytes: blobs.get(entry.sha) });
        }
        const sha = "tree-" + (++counter);
        trees.set(sha, tree);
        return response(201, { sha });
      }
      if (method === "POST" && path === "/git/commits") {
        const body = JSON.parse(options.body);
        const sha = "commit-" + (++counter);
        trees.set(sha, { treeSha: body.tree });
        return response(201, { sha });
      }
      if (method === "PATCH" && path === "/git/refs/heads/main") {
        const body = JSON.parse(options.body);
        head = body.sha;
        const commit = trees.get(head);
        currentTree = new Map(trees.get(commit.treeSha));
        commits += 1;
        return response(200, { object: { sha: head } });
      }
    }
    return response(404, { message: "Unhandled request " + method + " " + url });
  };

  return { fetchImpl, get head() { return head; }, get currentTree() { return new Map(currentTree); }, get commits() { return commits; }, tableCalls };
}

const env = {
  SUPABASE_URL: "https://ygwfipksbbprqynvbklk.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  YARDHUB_DATA_TOKEN: "github-token",
  YARDHUB_DATA_REPOSITORY: "owner/data",
  YARDHUB_DATA_BRANCH: "main"
};

test("backup exports all YARDHUB tables and Storage objects, excluding active sessions", async () => {
  const mock = createMockServices();
  const runner = createYardHubBackupRunner({ fetchImpl: mock.fetchImpl, now: () => new Date("2026-11-27T12:00:00.000Z") });
  const result = await runner.run({ env });
  assert.equal(result.changed, true);
  assert.equal(result.tableCount, 39);
  assert.equal(result.storageObjectCount, 1);
  assert.equal(mock.commits, 1);
  assert.equal(mock.tableCalls.size, YARDHUB_TABLES.length - 1);

  const sessionFile = mock.currentTree.get("replication/yardhub-primary/tables/downtime_central_sessions.json");
  assert.deepEqual(JSON.parse(sessionFile.bytes.toString("utf8")), []);
  const reportFile = mock.currentTree.get("replication/yardhub-primary/tables/downtime_reports.json");
  assert.equal(JSON.parse(reportFile.bytes.toString("utf8"))[0].title, "Test report");
  const evidence = mock.currentTree.get("replication/yardhub-primary/storage/downtime-evidence/evidence.jpg");
  assert.deepEqual([...evidence.bytes], [1, 2, 3]);
  const manifest = JSON.parse(mock.currentTree.get("replication/yardhub-primary/manifest.json").bytes.toString("utf8"));
  assert.equal(manifest.sessionsExcluded, true);
  assert.equal(manifest.tableCount, 39);
  assert.equal(manifest.storageObjectCount, 1);
});

test("unchanged YARDHUB data does not create a redundant GitHub commit", async () => {
  const mock = createMockServices();
  const runner = createYardHubBackupRunner({ fetchImpl: mock.fetchImpl, now: () => new Date("2026-11-27T12:00:00.000Z") });
  await runner.run({ env });
  const second = await runner.run({ env });
  assert.equal(second.changed, false);
  assert.equal(mock.commits, 1);
});


test("backup refuses a public GitHub repository before reading primary records", async () => {
  const mock = createMockServices({ privateRepository: false });
  const runner = createYardHubBackupRunner({ fetchImpl: mock.fetchImpl });
  await assert.rejects(
    runner.run({ env }),
    /exact requested PRIVATE GitHub repository/
  );
  assert.equal(mock.tableCalls.size, 0, "No source table may be read before the destination privacy gate.");
  assert.equal(mock.commits, 0);
});

test("backup refuses the protected source repo and public code repo as destinations", async () => {
  for (const repository of ["aka30art/DOWNTIME", "aka30art/DowntimeUI"]) {
    const mock = createMockServices();
    const runner = createYardHubBackupRunner({ fetchImpl: mock.fetchImpl });
    await assert.rejects(
      runner.run({ env: { ...env, YARDHUB_DATA_REPOSITORY: repository } }),
      /forbidden backup destinations/
    );
    assert.equal(mock.tableCalls.size, 0);
    assert.equal(mock.commits, 0);
  }
});

test("backup refuses an unapproved Supabase source URL before contacting storage", async () => {
  const mock = createMockServices();
  const runner = createYardHubBackupRunner({ fetchImpl: mock.fetchImpl });
  await assert.rejects(
    runner.run({ env: { ...env, SUPABASE_URL: "https://attacker.supabase.co" } }),
    /approved YARDHUB primary Supabase project/
  );
  assert.equal(mock.tableCalls.size, 0);
  assert.equal(mock.commits, 0);
});
