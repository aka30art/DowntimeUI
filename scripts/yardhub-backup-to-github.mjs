import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const YARDHUB_TABLES = [
  "downtime_shared_state", "downtime_reports", "downtime_attachments",
  "downtime_central_bank", "downtime_central_sessions", "downtime_central_audit",
  "downtime_central_config_state", "downtime_central_config_history",
  "repair_maintenance_faults", "repair_maintenance_notes", "repair_maintenance_attachments",
  "repair_maintenance_audit", "yard_hub_tier_config", "yard_hub_access_audit",
  "repair_maintenance_machine_presets", "repair_maintenance_pdf_exports",
  "repair_maintenance_assets", "repair_maintenance_machine_settings",
  "repair_maintenance_machine_models", "downtime_daily_operator_assignments",
  "downtime_daily_operator_audit", "gatelog_customers", "gatelog_vehicles",
  "gatelog_visits", "gatelog_waste_types", "gatelog_visit_waste_types",
  "gatelog_audit", "gatelog_daily_gateman_assignments", "gatelog_report_archive",
  "yard_roles", "yard_role_department_permissions", "yard_role_assignments",
  "yard_role_assignment_audit", "downtime_roots_assignments",
  "downtime_roots_assignment_audit", "yard_role_definition_audit",
  "downtime_roots_bootstrap", "downtime_identity_reset_runs",
  "downtime_roots_role_definitions"
];

export const YARDHUB_STORAGE_BUCKETS = [
  "downtime-evidence",
  "downtime-pdfs",
  "downtime-staff-photos",
  "repair-maintenance-evidence",
  "repair-maintenance-reports"
];

const ROOT = "replication/yardhub-primary";
const PAGE_SIZE = 1000;
const MAX_CONFLICT_RETRIES = 4;

function gitBlobSha(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return crypto.createHash("sha1").update(Buffer.concat([Buffer.from("blob " + body.length + "\0"), body])).digest("hex");
}

function stableJson(value) {
  return Buffer.from(JSON.stringify(value) + "\n", "utf8");
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await callback(items[index], index);
    }
  }));
  return results;
}

function requireEnv(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error("Missing required GitHub Actions secret: " + name);
  return value;
}

