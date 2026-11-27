const BROKER_REQUEST_TABLE = "downtime_github_broker_requests";
const BROKER_IDENTITY_TABLE = "downtime_github_identities";
const SERVICE_NAMES = new Set([
  "central-bank", "central-config-admin", "gatelog-api", "photo-evidence",
  "repair-maintenance-api", "spectator-read", "yard-hub-settings-api"
]);

async function transactTable(store, tableName, actorId, operationId, mutate, maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = await store.readDatabase();
    try {
      return await store.transactDatabase({
        expectedRevision: snapshot.revision,
        actorId,
        operationId: operationId + "-" + attempt,
        mutate: async tables => {
          const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
          const result = await mutate(rows, tables);
          tables[tableName] = rows;
          return result;
        }
      });
    } catch (error) {
      if (error?.status !== 409 || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error("GitHub broker table transaction could not be committed.");
}

export async function resolveGitHubBrokerPrincipal({ store, githubUserId } = {}) {
  if (!store || typeof store.readTable !== "function") throw new TypeError("A private GitHub data store is required.");
  const actorId = String(githubUserId || "");
  if (!/^\d{1,24}$/.test(actorId)) return null;
  const [identities, bankRows] = await Promise.all([
    store.readTable(BROKER_IDENTITY_TABLE),
    store.readTable("downtime_central_bank")
  ]);
  const identity = identities.find(row =>
    String(row.github_user_id) === actorId && row.status === "ACTIVE"
  );
  if (!identity?.user_id || !identity.staff_id || !Number.isSafeInteger(Number(identity.broker_issue_id))) return null;
  const bank = bankRows.find(row => Number(row.id) === 1);
  const users = Array.isArray(bank?.payload?.users) ? bank.payload.users : [];
  const user = users.find(row =>
    String(row.userId) === String(identity.user_id) &&
    String(row.staffId) === String(identity.staff_id) &&
    row.enabled !== false
  );
  if (!user?.username) return null;
  return Object.freeze({
    githubUserId: actorId,
    userId: String(user.userId),
    staffId: String(user.staffId),
    username: String(user.username),
    tier: user.tier || null,
    enabled: true,
    status: "ACTIVE",
    brokerIssueId: Number(identity.broker_issue_id)
  });
}

export async function authorizeGitHubBrokerInboxIssue({ principal, issueId } = {}) {
  return Boolean(principal?.userId && Number(principal.brokerIssueId) === Number(issueId));
}

export async function getGitHubBrokerAuthorityEpoch({ store } = {}) {
  if (!store || typeof store.readAuthority !== "function") return null;
  const authority = await store.readAuthority();
  if (!authority || authority.status !== "ACTIVE" || authority.primarySystemId !== "DOWNTIMEUI-GITHUB" ||
      !Number.isSafeInteger(authority.epoch) || authority.epoch < 1) return null;
  return authority.epoch;
}

/**
 * Durable request claims live in the private GitHub data repository. The
 * service action itself marks the claim COMMITTED inside its atomic data
 * transaction; complete() then attaches the encrypted response for replay.
 */
export function createGitHubBrokerIdempotencyStore({
  store,
  now = () => new Date(),
  leaseMs = 15 * 60 * 1000
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.transactDatabase !== "function") {
    throw new TypeError("A private GitHub data store is required for broker idempotency.");
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 60_000 || leaseMs > 60 * 60 * 1000) {
    throw new TypeError("Broker request lease must be between one and sixty minutes.");
  }

  return Object.freeze({
    async claim({ requestId, actorUserId, commentId, service, action, authorityEpoch }) {
      let outcome = null;
      await transactTable(store, BROKER_REQUEST_TABLE, "YARDHUB-GITHUB-ACTIONS-BROKER", "broker-claim-" + requestId, rows => {
        const current = rows.find(row => row.request_id === requestId);
        if (current) {
          if (current.actor_user_id !== actorUserId) {
            outcome = { acquired: false, actorUserId: current.actor_user_id, state: current.state };
            return;
          }
          if (current.state === "COMPLETED" || current.state === "COMMITTED") {
            outcome = { acquired: false, actorUserId, state: current.state, encryptedResponse: current.encrypted_response || null };
            return;
          }
          const leaseUntil = Date.parse(current.lease_until || "");
          if (current.state === "PROCESSING" && Number.isFinite(leaseUntil) && leaseUntil > now().getTime()) {
            outcome = { acquired: false, actorUserId, state: "PROCESSING", encryptedResponse: null };
            return;
          }
          current.state = "PROCESSING";
          current.comment_id = commentId;
          current.service = service;
          current.action = action;
          current.authority_epoch = authorityEpoch;
          current.lease_until = new Date(now().getTime() + leaseMs).toISOString();
          current.updated_at = now().toISOString();
          current.failure_code = null;
          outcome = { acquired: true };
          return;
        }
        const timestamp = now().toISOString();
        rows.push({
          request_id: requestId,
          actor_user_id: actorUserId,
          comment_id: commentId,
          service,
          action,
          authority_epoch: authorityEpoch,
          state: "PROCESSING",
          lease_until: new Date(now().getTime() + leaseMs).toISOString(),
          encrypted_response: null,
          failure_code: null,
          created_at: timestamp,
          updated_at: timestamp
        });
        outcome = { acquired: true };
      });
      return outcome;
    },

    async complete({ requestId, actorUserId, encryptedResponse }) {
      await transactTable(store, BROKER_REQUEST_TABLE, "YARDHUB-GITHUB-ACTIONS-BROKER", "broker-complete-" + requestId, rows => {
        const row = rows.find(item => item.request_id === requestId && item.actor_user_id === actorUserId);
        if (!row) throw new Error("Broker idempotency claim is missing.");
        if (row.state === "COMMITTED" || row.state === "PROCESSING") {
          row.state = "COMPLETED";
          row.encrypted_response = encryptedResponse;
          row.lease_until = null;
          row.updated_at = now().toISOString();
        }
      });
    },

    async fail({ requestId, actorUserId, code }) {
      await transactTable(store, BROKER_REQUEST_TABLE, "YARDHUB-GITHUB-ACTIONS-BROKER", "broker-fail-" + requestId, rows => {
        const row = rows.find(item => item.request_id === requestId && item.actor_user_id === actorUserId);
        if (!row || row.state === "COMMITTED" || row.state === "COMPLETED") return;
        row.state = "FAILED";
        row.failure_code = String(code || "BROKER_EXECUTION_FAILED").slice(0, 80);
        row.lease_until = null;
        row.updated_at = now().toISOString();
      });
    }
  });
}

export const GITHUB_BROKER_TABLES = Object.freeze({
  identities: BROKER_IDENTITY_TABLE,
  requests: BROKER_REQUEST_TABLE,
  services: SERVICE_NAMES
});
