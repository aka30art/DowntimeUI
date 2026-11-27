const IDENTITY_TABLE = "downtime_github_identities";
const AUDIT_TABLE = "downtime_github_broker_identity_audit";

function requiredText(value, name, max = 200) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new TypeError(name + " is required and must be at most " + max + " characters.");
  return text;
}

function requiredNumericId(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(name + " must be a positive integer.");
  return number;
}

async function commitWithRetry(store, { operationId, mutate, maxAttempts = 6 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await store.readDatabase();
    try {
      return await store.transactDatabase({
        expectedRevision: snapshot.revision,
        actorId: "YARDHUB-GITHUB-BROKER-IDENTITY-MANAGER",
        operationId: operationId + "-" + attempt,
        mutate
      });
    } catch (error) {
      if (error?.status !== 409 || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error("GitHub identity mapping transaction could not be committed.");
}

/**
 * DEV-only linking and revocation for GitHub actor -> canonical USER mappings.
 * verifyDevAuthority must resolve the caller from a trusted Central Bank session
 * and immutable ROOTS authority; no caller-supplied role flag is trusted here.
 */
export function createGitHubBrokerIdentityManager({
  store,
  verifyDevAuthority,
  cryptoProvider = globalThis.crypto,
  now = () => new Date()
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A private GitHub data store is required.");
  }
  if (typeof verifyDevAuthority !== "function") throw new TypeError("A trusted immutable DEV authority resolver is required.");
  if (typeof cryptoProvider?.randomUUID !== "function") throw new TypeError("A cryptographic UUID provider is required.");

  async function requireDev(actorContext) {
    const actor = await verifyDevAuthority(actorContext);
    if (!actor?.userId || actor.isImmutableDev !== true) {
      const error = new Error("Only the immutable DEV identity may link or revoke GitHub broker identities.");
      error.status = 403;
      throw error;
    }
    return actor;
  }

  return Object.freeze({
    async link({ actorContext, githubUserId, userId, staffId, brokerIssueId, reason }) {
      const actor = await requireDev(actorContext);
      const githubId = requiredText(githubUserId, "GitHub numeric user ID", 24);
      if (!/^\d+$/.test(githubId)) throw new TypeError("GitHub user ID must be numeric.");
      const targetUserId = requiredText(userId, "Canonical USER ID", 128);
      const targetStaffId = requiredText(staffId, "Canonical STAFF ID", 128);
      const issueId = requiredNumericId(brokerIssueId, "Broker issue ID");
      const auditReason = requiredText(reason, "Link reason");
      const snapshot = await store.readDatabase();
      const bank = (snapshot.tables.downtime_central_bank || []).find(row => Number(row.id) === 1);
      const user = (bank?.payload?.users || []).find(row =>
        String(row.userId) === targetUserId && String(row.staffId) === targetStaffId && row.enabled !== false
      );
      if (!user) throw new Error("The target USER/STAFF identity is not active in Central Bank.");

      const eventId = cryptoProvider.randomUUID();
      const timestamp = now().toISOString();
      let linked;
      await commitWithRetry(store, {
        operationId: "broker-identity-link-" + eventId,
        mutate: tables => {
          const identities = Array.isArray(tables[IDENTITY_TABLE]) ? tables[IDENTITY_TABLE] : [];
          const conflict = identities.find(row =>
            row.status === "ACTIVE" && (
              String(row.github_user_id) === githubId ||
              String(row.user_id) === targetUserId ||
              Number(row.broker_issue_id) === issueId
            )
          );
          if (conflict) throw new Error("The GitHub account, canonical USER or broker issue is already linked.");
          const prior = identities.find(row => String(row.github_user_id) === githubId && row.status === "REVOKED");
          linked = {
            github_user_id: githubId,
            user_id: targetUserId,
            staff_id: targetStaffId,
            broker_issue_id: issueId,
            status: "ACTIVE",
            linked_at: timestamp,
            linked_by_user_id: actor.userId,
            revoked_at: null,
            revoked_by_user_id: null
          };
          if (prior) Object.assign(prior, linked);
          else identities.push(linked);
          tables[IDENTITY_TABLE] = identities;
          const audit = Array.isArray(tables[AUDIT_TABLE]) ? tables[AUDIT_TABLE] : [];
          audit.push({
            event_id: eventId,
            event_type: "LINKED",
            github_user_id: githubId,
            user_id: targetUserId,
            staff_id: targetStaffId,
            broker_issue_id: issueId,
            actor_user_id: actor.userId,
            reason: auditReason,
            created_at: timestamp
          });
          tables[AUDIT_TABLE] = audit;
        }
      });
      return Object.freeze({ ...linked });
    },

    async revoke({ actorContext, githubUserId, reason }) {
      const actor = await requireDev(actorContext);
      const githubId = requiredText(githubUserId, "GitHub numeric user ID", 24);
      if (!/^\d+$/.test(githubId)) throw new TypeError("GitHub user ID must be numeric.");
      const auditReason = requiredText(reason, "Revocation reason");
      const eventId = cryptoProvider.randomUUID();
      const timestamp = now().toISOString();
      let revoked = null;
      await commitWithRetry(store, {
        operationId: "broker-identity-revoke-" + eventId,
        mutate: tables => {
          const identities = Array.isArray(tables[IDENTITY_TABLE]) ? tables[IDENTITY_TABLE] : [];
          const identity = identities.find(row => String(row.github_user_id) === githubId && row.status === "ACTIVE");
          if (!identity) throw new Error("No active GitHub identity mapping exists for this account.");
          identity.status = "REVOKED";
          identity.revoked_at = timestamp;
          identity.revoked_by_user_id = actor.userId;
          identity.revocation_reason = auditReason;
          revoked = { ...identity };
          tables[IDENTITY_TABLE] = identities;
          const audit = Array.isArray(tables[AUDIT_TABLE]) ? tables[AUDIT_TABLE] : [];
          audit.push({
            event_id: eventId,
            event_type: "REVOKED",
            github_user_id: githubId,
            user_id: identity.user_id,
            staff_id: identity.staff_id,
            broker_issue_id: identity.broker_issue_id,
            actor_user_id: actor.userId,
            reason: auditReason,
            created_at: timestamp
          });
          tables[AUDIT_TABLE] = audit;
        }
      });
      return Object.freeze(revoked);
    }
  });
}
