import assert from "node:assert/strict";
import { createGitHubDataStore } from "../src/infrastructure/github-data-store.js";
import { GITHUB_YARDHUB_RPC_HANDLERS } from "../src/infrastructure/github-rpc-handlers.js";

const repository = String(process.env.YARDHUB_DATA_REPOSITORY || "").trim();
const token = String(process.env.YARDHUB_DATA_TOKEN || "").trim();
const sourceBranch = String(process.env.YARDHUB_DATA_BRANCH || "").trim() || "main";
if (!repository || !token) throw new Error("Real module acceptance requires YARDHUB_DATA_REPOSITORY and YARDHUB_DATA_TOKEN.");
const [owner, repo, ...extra] = repository.split("/");
if (!owner || !repo || extra.length) throw new Error("YARDHUB_DATA_REPOSITORY must be owner/repo.");
if (["aka30art/downtime", "aka30art/downtimeui"].includes((owner + "/" + repo).toLowerCase())) {
  throw new Error("Protected DOWNTIME and application-source repositories are forbidden test targets.");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: "Bearer " + token,
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json"
};
const api = "https://api.github.com/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
async function github(path, init = {}) {
  const response = await fetch(api + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw.slice(0, 500) }; }
  if (!response.ok) throw Object.assign(new Error(data?.message || "GitHub API request failed"), { status: response.status, details: data });
  return data;
}
function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}
const runId = globalThis.crypto.randomUUID().replace(/-/g, "");
const branch = "yardhub-acceptance-" + runId;
const metadata = await github("");
assert.equal(metadata.private, true, "Acceptance target must be private.");
assert.equal(metadata.archived, false, "Acceptance target must be writable.");
assert.equal(metadata.permissions?.push, true, "Acceptance token must have repository write access.");
const sourceRef = await github("/git/ref/heads/" + sourceBranch.split("/").map(encodeURIComponent).join("/"));
const sourceHead = sourceRef.object.sha;
await github("/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/" + branch, sha: sourceHead }) });

const store = createGitHubDataStore({
  owner, repo, branch, token, systemId: "YARDHUB-PRIMARY",
  fetchImpl: globalThis.fetch, cacheStorage: memoryStorage()
});
const now = () => new Date();
const unique = "acceptance-" + runId;
const actor = { p_actor_user_id: "acceptance-dev", p_actor_username: "DEV", p_actor_display_name: "Acceptance DEV" };
let original = null;
let finalSnapshotRestored = false;

