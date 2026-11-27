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

  const commitJsonAtHead = async ({ headSha, treeSha, path, value, message }) => {
    const content = encodeJson(value);
    if (byteLength(content) > maxShardBytes) {
      throw new GitHubStoreError("The daily event shard exceeds the configured size limit. Archive the day before adding more events.");
    }
    const blob = await request("/git/blobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, encoding: "utf-8" })
    });
    const tree = await request("/git/trees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: treeSha,
        tree: [{ path, mode: "100644", type: "blob", sha: blob.sha }]
      })
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