export function createYardHubBackupRunner({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  pageSize = PAGE_SIZE,
  conflictRetries = MAX_CONFLICT_RETRIES
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");

  async function request(url, options = {}, { allow404 = false, raw = false } = {}) {
    const response = await fetchImpl(url, options);
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw Object.assign(new Error("Request failed (" + response.status + "): " + body.slice(0, 500)), { status: response.status });
    }
    return raw ? Buffer.from(await response.arrayBuffer()) : response.json();
  }

  async function exportTable({ supabaseUrl, serviceKey, table }) {
    if (table === "downtime_central_sessions") return [];
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const url = supabaseUrl + "/rest/v1/" + encodeURIComponent(table) + "?select=*";
      const page = await request(url, {
        headers: {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey,
          Range: offset + "-" + (offset + pageSize - 1),
          Prefer: "count=exact"
        }
      });
      if (!Array.isArray(page)) throw new Error("Supabase returned an invalid table response for " + table);
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return rows;
  }

  async function listStorageBucket({ supabaseUrl, serviceKey, bucket }) {
    const objects = [];
    async function walk(prefix = "") {
      for (let offset = 0; ; offset += pageSize) {
        const response = await request(supabaseUrl + "/storage/v1/object/list/" + encodeURIComponent(bucket), {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: "Bearer " + serviceKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prefix, limit: pageSize, offset,
            sortBy: { column: "name", order: "asc" }
          })
        });
        if (!Array.isArray(response)) throw new Error("Supabase Storage returned an invalid listing for " + bucket);
        for (const item of response) {
          const name = String(item.name || "");
          if (!name || name.includes("/") || name === "." || name === "..") continue;
          const path = prefix ? prefix + "/" + name : name;
          if (item.id === null || item.metadata === null || item.metadata === undefined) {
            await walk(path);
            continue;
          }
          const encoded = path.split("/").map(encodeURIComponent).join("/");
          const bytes = await request(supabaseUrl + "/storage/v1/object/" + encodeURIComponent(bucket) + "/" + encoded, {
            headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey }
          }, { raw: true });
          objects.push({
            path,
            bytes,
            mimeType: item.metadata?.mimetype || item.metadata?.mimeType || "application/octet-stream",
            size: bytes.byteLength,
            updatedAt: item.updated_at || item.updatedAt || null
          });
        }
        if (response.length < pageSize) break;
      }
    }
    await walk("");
    return objects;
  }

  async function fetchGitHubHead({ api, repository, token, branch }) {
    const ref = await request(api + "/repos/" + repository + "/git/ref/heads/" + encodePath(branch), {
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" }
    });
    const headSha = ref?.object?.sha;
    if (!headSha) throw new Error("The private data repository branch is missing. Initialise it with a README first.");
    const commit = await request(api + "/repos/" + repository + "/git/commits/" + headSha, {
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" }
    });
    const tree = await request(api + "/repos/" + repository + "/git/trees/" + commit.tree.sha + "?recursive=1", {
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (tree.truncated) throw new Error("The GitHub data repository tree is truncated; split the backup into smaller repositories.");
    return { headSha, treeSha: commit.tree.sha, entries: new Map((tree.tree || []).filter(x => x.type === "blob").map(x => [x.path, x.sha])) };
  }

  async function readAuthorityAtHead({ api, repository, token, head }) {
    if (!head.entries.has("control/authority.json")) return null;
    const authorityFile = await request(
      api + "/repos/" + repository + "/contents/control/authority.json?ref=" + encodeURIComponent(head.headSha),
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );
    if (authorityFile?.encoding !== "base64" || typeof authorityFile.content !== "string") {
      throw new Error("The GitHub authority manifest could not be read safely; backup stopped.");
    }
    try {
      const authority = JSON.parse(Buffer.from(authorityFile.content, "base64").toString("utf8"));
      if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
        throw new Error("Invalid authority object.");
      }
      return authority;
    } catch {
      throw new Error("The GitHub authority manifest is invalid; backup stopped.");
    }
  }

  function authorityPause(authority) {
    if (authority && (authority.status !== "ACTIVE" || authority.primarySystemId !== "YARDHUB-PRIMARY")) {
      return {
        skipped: true,
        reason: "YARDHUB is not the active primary in the GitHub authority manifest.",
        primarySystemId: authority.primarySystemId || null,
        authorityStatus: authority.status || null
      };
    }
    return null;
  }

  async function createGitHubBlob({ api, repository, token, bytes }) {
    const response = await request(api + "/repos/" + repository + "/git/blobs", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: Buffer.from(bytes).toString("base64"), encoding: "base64" })
    });
    return response.sha;
  }

  async function commitSnapshot({ api, repository, token, branch, files, deletions, message, authorityCheck = null }) {
    for (let attempt = 0; attempt < conflictRetries; attempt += 1) {
      const current = await fetchGitHubHead({ api, repository, token, branch });
      if (authorityCheck) {
        const paused = await authorityCheck(current);
        if (paused) return paused;
      }
      const desired = new Map(files.map(file => [file.path, file.bytes]));
      const entries = [];
      for (const file of files) {
        const sha = gitBlobSha(file.bytes);
        if (current.entries.get(file.path) === sha) continue;
        const blobSha = await createGitHubBlob({ api, repository, token, bytes: file.bytes });
        entries.push({ path: file.path, mode: "100644", type: "blob", sha: blobSha });
      }
      for (const path of deletions) {
        if (current.entries.has(path) && !desired.has(path)) entries.push({ path, mode: "100644", type: "blob", sha: null });
      }
      if (!entries.length) return { changed: false, headSha: current.headSha, commitSha: null };

      const tree = await request(api + "/repos/" + repository + "/git/trees", {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"
        },
        body: JSON.stringify({ base_tree: current.treeSha, tree: entries })
      });
      const commit = await request(api + "/repos/" + repository + "/git/commits", {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"
        },
        body: JSON.stringify({ message, tree: tree.sha, parents: [current.headSha] })
      });
      try {
        await request(api + "/repos/" + repository + "/git/refs/heads/" + encodePath(branch), {
          method: "PATCH",
          headers: {
            Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
            "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"
          },
          body: JSON.stringify({ sha: commit.sha, force: false })
        });
        return { changed: true, headSha: commit.sha, commitSha: commit.sha, filesChanged: entries.length };
      } catch (error) {
        if (![409, 422].includes(error.status) || attempt === conflictRetries - 1) throw error;
      }
    }
    throw new Error("GitHub backup conflicted repeatedly.");
  }

  async function run({ env = process.env } = {}) {
    const supabaseUrl = requireEnv(env, "SUPABASE_URL").replace(/\/$/, "");
    const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
    const token = requireEnv(env, "YARDHUB_DATA_TOKEN");
    const repository = requireEnv(env, "YARDHUB_DATA_REPOSITORY");
    const branch = String(env.YARDHUB_DATA_BRANCH || "main").trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("YARDHUB_DATA_REPOSITORY must be owner/repository.");
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.split("/").some(segment => !segment || segment === "." || segment === "..")) {
      throw new Error("YARDHUB_DATA_BRANCH is invalid.");
    }
    const destination = repository.toLowerCase();
    if (destination === "aka30art/downtime" || destination === "aka30art/downtimeui") {
      throw new Error("The protected DOWNTIME repository and public DOWNTIMEUI source repository are forbidden backup destinations.");
    }
    const sourceUrl = new URL(supabaseUrl);
    if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "ygwfipksbbprqynvbklk.supabase.co" ||
        sourceUrl.pathname !== "/" || sourceUrl.search || sourceUrl.hash) {
      throw new Error("SUPABASE_URL must identify the approved YARDHUB primary Supabase project. No source records were read.");
    }
    const api = "https://api.github.com";
    const githubHeaders = {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const destinationMetadata = await request(api + "/repos/" + repository, { headers: githubHeaders });
    if (destinationMetadata?.private !== true ||
        String(destinationMetadata?.full_name || "").toLowerCase() !== destination) {
      throw new Error("YARDHUB backup destination must be the exact requested PRIVATE GitHub repository. No source records were read.");
    }
    if (destinationMetadata.archived === true) throw new Error("YARDHUB backup destination is archived.");

    const destinationHead = await fetchGitHubHead({ api, repository, token, branch });
    const initialPause = authorityPause(await readAuthorityAtHead({
      api, repository, token, head: destinationHead
    }));
    if (initialPause) return initialPause;

    const tableRows = await mapLimit(YARDHUB_TABLES, 4, table => exportTable({ supabaseUrl, serviceKey, table }));
    const files = [];
    const tableCounts = {};
    const checksums = {};
    for (let i = 0; i < YARDHUB_TABLES.length; i += 1) {
      const table = YARDHUB_TABLES[i];
      const rows = tableRows[i];
      const bytes = stableJson(rows);
      const path = ROOT + "/tables/" + table + ".json";
      files.push({ path, bytes });
      tableCounts[table] = rows.length;
      checksums[path] = gitBlobSha(bytes);
    }

    const storageObjects = [];
    for (const bucket of YARDHUB_STORAGE_BUCKETS) {
      const objects = await listStorageBucket({ supabaseUrl, serviceKey, bucket });
      for (const object of objects) {
        const path = ROOT + "/storage/" + bucket + "/" + object.path;
        const metadataPath = ROOT + "/storage-metadata/" + bucket + "/" + object.path + ".json";
        const metadata = stableJson({
          bucket, path: object.path, mimeType: object.mimeType,
          size: object.size, updatedAt: object.updatedAt
        });
        files.push({ path, bytes: object.bytes });
        files.push({ path: metadataPath, bytes: metadata });
        checksums[path] = gitBlobSha(object.bytes);
        checksums[metadataPath] = gitBlobSha(metadata);
        storageObjects.push({ bucket, path: object.path, size: object.size, mimeType: object.mimeType });
      }
    }

    const current = await fetchGitHubHead({ api, repository, token, branch });
    const expectedPaths = new Set(files.map(file => file.path));
    const stale = [...current.entries.keys()].filter(path =>
      path.startsWith(ROOT + "/") && !expectedPaths.has(path) && path !== ROOT + "/manifest.json"
    );
    const dataChanged = files.some(file => current.entries.get(file.path) !== gitBlobSha(file.bytes)) || stale.length > 0;
    if (!dataChanged) return { changed: false, message: "No source data changes; existing GitHub backup remains current.", tableCounts, storageObjectCount: storageObjects.length };

    const manifest = {
      schemaVersion: 1,
      source: "YARDHUB-SUPABASE",
      sourceProjectRef: supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || null,
      exportedAt: now().toISOString(),
      tableCounts,
      tableCount: YARDHUB_TABLES.length,
      storageObjectCount: storageObjects.length,
      storageBytes: storageObjects.reduce((total, item) => total + item.size, 0),
      sessionsExcluded: true,
      checksums
    };
    files.push({ path: ROOT + "/manifest.json", bytes: stableJson(manifest) });
    const result = await commitSnapshot({
      api, repository, token, branch, files, deletions: stale,
      message: "backup: replicate YARDHUB primary snapshot " + manifest.exportedAt,
      authorityCheck: async head => authorityPause(await readAuthorityAtHead({
        api, repository, token, head
      }))
    });
    if (result.skipped) return result;
    return { ...result, tableCount: YARDHUB_TABLES.length, tableCounts, storageObjectCount: storageObjects.length, storageBytes: manifest.storageBytes };
  }

  return Object.freeze({ run });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  createYardHubBackupRunner().run().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }).catch(error => {
    process.stderr.write((error?.stack || error?.message || String(error)) + "\n");
    process.exitCode = 1;
  });
}
