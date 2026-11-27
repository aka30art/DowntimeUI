import { GITHUB_YARDHUB_TABLES } from "./github-database-bootstrap.js";
const DEFAULT_API = "https://api.github.com";
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_MAX_SHARD_BYTES = 512 * 1024;
const AUTHORITY_PATH = "control/authority.json";
const ALLOWED_SYSTEMS = new Set(["YARDHUB-PRIMARY", "DOWNTIMEUI-GITHUB"]);

export class GitHubStoreError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "GitHubStoreError";
    this.status = status;
    this.details = details;
  }
}

function requiredString(value, label, pattern) {
  const result = String(value ?? "").trim();
  if (!result || (pattern && !pattern.test(result))) {
    throw new TypeError(label + " is invalid.");
  }
  return result;
}

function branchPath(branch) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function contentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64Utf8(value) {
  const binary = globalThis.atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function asDate(value, now) {
  const date = value || now().toISOString().slice(0, 10);
  return requiredString(date, "Event date", /^\d{4}-\d{2}-\d{2}$/);
}

function asJsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be a JSON object.");
  }
  return value;
}

function validateAuthority(authority) {
  asJsonObject(authority, "Authority manifest");
  if (!Number.isInteger(authority.epoch) || authority.epoch < 1) {
    throw new GitHubStoreError("Authority manifest has an invalid epoch.");
  }
  if (!ALLOWED_SYSTEMS.has(authority.primarySystemId) ||
      !ALLOWED_SYSTEMS.has(authority.secondarySystemId) ||
      authority.primarySystemId === authority.secondarySystemId) {
    throw new GitHubStoreError("Authority manifest contains invalid system identities.");
  }
  if (!["ACTIVE", "PREPARING", "FROZEN"].includes(authority.status)) {
    throw new GitHubStoreError("Authority manifest has an invalid cutover status.");
  }
  return authority;
}


const YARDHUB_STORAGE_BUCKETS = new Set([
  "downtime-evidence", "downtime-pdfs", "downtime-staff-photos",
  "repair-maintenance-evidence", "repair-maintenance-reports"
]);

function validateYardHubBackupManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 || manifest.source !== "YARDHUB-SUPABASE" ||
      manifest.sessionsExcluded !== true || !manifest.tableCounts ||
      typeof manifest.tableCounts !== "object" || !manifest.checksums ||
      typeof manifest.checksums !== "object" || !Number.isFinite(Date.parse(manifest.exportedAt)) ||
      !Number.isInteger(manifest.tableCount) || manifest.tableCount !== GITHUB_YARDHUB_TABLES.length ||
      !Number.isInteger(manifest.storageObjectCount) || manifest.storageObjectCount < 0 ||
      !Number.isInteger(manifest.storageBytes) || manifest.storageBytes < 0) {
    throw new GitHubStoreError("YARDHUB primary backup manifest is invalid or incomplete.");
  }
  const names = Object.keys(manifest.tableCounts).sort();
  const expected = [...GITHUB_YARDHUB_TABLES].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new GitHubStoreError("YARDHUB primary backup table catalogue does not match the supported schema.");
  }
  for (const [table, count] of Object.entries(manifest.tableCounts)) {
    if (!Number.isInteger(count) || count < 0) throw new GitHubStoreError("YARDHUB backup row count is invalid for " + table + ".");
  }
  return manifest;
}