async function mutate(label, callback) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await store.readDatabase();
    try {
      return await store.transactDatabase({
        expectedRevision: current.revision,
        actorId: "YARDHUB-PRODUCTION-ACCEPTANCE",
        operationId: (unique + "-" + label + "-" + attempt).slice(0, 110),
        mutate: tables => callback(tables, current)
      });
    } catch (error) {
      if (error?.status !== 409 || attempt === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}
async function putObject(bucket, path, bytes, mimeType) {
  return store.uploadObject({ bucket, path, data: bytes, mimeType, upsert: true });
}
async function rpc(name, args) {
  let value;
  await mutate("rpc-" + name, tables => {
    const handler = GITHUB_YARDHUB_RPC_HANDLERS[name];
    assert.equal(typeof handler, "function", "Expected production RPC handler " + name);
    value = handler({ tables, args, now });
  });
  return await value;
}

try {
  const baseline = await store.readDatabase();
  assert.equal(baseline.offline, false);
  assert.equal(Object.keys(baseline.tables).length, 39);
  original = structuredClone(baseline.tables);
  const allTables = Object.keys(original);
  assert.equal(allTables.length, 39);

  // Central Bank: exercise the production optimistic-version handler and audit write.
  const bank = baseline.tables.downtime_central_bank.find(row => Number(row.id) === 1);
  assert.ok(bank, "Central Bank singleton exists");
  const bankPayload = structuredClone(bank.payload || {});
  const bankNext = { ...bankPayload, __yardhubAcceptance: unique };
  await rpc("downtime_commit_central_bank", {
    p_expected_version: bank.version, p_payload: bankNext, p_username: "DEV",
    p_action: "acceptance-probe", p_audit_details: { acceptance: unique }
  });
  let read = await store.readDatabase();
  assert.equal(read.tables.downtime_central_bank.find(row => Number(row.id) === 1).payload.__yardhubAcceptance, unique);

  // Central Config Admin / YARDHUB settings: production tier settings handler.
  const tier = read.tables.yard_hub_tier_config.find(row => Number(row.id) === 1);
  const tierPayload = structuredClone(tier.payload || {});
  const tierNext = { ...tierPayload, __yardhubAcceptance: unique };
  await rpc("yard_hub_save_tier_settings", {
    p_expected_version: tier.version, p_next_payload: tierNext, p_actor: "DEV"
  });
  read = await store.readDatabase();
  assert.equal(read.tables.yard_hub_tier_config.find(row => Number(row.id) === 1).payload.__yardhubAcceptance, unique);

  // DOWNTIME report archive and attachment metadata.
  await mutate("downtime", tables => {
    tables.downtime_reports.push({ id: unique + "-downtime-report", title: "Acceptance report", created_at: now().toISOString() });
    tables.downtime_attachments.push({ id: unique + "-downtime-attachment", report_id: unique + "-downtime-report", storage_path: unique + "/evidence.jpg", mime_type: "image/jpeg" });
  });
  read = await store.readDatabase();
  assert.ok(read.tables.downtime_reports.some(row => row.id === unique + "-downtime-report"));
  assert.ok(read.tables.downtime_attachments.some(row => row.id === unique + "-downtime-attachment"));

  // GATELOG: run the actual arrival and departure business handlers.
  let arrival;
  await mutate("gatelog-arrival", async tables => {
    const result = await GITHUB_YARDHUB_RPC_HANDLERS.gatelog_create_customer_arrival({
      tables,
      args: { p_customer_name: "Acceptance " + runId, p_registration: "YH" + runId.slice(0, 5).toUpperCase(), p_waste_types: ["General", "Scrap"], p_actor: "DEV" },
      now
    });
    arrival = result[0];
  });
  assert.ok(arrival?.visit_id && arrival?.customer_id);
  await rpc("gatelog_register_departure", { p_visit_id: arrival.visit_id, p_actor: "DEV" });
  read = await store.readDatabase();
  const visit = read.tables.gatelog_visits.find(row => row.id === arrival.visit_id);
  assert.equal(visit.status, "DEPARTED");
  assert.ok(read.tables.gatelog_vehicles.some(row => row.customer_id === arrival.customer_id));
  assert.ok(read.tables.gatelog_visit_waste_types.some(row => row.visit_id === arrival.visit_id));

  // R&M: machinery fault, notes, attachments and archived PDF export records.
  const rmFaultId = unique + "-rm-fault";
  const rmNoteId = unique + "-rm-note";
  const rmPdfId = unique + "-rm-pdf";
  const pdfPath = unique + "/acceptance-report.pdf";
  const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 65, 67, 67, 69, 80, 84, 65, 78, 67, 69, 10]);
  await mutate("rm", tables => {
    tables.repair_maintenance_faults.push({ id: rmFaultId, machine_type: "OTHER_EQUIPMENT", title: "Acceptance fault", status: "OPEN", created_at: now().toISOString() });
    tables.repair_maintenance_notes.push({ id: rmNoteId, fault_id: rmFaultId, note: "Acceptance note", created_at: now().toISOString() });
    tables.repair_maintenance_attachments.push({ id: unique + "-rm-attachment", fault_id: rmFaultId, storage_path: unique + "/attachment.jpg", mime_type: "image/jpeg" });
  });
  const pdfUpload = await putObject("repair-maintenance-reports", pdfPath, pdfBytes, "application/pdf");
  await mutate("rm-pdf-archive", tables => {
    tables.repair_maintenance_pdf_exports.push({
      id: rmPdfId, machine_type: "OTHER_EQUIPMENT", storage_path: pdfPath,
      file_name: "YARDHUB_ACCEPTANCE.pdf", mime_type: "application/pdf",
      file_size_bytes: pdfBytes.length, record_count: 1, created_by: "DEV",
      created_at: now().toISOString()
    });
  });
  const pdfRead = await store.downloadObject({ bucket: "repair-maintenance-reports", path: pdfPath });
  assert.deepEqual([...pdfRead.bytes], [...pdfBytes]);
  read = await store.readDatabase();
  assert.ok(read.tables.repair_maintenance_faults.some(row => row.id === rmFaultId));
  assert.ok(read.tables.repair_maintenance_pdf_exports.some(row => row.id === rmPdfId));

  // Photo Evidence service storage path and metadata persistence.
  const evidencePath = unique + "/evidence.jpg";
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
  await putObject("downtime-evidence", evidencePath, imageBytes, "image/jpeg");
  await mutate("photo-evidence-metadata", tables => {
    tables.downtime_attachments.push({ id: unique + "-photo-evidence", storage_path: evidencePath, mime_type: "image/jpeg", file_size_bytes: imageBytes.length });
  });
  const evidenceRead = await store.downloadObject({ bucket: "downtime-evidence", path: evidencePath });
  assert.deepEqual([...evidenceRead.bytes], [...imageBytes]);

  // YARD ROLE management: exercise actual role definition and user assignment handlers.
  const roleId = unique + "-role";
  const permissions = ["SCPL", "R&M", "Management", "SCFL", "Traffic"].map(department => ({
    department, can_view: true, can_enter: true, can_edit: false, can_manage: false
  }));
  await rpc("yard_role_save_definition", {
    ...actor, p_role_id: roleId, p_name: "Acceptance Role", p_description: "Temporary production acceptance role",
    p_status: "ACTIVE", p_expected_version: 0, p_permissions: permissions
  });
  await rpc("yard_role_assign_user", {
    ...actor, p_user_id: unique + "-user", p_staff_id: unique + "-staff", p_yard_role_id: roleId
  });
  read = await store.readDatabase();
  assert.ok(read.tables.yard_roles.some(row => row.id === roleId && row.status === "ACTIVE"));
  assert.ok(read.tables.yard_role_assignments.some(row => row.user_id === unique + "-user" && row.yard_role_id === roleId));

  // Spectator Read: confirm a second independent store sees the published records without a write.
  const spectator = createGitHubDataStore({ owner, repo, branch, token, systemId: "YARDHUB-PRIMARY", fetchImpl: globalThis.fetch, cacheStorage: memoryStorage() });
  const spectatorRead = await spectator.readDatabase();
  assert.equal(spectatorRead.offline, false);
  assert.ok(spectatorRead.tables.downtime_reports.some(row => row.id === unique + "-downtime-report"));
  assert.ok(spectatorRead.tables.gatelog_visits.some(row => row.id === arrival.visit_id));

  // Git history recovery: delete a binary object, recover its prior committed blob, and re-upload it.
  const historyPath = unique + "/history-recovery.bin";
  const historyBytes = new Uint8Array([0, 1, 2, 3, 127, 128, 254, 255]);
  const historyUpload = await putObject("downtime-evidence", historyPath, historyBytes, "application/octet-stream");
  await store.deleteObject({ bucket: "downtime-evidence", path: historyPath });
  const historicalFile = await github("/contents/storage/yardhub-primary/downtime-evidence/" + historyPath.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(historyUpload.commitSha));
  const historicalBlob = await github("/git/blobs/" + encodeURIComponent(historicalFile.sha));
  assert.equal(historicalBlob.encoding, "base64");
  assert.deepEqual([...Buffer.from(historicalBlob.content.replace(/\s/g, ""), "base64")], [...historyBytes]);
  await putObject("downtime-evidence", historyPath, new Uint8Array(Buffer.from(historicalBlob.content, "base64")), "application/octet-stream");
  const restoredHistory = await store.downloadObject({ bucket: "downtime-evidence", path: historyPath });
  assert.deepEqual([...restoredHistory.bytes], [...historyBytes]);

  // Full JSON snapshot/restore: serialize all 39 tables, restore the snapshot on the isolated test branch.
  const snapshotBeforeRestore = await store.readDatabase();
  const jsonBackup = JSON.parse(JSON.stringify({
    format: "yardhub-github-database-backup", schemaVersion: 1,
    revision: snapshotBeforeRestore.revision, tables: snapshotBeforeRestore.tables
  }));
  assert.equal(Object.keys(jsonBackup.tables).length, 39);
  await mutate("backup-probe", tables => {
    tables.downtime_reports.push({ id: unique + "-restore-probe", title: "Must disappear after restore" });
  });
  await mutate("restore-json-backup", tables => {
    for (const table of allTables) tables[table] = structuredClone(jsonBackup.tables[table] || []);
  });
  const restored = await store.readDatabase();
  assert.deepEqual(restored.tables, jsonBackup.tables, "All 39 tables must exactly match the exported JSON backup after restore.");
  assert.equal(restored.tables.downtime_reports.some(row => row.id === unique + "-restore-probe"), false);
  finalSnapshotRestored = true;

  console.log("PASS: real private-repository module acceptance (Central Bank, Central Config, DOWNTIME, GATELOG, R&M, Photo Evidence, Spectator Read, YARD ROLE); PDF archive; binary history recovery; full 39-table JSON backup/restore. All writes were isolated to a temporary Git branch.");
} finally {
  try {
    const latest = await store.readDatabase();
    if (original && !finalSnapshotRestored) {
      await store.transactDatabase({
        expectedRevision: latest.revision,
        actorId: "YARDHUB-ACCEPTANCE-ROLLBACK",
        operationId: (unique + "-rollback").slice(0, 110),
        mutate(tables) { for (const table of Object.keys(original)) tables[table] = structuredClone(original[table]); }
      });
    }
  } catch (error) {
    console.error("Temporary acceptance branch rollback warning:", error?.message || error);
  }
  try {
    await github("/git/refs/heads/" + branch, { method: "DELETE" });
  } catch (error) {
    console.error("Temporary acceptance branch cleanup warning:", error?.message || error);
    throw error;
  }
}
