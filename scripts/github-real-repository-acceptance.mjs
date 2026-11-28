import assert from "node:assert/strict";
import { createGitHubDataStore } from "../src/infrastructure/github-data-store.js";
import { ensureGitHubDatabaseReady, GITHUB_YARDHUB_TABLES } from "../src/infrastructure/github-database-bootstrap.js";

const repository = String(process.env.YARDHUB_DATA_REPOSITORY || "").trim();
const token = String(process.env.YARDHUB_DATA_TOKEN || "").trim();
const branch = String(process.env.YARDHUB_DATA_BRANCH || "main").trim();
if (!repository || !token) {
  console.error("Real-repository acceptance requires YARDHUB_DATA_REPOSITORY=owner/repo and YARDHUB_DATA_TOKEN. No test was run.");
  process.exit(2);
}
const [owner, repo, ...extra] = repository.split("/");
if (!owner || !repo || extra.length) throw new Error("YARDHUB_DATA_REPOSITORY must be owner/repo.");
if ((owner + "/" + repo).toLowerCase() === "aka30art/downtime" ||
    (owner + "/" + repo).toLowerCase() === "aka30art/downtimeui") {
  throw new Error("Protected DOWNTIME and application-source repositories are forbidden test targets.");
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}
function makeStore(cacheStorage, fetchImpl = globalThis.fetch) {
  return createGitHubDataStore({
    owner, repo, branch, token, systemId: "YARDHUB-PRIMARY",
    fetchImpl, cacheStorage
  });
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: "Bearer " + token,
  "X-GitHub-Api-Version": "2022-11-28"
};
const metadataResponse = await fetch("https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo), { headers });
const metadata = await metadataResponse.json();
assert.equal(metadataResponse.ok, true, "GitHub token must read the configured data repository");
assert.equal(metadata.private, true, "YARDHUB operational data repository must be private");
assert.equal(metadata.archived, false, "YARDHUB data repository must not be archived");

const cacheA = memoryStorage();
const cacheB = memoryStorage();
const deviceA = makeStore(cacheA);
const deviceB = makeStore(cacheB);
const probeId = "yardhub-acceptance-" + globalThis.crypto.randomUUID();
const objectPath = "acceptance/" + probeId + ".txt";
let probeCommitted = false;
let objectUploaded = false;

try {
  await deviceA.ensureAuthority();
  await ensureGitHubDatabaseReady({ store: deviceA });
  const initial = await deviceA.readDatabase();
  assert.equal(initial.offline, false);
  assert.equal(Object.keys(initial.tables).length, GITHUB_YARDHUB_TABLES.length);
  assert.equal(GITHUB_YARDHUB_TABLES.length, 39);
  const users = initial.tables.downtime_central_bank?.find(row => Number(row.id) === 1)?.payload?.users || [];
  assert.equal(users.length, 0, "first-run Central Bank must be empty before DEV ROOT bootstrap");
  assert.equal((initial.tables.downtime_roots_bootstrap || []).some(row => row.singleton === true), true);

  const deviceBInitial = await deviceB.readDatabase();
  const baselineRevision = deviceBInitial.revision;
  await deviceA.transactDatabase({
    expectedRevision: initial.revision,
    actorId: "REAL-REPOSITORY-ACCEPTANCE",
    operationId: probeId + "-device-a-write",
    mutate(tables) {
      tables.downtime_reports = Array.isArray(tables.downtime_reports) ? tables.downtime_reports : [];
      tables.downtime_reports.push({ id: probeId, title: "Temporary GitHub acceptance probe", created_at: new Date().toISOString() });
    }
  });
  probeCommitted = true;

  const refreshedOnB = await deviceB.readDatabase();
  assert.equal(refreshedOnB.offline, false);
  assert.equal(refreshedOnB.revision > baselineRevision, true);
  assert.equal(refreshedOnB.tables.downtime_reports.some(row => row.id === probeId), true,
    "independent device B must see device A's central commit after manual refresh");

  await deviceA.transactDatabase({
    expectedRevision: refreshedOnB.revision,
    actorId: "REAL-REPOSITORY-ACCEPTANCE",
    operationId: probeId + "-device-a-second-write",
    mutate(tables) { tables.downtime_reports.push({ id: probeId + "-second", title: "Concurrent write probe" }); }
  });
  await assert.rejects(
    deviceB.transactDatabase({
      expectedRevision: refreshedOnB.revision,
      actorId: "REAL-REPOSITORY-ACCEPTANCE",
      operationId: probeId + "-stale-device-b-write",
      mutate(tables) { tables.downtime_reports.push({ id: probeId + "-stale", title: "Must not commit" }); }
    }),
    error => error?.status === 409,
    "device B stale write must be rejected with HTTP 409 semantics"
  );

  const bytes = new TextEncoder().encode("YARDHUB GitHub private storage acceptance " + probeId);
  await deviceA.uploadObject({ bucket: "downtime-evidence", path: objectPath, data: bytes, mimeType: "text/plain", upsert: false });
  objectUploaded = true;
  const downloaded = await deviceB.downloadObject({ bucket: "downtime-evidence", path: objectPath });
  assert.deepEqual([...downloaded.bytes], [...bytes]);
  const removed = await deviceA.deleteObject({ bucket: "downtime-evidence", path: objectPath });
  assert.equal(removed.deleted, true);
  objectUploaded = false;

  const offlineStore = makeStore(cacheB, async () => { throw new TypeError("Simulated offline network"); });
  const offlineRead = await offlineStore.readDatabase();
  assert.equal(offlineRead.offline, true, "previously loaded central data must remain readable offline");
  assert.equal(offlineRead.tables.downtime_reports.some(row => row.id === probeId), true);

  console.log("PASS: private repository access, empty 39-table bootstrap, independent-device refresh, stale-write conflict, binary object upload/read/delete and cached offline read.");
} finally {
  if (objectUploaded) {
    try { await deviceA.deleteObject({ bucket: "downtime-evidence", path: objectPath }); } catch {}
  }
  if (probeCommitted) {
    let cleaned = false;
    for (let attempt = 0; attempt < 3 && !cleaned; attempt += 1) {
      const latest = await deviceA.readDatabase();
      try {
        await deviceA.transactDatabase({
          expectedRevision: latest.revision,
          actorId: "REAL-REPOSITORY-ACCEPTANCE-CLEANUP",
          operationId: probeId + "-cleanup-" + attempt,
          mutate(tables) {
            tables.downtime_reports = (tables.downtime_reports || []).filter(row =>
              row.id !== probeId && row.id !== probeId + "-second" && row.id !== probeId + "-stale"
            );
          }
        });
        cleaned = true;
      } catch (error) {
        if (error?.status !== 409 || attempt === 2) throw error;
      }
    }
    assert.equal(cleaned, true, "temporary acceptance records must be removed");
  }
}