export function createGitHubDataStore({
  owner,
  repo,
  branch = "data/yardhub",
  token,
  systemId = "DOWNTIMEUI-GITHUB",
  apiBase = DEFAULT_API,
  fetchImpl = globalThis.fetch,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxShardBytes = DEFAULT_MAX_SHARD_BYTES,
  now = () => new Date(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  owner = requiredString(owner, "GitHub owner", /^[A-Za-z0-9-]+$/);
  repo = requiredString(repo, "GitHub repository", /^[A-Za-z0-9_.-]+$/);
  branch = requiredString(branch, "Git branch", /^[A-Za-z0-9._/-]+$/);
  token = requiredString(token, "GitHub token");
  systemId = requiredString(systemId, "System identity", /^[A-Z0-9-]+$/);
  if (!ALLOWED_SYSTEMS.has(systemId)) throw new TypeError("Unsupported system identity.");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 10) {
    throw new TypeError("maxRetries must be an integer from 1 to 10.");
  }

  const root = apiBase.replace(/\/$/, "") + "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const request = async (path, options = {}, { allowNotFound = false } = {}) => {
    const response = await fetchImpl(root + path, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {})
      }
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); }
      catch { throw new GitHubStoreError("GitHub returned an unreadable response.", response.status, raw.slice(0, 200)); }
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      throw new GitHubStoreError(data?.message || ("GitHub API request failed (" + response.status + ")."), response.status, data);
    }
    return data;
  };

  const getHead = async () => {
    const result = await request("/git/ref/heads/" + branchPath(branch));
    if (!result?.object?.sha) throw new GitHubStoreError("GitHub data branch has no valid HEAD.");
    return result.object.sha;
  };

  const getCommitTree = async (commitSha) => {
    const result = await request("/git/commits/" + encodeURIComponent(commitSha));
    if (!result?.tree?.sha) throw new GitHubStoreError("GitHub returned an invalid commit tree.");
    return result.tree.sha;
  };

  const readJsonAt = async (path, ref) => {
    const result = await request("/contents/" + contentPath(path) + "?ref=" + encodeURIComponent(ref), {}, { allowNotFound: true });
    if (!result) return null;
    if (result.type !== "file" || result.encoding !== "base64" || typeof result.content !== "string") {
      throw new GitHubStoreError("Expected a base64-encoded JSON file at " + path + ".");
    }
    const text = decodeBase64Utf8(result.content);
    try { return JSON.parse(text); }
    catch { throw new GitHubStoreError("Stored JSON is invalid at " + path + "."); }
  };

  const commitJsonFilesAtHead = async ({ headSha, treeSha, files, message }) => {
    if (!Array.isArray(files) || files.length < 1) throw new TypeError("At least one JSON file is required.");
    const entries = await Promise.all(files.map(async ({ path, value }) => {
      const content = encodeJson(value);
      if (byteLength(content) > maxShardBytes) {
        throw new GitHubStoreError("The JSON shard exceeds the configured size limit: " + path);
      }
      const blob = await request("/git/blobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, encoding: "utf-8" })
      });
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    }));
    const tree = await request("/git/trees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: treeSha, tree: entries })
    });
    const commit = await request("/git/commits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] })
    });
    try {
      await request("/git/refs/heads/" + branchPath(branch), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false })
      });
      return { committed: true, commitSha: commit.sha };
    } catch (error) {
      if (error instanceof GitHubStoreError && (error.status === 409 || error.status === 422)) {
        return { committed: false, conflict: error };
      }
      throw error;
    }
  };

  const commitJsonAtHead = ({ headSha, treeSha, path, value, message }) =>
    commitJsonFilesAtHead({ headSha, treeSha, files: [{ path, value }], message });

  const commitTreeEntriesAtHead = async ({ headSha, treeSha, entries, message }) => {
    const tree = await request("/git/trees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: treeSha, tree: entries })
    });
    const commit = await request("/git/commits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] })
    });
    try {
      await request("/git/refs/heads/" + branchPath(branch), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha, force: false })
      });
      return { committed: true, commitSha: commit.sha };
    } catch (error) {
      if (error instanceof GitHubStoreError && (error.status === 409 || error.status === 422)) {
        return { committed: false, conflict: error };
      }
      throw error;
    }
  };

  const databaseManifestPath = "database/" + systemId.toLowerCase() + "/manifest.json";
  const databaseTablePath = (table) => "database/" + systemId.toLowerCase() + "/tables/" + table + ".json";
  const validTableName = (table) => requiredString(table, "Database table", /^[a-z][a-z0-9_]{0,62}$/);
  function validateDatabaseManifest(manifest) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new GitHubStoreError("GitHub database manifest is missing or malformed.");
    }
    if (manifest.schemaVersion !== 1 || manifest.systemId !== systemId ||
        !Number.isInteger(manifest.revision) || manifest.revision < 0 ||
        !manifest.tables || typeof manifest.tables !== "object" || Array.isArray(manifest.tables)) {
      throw new GitHubStoreError("GitHub database manifest has an unsupported schema or revision.");
    }
    for (const [name, meta] of Object.entries(manifest.tables)) {
      validTableName(name);
      if (!meta || typeof meta !== "object" || !Number.isInteger(meta.version) || meta.version < 1) {
        throw new GitHubStoreError("GitHub database table metadata is invalid: " + name);
      }
    }
    return manifest;
  }
  const emptyDatabaseManifest = () => ({
    schemaVersion: 1,
    systemId,
    revision: 0,
    tables: {},
    updatedAt: null
  });
  const readDatabaseAtHead = async (headSha) => {
    const manifest = validateDatabaseManifest(await readJsonAt(databaseManifestPath, headSha) || emptyDatabaseManifest());
    const entries = await Promise.all(Object.keys(manifest.tables).map(async (name) => {
      const shard = await readJsonAt(databaseTablePath(name), headSha);
      if (!shard || shard.schemaVersion !== 1 || shard.table !== name || !Array.isArray(shard.rows)) {
        throw new GitHubStoreError("GitHub database table shard is missing or malformed: " + name);
      }
      return [name, shard.rows];
    }));
    return { manifest, tables: Object.fromEntries(entries), headSha };
  };

  const mutateAuthority = async (expectedEpoch, mutator, message) => {
    if (!Number.isInteger(expectedEpoch) || expectedEpoch < 1) {
      throw new TypeError("expectedEpoch must be a positive integer.");
    }
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const headSha = await getHead();
      const treeSha = await getCommitTree(headSha);
      const current = validateAuthority(await readJsonAt(AUTHORITY_PATH, headSha));
      if (current.epoch !== expectedEpoch) {
        throw new GitHubStoreError("Authority epoch changed. Refresh before retrying.", 409, { currentEpoch: current.epoch });
      }
      const next = validateAuthority(mutator(structuredClone(current)));
      const result = await commitJsonAtHead({
        headSha, treeSha, path: AUTHORITY_PATH, value: next,
        message: message + " (epoch " + current.epoch + ")"
      });
      if (result.committed) return { authority: next, commitSha: result.commitSha };
      await sleep(Math.min(100 * (2 ** attempt), 1200));
    }
    throw new GitHubStoreError("Authority update conflicted repeatedly. No change was committed.", 409);
  };

  return Object.freeze({
    owner, repo, branch, systemId,

    async ensureAuthority() {
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const headSha = await getHead();
        const treeSha = await getCommitTree(headSha);
        const current = await readJsonAt(AUTHORITY_PATH, headSha);
        if (current) return validateAuthority(current);
        const authority = validateAuthority({
          schemaVersion: 1,
          systemId: "YARDHUB-ECOSYSTEM",
          primarySystemId: "YARDHUB-PRIMARY",
          secondarySystemId: "DOWNTIMEUI-GITHUB",
          epoch: 1,
          status: "ACTIVE",
          replication: {
            direction: "YARDHUB-PRIMARY_TO_DOWNTIMEUI-GITHUB",
            status: "NOT_CONFIGURED",
            lastSuccessfulCheckpoint: null
          },
          updatedAt: now().toISOString()
        });
        const result = await commitJsonAtHead({
          headSha, treeSha, path: AUTHORITY_PATH, value: authority,
          message: "Initialise YARDHUB GitHub data authority"
        });
        if (result.committed) return authority;
        await sleep(Math.min(100 * (2 ** attempt), 1200));
      }
      throw new GitHubStoreError("Could not initialise GitHub data authority because the branch changed repeatedly.", 409);
    },

    async readAuthority() {
      const headSha = await getHead();
      return validateAuthority(await readJsonAt(AUTHORITY_PATH, headSha));
    },

    async appendEvent(input) {
      asJsonObject(input, "Event");
      const moduleName = requiredString(input.module, "Module", /^[A-Z][A-Z0-9_-]{1,39}$/);
      const eventId = requiredString(input.eventId, "Event ID", /^[A-Za-z0-9._:-]{8,120}$/);
      const entityId = requiredString(input.entityId, "Entity ID", /^[A-Za-z0-9._:-]{1,120}$/);
      const eventType = requiredString(input.eventType, "Event type", /^[A-Z][A-Z0-9_-]{1,59}$/);
      const actorId = requiredString(input.actorId, "Actor ID", /^[A-Za-z0-9._:-]{1,120}$/);
      const payload = asJsonObject(input.payload, "Event payload");
      const date = asDate(input.date, now);

      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const headSha = await getHead();
        const treeSha = await getCommitTree(headSha);
        const authority = validateAuthority(await readJsonAt(AUTHORITY_PATH, headSha));
        const path = "events/" + systemId.toLowerCase() + "/" + moduleName.toLowerCase() + "/" + date + ".json";
        const existing = await readJsonAt(path, headSha) || {
          schemaVersion: 1, module: moduleName, date, writerSystemId: systemId, events: []
        };
        if (!Array.isArray(existing.events)) throw new GitHubStoreError("Event shard is malformed at " + path + ".");
        const duplicate = existing.events.find((event) => event.eventId === eventId);
        if (duplicate) return { ok: true, duplicate: true, event: duplicate, authority, path };

        const event = {
          schemaVersion: 1,
          eventId,
          entityId,
          eventType,
          module: moduleName,
          payload,
          actorId,
          createdAt: now().toISOString(),
          writerSystemId: systemId,
          authorityEpoch: authority.epoch,
          writeMode: authority.primarySystemId === systemId ? "PRIMARY" : "SECONDARY_LOCAL"
        };
        const next = { ...existing, events: [...existing.events, event] };
        const result = await commitJsonAtHead({
          headSha, treeSha, path, value: next,
          message: "YARDHUB data: " + moduleName + " " + eventType + " " + eventId
        });
        if (result.committed) return { ok: true, duplicate: false, event, authority, path, commitSha: result.commitSha };
        await sleep(Math.min(100 * (2 ** attempt), 1200));
      }
      throw new GitHubStoreError("Event write conflicted repeatedly. Refresh and retry; no event was overwritten.", 409);
    },

    async writeSnapshot({ module: moduleInput, snapshotId: snapshotInput, actorId, payload, expectedVersion = null } = {}) {
      const moduleName = requiredString(moduleInput, "Snapshot module", /^[A-Z][A-Z0-9_-]{1,39}$/);
      const snapshotId = requiredString(snapshotInput, "Snapshot ID", /^[A-Za-z0-9._:-]{1,120}$/);
      requiredString(actorId, "Snapshot actor");
      asJsonObject(payload, "Snapshot payload");
      if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
        throw new TypeError("expectedVersion must be null or a positive integer.");
      }
      const path = "snapshots/" + systemId.toLowerCase() + "/" + moduleName.toLowerCase() + "/" + encodeURIComponent(snapshotId) + ".json";

      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const headSha = await getHead();
        const treeSha = await getCommitTree(headSha);
        const authority = validateAuthority(await readJsonAt(AUTHORITY_PATH, headSha));
        const current = await readJsonAt(path, headSha);
        const currentVersion = current?.version ?? null;
        if (currentVersion !== expectedVersion) {
          throw new GitHubStoreError("Snapshot version changed. Refresh the snapshot before saving.", 409, {
            expectedVersion, currentVersion
          });
        }
        const next = {
          schemaVersion: 1, module: moduleName, snapshotId, writerSystemId: systemId,
          authorityEpoch: authority.epoch,
          writeMode: authority.primarySystemId === systemId ? "PRIMARY" : "SECONDARY_LOCAL",
          version: (currentVersion || 0) + 1,
          actorId, updatedAt: now().toISOString(), payload
        };
        const result = await commitJsonAtHead({
          headSha, treeSha, path, value: next,
          message: "YARDHUB snapshot: " + moduleName + " " + snapshotId + " v" + next.version
        });
        if (result.committed) return { ok: true, snapshot: next, path, commitSha: result.commitSha };
        await sleep(Math.min(100 * (2 ** attempt), 1200));
      }
      throw new GitHubStoreError("Snapshot save conflicted repeatedly. Refresh before retrying.", 409);
    },

    async readSnapshot({ module: moduleInput, snapshotId: snapshotInput, writerSystemId = systemId } = {}) {
      const moduleName = requiredString(moduleInput, "Snapshot module", /^[A-Z][A-Z0-9_-]{1,39}$/);
      const snapshotId = requiredString(snapshotInput, "Snapshot ID", /^[A-Za-z0-9._:-]{1,120}$/);
      if (!ALLOWED_SYSTEMS.has(writerSystemId)) throw new TypeError("Unsupported writer system identity.");
      const path = "snapshots/" + writerSystemId.toLowerCase() + "/" + moduleName.toLowerCase() + "/" + encodeURIComponent(snapshotId) + ".json";
      const headSha = await getHead();
      return readJsonAt(path, headSha);
    },

    async readTable(tableInput) {
      const table = requiredString(tableInput, "Database table", /^[a-z][a-z0-9_]{0,62}$/);
      const headSha = await getHead();
      const shard = await readJsonAt(databaseTablePath(table), headSha);
      if (!shard) return [];
      if (shard.schemaVersion !== 1 || shard.table !== table || !Array.isArray(shard.rows)) {
        throw new GitHubStoreError("GitHub database table shard is missing or malformed: " + table);
      }
      return shard.rows;
    },

    async inspectYardHubPrimaryBackup() {
      const headSha = await getHead();
      const manifest = await readJsonAt("replication/yardhub-primary/manifest.json", headSha);
      if (!manifest) return null;
      validateYardHubBackupManifest(manifest);
      return {
        exportedAt: manifest.exportedAt,
        tableCount: manifest.tableCount,
        storageObjectCount: manifest.storageObjectCount,
        storageBytes: manifest.storageBytes,
        source: manifest.source
      };
    },

    async restoreYardHubPrimaryBackup({ expectedRevision = 0 } = {}) {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new TypeError("Expected database revision must be a non-negative integer.");
      }
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const headSha = await getHead();
        const treeSha = await getCommitTree(headSha);
        const current = await readDatabaseAtHead(headSha);
        if (current.manifest.revision !== expectedRevision || Object.keys(current.tables).length > 0) {
          throw new GitHubStoreError("Restore is allowed only into an empty GitHub database at the expected revision. Existing operational data was not overwritten.", 409, {
            expectedRevision, currentRevision: current.manifest.revision,
            existingTables: Object.keys(current.tables)
          });
        }
        const replicaPath = "replication/yardhub-primary/manifest.json";
        const backupManifest = await readJsonAt(replicaPath, headSha);
        if (!backupManifest) throw new GitHubStoreError("No YARDHUB primary backup snapshot was found in this private repository.", 404);
        validateYardHubBackupManifest(backupManifest);
        const sourceTree = await request("/git/trees/" + encodeURIComponent(treeSha) + "?recursive=1");
        if (sourceTree.truncated) throw new GitHubStoreError("Private data repository tree is truncated. Restore cannot be verified safely.", 413);
        const sourceEntries = new Map((sourceTree.tree || []).filter(item => item.type === "blob").map(item => [item.path, item]));
        const additions = [];
        const tableMetadata = {};
        const exportedAt = new Date(backupManifest.exportedAt).toISOString();

        for (const table of GITHUB_YARDHUB_TABLES) {
          const sourcePath = "replication/yardhub-primary/tables/" + table + ".json";
          const sourceEntry = sourceEntries.get(sourcePath);
          if (!sourceEntry || sourceEntry.sha !== backupManifest.checksums[sourcePath]) {
            throw new GitHubStoreError("YARDHUB backup checksum verification failed for table " + table + ".");
          }
          const rows = await readJsonAt(sourcePath, headSha);
          if (!Array.isArray(rows) || rows.length !== backupManifest.tableCounts[table]) {
            throw new GitHubStoreError("YARDHUB backup row count is invalid for table " + table + ".");
          }
          const value = { schemaVersion: 1, systemId, table, rows };
          const encoded = encodeJson(value);
          if (byteLength(encoded) > maxShardBytes) {
            throw new GitHubStoreError("YARDHUB table " + table + " exceeds the configured atomic table shard limit. No restore was committed.", 413);
          }
          const blob = await request("/git/blobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: encoded, encoding: "utf-8" })
          });
          additions.push({ path: databaseTablePath(table), mode: "100644", type: "blob", sha: blob.sha });
          tableMetadata[table] = { version: 1, updatedAt: exportedAt };
        }

        const storageRoots = [
          "replication/yardhub-primary/storage/",
          "replication/yardhub-primary/storage-metadata/"
        ];
        let storageObjectCount = 0;
        let storageBytes = 0;
        for (const [sourcePath, expectedSha] of Object.entries(backupManifest.checksums)) {
          if (!storageRoots.some(prefix => sourcePath.startsWith(prefix))) continue;
          const sourceEntry = sourceEntries.get(sourcePath);
          if (!sourceEntry || sourceEntry.sha !== expectedSha) {
            throw new GitHubStoreError("YARDHUB backup checksum verification failed for storage object " + sourcePath + ".");
          }
          const relative = sourcePath.startsWith(storageRoots[0])
            ? sourcePath.slice(storageRoots[0].length)
            : sourcePath.slice(storageRoots[1].length);
          const parts = relative.split("/");
          const bucket = requiredString(parts.shift(), "Backup Storage bucket", /^[a-z0-9][a-z0-9_-]{0,62}$/);
          if (!parts.length || parts.some(part => !part || part === "." || part === ".." || !/^[A-Za-z0-9._-]+$/.test(part))) {
            throw new GitHubStoreError("YARDHUB backup contains an invalid Storage object path.");
          }
          if (!YARDHUB_STORAGE_BUCKETS.has(bucket)) {
            throw new GitHubStoreError("YARDHUB backup contains an unsupported Storage bucket: " + bucket);
          }
          const objectPath = parts.join("/");
          if (sourcePath.startsWith(storageRoots[0])) {
            storageObjectCount += 1;
            storageBytes += Number(sourceEntry.size || 0);
            additions.push({
              path: "storage/" + systemId.toLowerCase() + "/" + bucket + "/" + objectPath,
              mode: "100644", type: "blob", sha: sourceEntry.sha
            });
          } else {
            additions.push({
              path: "storage/" + systemId.toLowerCase() + "/metadata/" + bucket + "/" + objectPath,
              mode: "100644", type: "blob", sha: sourceEntry.sha
            });
          }
        }
        if (storageObjectCount !== backupManifest.storageObjectCount ||
            storageBytes !== backupManifest.storageBytes) {
          throw new GitHubStoreError("YARDHUB backup Storage counts or byte totals do not match its manifest.");
        }

        const nextManifest = {
          schemaVersion: 1,
          systemId,
          revision: 1,
          tables: tableMetadata,
          updatedAt: exportedAt,
          restoredFrom: {
            source: backupManifest.source,
            exportedAt,
            sourceProjectRef: backupManifest.sourceProjectRef || null,
            tableCount: backupManifest.tableCount,
            storageObjectCount,
            storageBytes,
            checksumVerified: true
          }
        };
        const manifestContent = encodeJson(nextManifest);
        if (byteLength(manifestContent) > maxShardBytes) {
          throw new GitHubStoreError("Restored database manifest exceeds the configured shard limit.");
        }
        const manifestBlob = await request("/git/blobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: manifestContent, encoding: "utf-8" })
        });
        additions.push({ path: databaseManifestPath, mode: "100644", type: "blob", sha: manifestBlob.sha });

        const committed = await commitTreeEntriesAtHead({
          headSha, treeSha, entries: additions,
          message: "restore: verified YARDHUB primary backup " + exportedAt
        });
        if (committed.committed) {
          return {
            restored: true,
            revision: 1,
            commitSha: committed.commitSha,
            exportedAt,
            tableCount: GITHUB_YARDHUB_TABLES.length,
            storageObjectCount,
            storageBytes,
            checksumVerified: true
          };
        }
        await sleep(Math.min(100 * (2 ** attempt), 1200));
      }
      throw new GitHubStoreError("YARDHUB restore conflicted repeatedly. No partial restore was committed.", 409);
    },

    async readDatabase() {
      const headSha = await getHead();
      const { manifest, tables } = await readDatabaseAtHead(headSha);
      return { revision: manifest.revision, manifest, tables };
    },

    async transactDatabase({ expectedRevision, actorId, operationId = null, mutate } = {}) {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new TypeError("expectedRevision must be a non-negative integer.");
      }
      requiredString(actorId, "Database transaction actor");
      if (typeof mutate !== "function") throw new TypeError("A database mutator function is required.");
      if (operationId !== null) requiredString(operationId, "Database operation ID", /^[A-Za-z0-9._:-]{8,120}$/);

      const headSha = await getHead();
      const treeSha = await getCommitTree(headSha);
      const current = await readDatabaseAtHead(headSha);
      if (current.manifest.revision !== expectedRevision) {
        throw new GitHubStoreError("Database revision changed. Refresh before retrying.", 409, {
          expectedRevision, currentRevision: current.manifest.revision
        });
      }
      const tables = structuredClone(current.tables);
      const result = await mutate(tables);
      const names = new Set([...Object.keys(current.tables), ...Object.keys(tables)]);
      const changed = [];
      const nextManifest = structuredClone(current.manifest);
      for (const rawName of names) {
        const name = validTableName(rawName);
        const beforeExists = Object.prototype.hasOwnProperty.call(current.tables, name);
        const afterExists = Object.prototype.hasOwnProperty.call(tables, name);
        if (afterExists && !Array.isArray(tables[name])) {
          throw new TypeError("Database table " + name + " must be an array of records.");
        }
        if (beforeExists === afterExists && JSON.stringify(current.tables[name]) === JSON.stringify(tables[name])) continue;
        if (!afterExists) {
          throw new GitHubStoreError("Database table deletion is disabled; use explicit archive/retention operations.");
        }
        changed.push({
          path: databaseTablePath(name),
          value: { schemaVersion: 1, systemId, table: name, rows: tables[name] }
        });
        nextManifest.tables[name] = {
          version: (current.manifest.tables[name]?.version || 0) + 1,
          updatedAt: now().toISOString()
        };
      }
      if (!changed.length) {
        return { committed: false, revision: current.manifest.revision, result, manifest: current.manifest };
      }
      nextManifest.revision = current.manifest.revision + 1;
      nextManifest.updatedAt = now().toISOString();
      changed.push({ path: databaseManifestPath, value: nextManifest });
      const committed = await commitJsonFilesAtHead({
        headSha, treeSha, files: changed,
        message: "YARDHUB database transaction r" + nextManifest.revision + " · " + String(operationId || "operation").slice(0, 80)
      });
      if (!committed.committed) {
        throw new GitHubStoreError("Database transaction conflicted with another writer. No records were committed; reload and retry.", 409);
      }
      return {
        committed: true,
        revision: nextManifest.revision,
        commitSha: committed.commitSha,
        result,
        manifest: nextManifest
      };
    },

    async listObjects({ bucket: bucketInput, prefix = "", limit = 1000, offset = 0, sortBy = { column: "name", order: "asc" } } = {}) {
      const bucket = requiredString(bucketInput, "Storage bucket", /^[a-z0-9][a-z0-9_-]{0,62}$/);
      const cleanPrefix = String(prefix || "");
      if (cleanPrefix.split("/").some(segment => segment === "." || segment === ".." || (segment && !/^[A-Za-z0-9._-]+$/.test(segment)))) {
        throw new TypeError("Storage list prefix contains an invalid segment.");
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) {
        throw new TypeError("Storage list pagination is invalid.");
      }
      const headSha = await getHead();
      const treeSha = await getCommitTree(headSha);
      const tree = await request("/git/trees/" + encodeURIComponent(treeSha) + "?recursive=1");
      if (tree.truncated) throw new GitHubStoreError("GitHub repository tree is too large for a complete storage listing.", 413);
      const root = "storage/" + systemId.toLowerCase() + "/" + bucket + "/";
      const normalizedPrefix = cleanPrefix.replace(/^\/+|\/+$/g, "");
      const base = root + (normalizedPrefix ? normalizedPrefix + "/" : "");
      const children = new Map();
      for (const entry of tree.tree || []) {
        if (entry.type !== "blob" || !entry.path.startsWith(base)) continue;
        const rest = entry.path.slice(base.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        const name = slash < 0 ? rest : rest.slice(0, slash);
        if (!name) continue;
        if (slash >= 0) {
          if (!children.has(name)) children.set(name, { name, id: null, metadata: null });
        } else {
          const metadataPath = "storage/" + systemId.toLowerCase() + "/metadata/" + bucket + "/" +
            (normalizedPrefix ? normalizedPrefix + "/" : "") + name + ".json";
          const metadata = await readJsonAt(metadataPath, headSha);
          children.set(name, {
            name, id: entry.sha,
            metadata: { size: entry.size ?? metadata?.size ?? null, mimetype: metadata?.mimeType || "application/octet-stream", lastModified: metadata?.updatedAt || null }
          });
        }
      }
      const items = [...children.values()];
      const descending = String(sortBy?.order || "asc").toLowerCase() === "desc";
      items.sort((a, b) => (a.name.localeCompare(b.name)) * (descending ? -1 : 1));
      return items.slice(offset, offset + limit);
    },

    async uploadObject({ bucket: bucketInput, path: pathInput, data, mimeType = "application/octet-stream", upsert = false } = {}) {
      const bucket = requiredString(bucketInput, "Storage bucket", /^[a-z0-9][a-z0-9_-]{0,62}$/);
      const objectName = requiredString(pathInput, "Storage object path");
      const segments = objectName.split("/");
      if (segments.some(segment => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) {
        throw new TypeError("Storage object path contains an invalid segment.");
      }
      if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) throw new TypeError("Storage MIME type is invalid.");
      let bytes;
      if (data instanceof Uint8Array) bytes = data;
      else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else if (typeof Blob !== "undefined" && data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
      else throw new TypeError("Storage data must be a Blob, ArrayBuffer or Uint8Array.");
      if (!bytes.byteLength) throw new GitHubStoreError("Empty storage objects are not supported.");
      if (bytes.byteLength > 10 * 1024 * 1024) throw new GitHubStoreError("Storage object exceeds the 10 MB GitHub prototype limit.");
      const binaryPath = "storage/" + systemId.toLowerCase() + "/" + bucket + "/" + objectName;
      const metadataPath = "storage/" + systemId.toLowerCase() + "/metadata/" + bucket + "/" + objectName + ".json";
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const base64 = globalThis.btoa(binary);

      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const headSha = await getHead();
        const treeSha = await getCommitTree(headSha);
        const existing = await request("/contents/" + contentPath(binaryPath) + "?ref=" + encodeURIComponent(headSha), {}, { allowNotFound: true });
        if (existing && !upsert) throw new GitHubStoreError("Storage object already exists: " + bucket + "/" + objectName, 409);
        const blob = await request("/git/blobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: base64, encoding: "base64" })
        });
        const metadata = {
          schemaVersion: 1, bucket, path: objectName, mimeType,
          size: bytes.byteLength, blobSha: blob.sha, updatedAt: now().toISOString()
        };
        const metadataBlob = await request("/git/blobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: encodeJson(metadata), encoding: "utf-8" })
        });
        const committed = await commitTreeEntriesAtHead({
          headSha, treeSha,
          entries: [
            { path: binaryPath, mode: "100644", type: "blob", sha: blob.sha },
            { path: metadataPath, mode: "100644", type: "blob", sha: metadataBlob.sha }
          ],
          message: "YARDHUB storage upload: " + bucket + "/" + objectName
        });
        if (committed.committed) return { ok: true, path: objectName, bucket, mimeType, size: bytes.byteLength, sha: blob.sha, commitSha: committed.commitSha };
        await sleep(Math.min(100 * (2 ** attempt), 1200));
      }
      throw new GitHubStoreError("Storage upload conflicted repeatedly. Retry the upload.", 409);
    },

    async downloadObject({ bucket: bucketInput, path: pathInput } = {}) {
      const bucket = requiredString(bucketInput, "Storage bucket", /^[a-z0-9][a-z0-9_-]{0,62}$/);
      const objectName = requiredString(pathInput, "Storage object path");
      const segments = objectName.split("/");
      if (segments.some(segment => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) {
        throw new TypeError("Storage object path contains an invalid segment.");
      }
      const binaryPath = "storage/" + systemId.toLowerCase() + "/" + bucket + "/" + objectName;
      const metadataPath = "storage/" + systemId.toLowerCase() + "/metadata/" + bucket + "/" + objectName + ".json";
      const headSha = await getHead();
      const file = await request("/contents/" + contentPath(binaryPath) + "?ref=" + encodeURIComponent(headSha), {}, { allowNotFound: true });
      if (!file) throw new GitHubStoreError("Storage object not found: " + bucket + "/" + objectName, 404);
      const blob = await request("/git/blobs/" + encodeURIComponent(file.sha));
      if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new GitHubStoreError("GitHub returned an unsupported storage blob encoding.");
      const binary = globalThis.atob(blob.content.replace(/\s/g, ""));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const metadata = await readJsonAt(metadataPath, headSha);
      return {
        bucket, path: objectName, bytes,
        mimeType: metadata?.mimeType || "application/octet-stream",
        size: bytes.byteLength, sha: file.sha
      };
    },

    async deleteObject({ bucket: bucketInput, path: pathInput } = {}) {
      const bucket = requiredString(bucketInput, "Storage bucket", /^[a-z0-9][a-z0-9_-]{0,62}$/);
      const objectName = requiredString(pathInput, "Storage object path");
      const segments = objectName.split("/");
      if (segments.some(segment => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) {
        throw new TypeError("Storage object path contains an invalid segment.");
      }
      const binaryPath = "storage/" + systemId.toLowerCase() + "/" + bucket + "/" + objectName;
      const metadataPath = "storage/" + systemId.toLowerCase() + "/metadata/" + bucket + "/" + objectName + ".json";
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const headSha = await getHead();
        const treeSha = await getCommitTree(headSha);
        const existing = await request("/contents/" + contentPath(binaryPath) + "?ref=" + encodeURIComponent(headSha), {}, { allowNotFound: true });
        if (!existing) return { deleted: false, bucket, path: objectName };
        const committed = await commitTreeEntriesAtHead({
          headSha, treeSha,
          entries: [
            { path: binaryPath, mode: "100644", type: "blob", sha: null },
            { path: metadataPath, mode: "100644", type: "blob", sha: null }
          ],
          message: "YARDHUB storage delete: " + bucket + "/" + objectName
        });
        if (committed.committed) return { deleted: true, bucket, path: objectName, commitSha: committed.commitSha };
        await sleep(Math.min(100 * (2 ** attempt), 1200));
      }
      throw new GitHubStoreError("Storage delete conflicted repeatedly. Retry the operation.", 409);
    },

    async deleteObjects({ bucket: bucketInput, paths: pathsInput } = {}) {
      const bucket = requiredString(bucketInput, "Storage bucket", /^[a-z0-9][a-z0-9_-]{0,62}$/);
      if (!Array.isArray(pathsInput) || pathsInput.length > 1000) throw new TypeError("Storage delete requires an array of up to 1000 object paths.");
      const paths = [...new Set(pathsInput.map(path => requiredString(path, "Storage object path")))];
      for (const path of paths) {
        if (path.split("/").some(segment => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) {
          throw new TypeError("Storage object path contains an invalid segment.");
        }
      }
      if (!paths.length) return { deleted: [], missing: [] };
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const headSha = await getHead();
        const treeSha = await getCommitTree(headSha);
        const entries = [], deleted = [], missing = [];
        for (const objectName of paths) {
          const binaryPath = "storage/" + systemId.toLowerCase() + "/" + bucket + "/" + objectName;
          const metadataPath = "storage/" + systemId.toLowerCase() + "/metadata/" + bucket + "/" + objectName + ".json";
          const existing = await request("/contents/" + contentPath(binaryPath) + "?ref=" + encodeURIComponent(headSha), {}, { allowNotFound: true });
          if (!existing) { missing.push(objectName); continue; }
          entries.push(
            { path: binaryPath, mode: "100644", type: "blob", sha: null },
            { path: metadataPath, mode: "100644", type: "blob", sha: null }
          );
          deleted.push(objectName);
        }
        if (!entries.length) return { deleted: [], missing };
        const committed = await commitTreeEntriesAtHead({
          headSha, treeSha, entries,
          message: "YARDHUB storage batch delete: " + bucket + " (" + deleted.length + " objects)"
        });
        if (committed.committed) return { deleted, missing, commitSha: committed.commitSha };
        await sleep(Math.min(100 * (2 ** attempt), 1200));
      }
      throw new GitHubStoreError("Storage batch delete conflicted repeatedly. Retry the operation.", 409);
    },

    async readEvents({ module: moduleInput, date, writerSystemId = systemId } = {}) {
      const moduleName = requiredString(moduleInput, "Module", /^[A-Z][A-Z0-9_-]{1,39}$/);
      const day = asDate(date, now);
      if (!ALLOWED_SYSTEMS.has(writerSystemId)) throw new TypeError("Unsupported writer system identity.");
      const path = "events/" + writerSystemId.toLowerCase() + "/" + moduleName.toLowerCase() + "/" + day + ".json";
      const headSha = await getHead();
      const shard = await readJsonAt(path, headSha);
      return shard ? shard.events : [];
    },

    async readAllEvents({ module: moduleInput, date } = {}) {
      const [primary, secondary] = await Promise.all([
        this.readEvents({ module: moduleInput, date, writerSystemId: "YARDHUB-PRIMARY" }),
        this.readEvents({ module: moduleInput, date, writerSystemId: "DOWNTIMEUI-GITHUB" })
      ]);
      return [...primary, ...secondary].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },

    async beginPrimarySwitch({ targetSystemId, expectedEpoch, actorId, note = "" } = {}) {
      if (!ALLOWED_SYSTEMS.has(targetSystemId)) throw new TypeError("Invalid target primary system.");
      if (targetSystemId === systemId && targetSystemId === (await this.readAuthority()).primarySystemId) {
        throw new GitHubStoreError("The requested system is already primary.");
      }
      requiredString(actorId, "Switch actor");
      return mutateAuthority(expectedEpoch, (current) => {
        if (current.status !== "ACTIVE") throw new GitHubStoreError("Another primary switch is already in progress.", 409);
        if (targetSystemId === current.primarySystemId) throw new GitHubStoreError("The requested system is already primary.");
        return {
          ...current, status: "PREPARING",
          pendingSwitch: {
            fromSystemId: current.primarySystemId, toSystemId: targetSystemId,
            requestedBy: actorId, requestedAt: now().toISOString(), note: String(note).slice(0, 500)
          },
          updatedAt: now().toISOString()
        };
      }, "Prepare YARDHUB primary switch");
    },

    async freezePrimarySwitch({ expectedEpoch } = {}) {
      return mutateAuthority(expectedEpoch, (current) => {
        if (current.status !== "PREPARING" || !current.pendingSwitch) {
          throw new GitHubStoreError("Primary switch must be prepared before it can be frozen.");
        }
        return { ...current, status: "FROZEN", frozenAt: now().toISOString(), updatedAt: now().toISOString() };
      }, "Freeze YARDHUB primary switch");
    },

    async completePrimarySwitch({ expectedEpoch, reconciliation, actorId } = {}) {
      asJsonObject(reconciliation, "Reconciliation proof");
      requiredString(actorId, "Switch actor");
      if (reconciliation.verified !== true || reconciliation.unresolvedConflicts !== 0 ||
          !reconciliation.sourceChecksum || reconciliation.sourceChecksum !== reconciliation.targetChecksum) {
        throw new GitHubStoreError("Cutover rejected: reconciliation must be verified, conflict-free and checksum-matched.");
      }
      return mutateAuthority(expectedEpoch, (current) => {
        if (current.status !== "FROZEN" || !current.pendingSwitch) {
          throw new GitHubStoreError("Primary switch must be frozen before cutover.");
        }
        const previousPrimary = current.primarySystemId;
        const nextPrimary = current.pendingSwitch.toSystemId;
        return {
          ...current,
          primarySystemId: nextPrimary,
          secondarySystemId: previousPrimary,
          epoch: current.epoch + 1,
          status: "ACTIVE",
          pendingSwitch: null,
          lastSwitch: {
            fromSystemId: previousPrimary, toSystemId: nextPrimary,
            completedBy: actorId, completedAt: now().toISOString(),
            reconciliation: {
              sourceChecksum: reconciliation.sourceChecksum,
              targetChecksum: reconciliation.targetChecksum,
              unresolvedConflicts: 0
            }
          },
          updatedAt: now().toISOString()
        };
      }, "Complete YARDHUB primary switch");
    },

    async cancelPrimarySwitch({ expectedEpoch, actorId, reason = "" } = {}) {
      requiredString(actorId, "Switch actor");
      return mutateAuthority(expectedEpoch, (current) => {
        if (!["PREPARING", "FROZEN"].includes(current.status) || !current.pendingSwitch) {
          throw new GitHubStoreError("There is no pending primary switch to cancel.");
        }
        return {
          ...current, status: "ACTIVE", pendingSwitch: null,
          lastSwitchCancelled: { cancelledBy: actorId, cancelledAt: now().toISOString(), reason: String(reason).slice(0, 500) },
          updatedAt: now().toISOString()
        };
      }, "Cancel YARDHUB primary switch");
    }
  });
}
