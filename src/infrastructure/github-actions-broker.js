import { parseBrokerRequestComment } from "./github-app-broker-client.js";
import { createGitHubCentralServiceSession } from "./github-central-service-session.js";

const ENVELOPE_PREFIX = "YARDHUB_REQUEST_V1:";
const MAX_COMMENT_LENGTH = 16 * 1024;
const ACTION_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SERVICE_NAMES = new Set(["central-bank", "central-config-admin", "gatelog-api", "photo-evidence", "repair-maintenance-api", "spectator-read", "yard-hub-settings-api"]);
const FORBIDDEN_IDENTITY_FIELDS = new Set([
  "actor", "actorId", "actor_id", "actorUserId", "actor_user_id",
  "actorUsername", "actor_username", "actorDisplayName", "actor_display_name",
  "actorRole", "actorTier", "callerRole", "callerTier",
  "permissions", "isAdmin", "isDev",
  "sessionToken", "session_token", "accessToken", "access_token",
  "authToken", "auth_token", "authorization"
]);

function brokerError(message, status = 400, code = "BROKER_REQUEST_INVALID") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function assertNoCallerIdentity(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoCallerIdentity);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_IDENTITY_FIELDS.has(key)) {
      throw brokerError("Caller-supplied actor identity or privilege fields are not accepted.", 403, "BROKER_CALLER_IDENTITY_FORBIDDEN");
    }
    assertNoCallerIdentity(nested);
  }
}

export function parseGitHubIssueCommentEvent(event, { expectedRepositoryId, maxCommentLength = MAX_COMMENT_LENGTH } = {}) {
  if (!event || event.action !== "created") throw brokerError("Only newly created issue comments are accepted.");
  const repositoryId = Number(event.repository?.id);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0 || repositoryId !== Number(expectedRepositoryId)) {
    throw brokerError("The request came from an unapproved broker repository.", 403, "BROKER_REPOSITORY_DENIED");
  }
  const senderId = Number(event.sender?.id);
  if (!Number.isSafeInteger(senderId) || senderId <= 0 || event.sender?.type !== "User") {
    throw brokerError("The GitHub event does not identify an eligible human account.", 401, "BROKER_ACTOR_INVALID");
  }
  const issueId = Number(event.issue?.id);
  const issueNumber = Number(event.issue?.number);
  const commentId = Number(event.comment?.id);
  if (!Number.isSafeInteger(issueId) || issueId <= 0 || !Number.isSafeInteger(issueNumber) || issueNumber <= 0 || event.issue?.pull_request) {
    throw brokerError("Requests must be posted to a registered broker issue, not a pull request.", 400, "BROKER_ISSUE_INVALID");
  }
  if (!Number.isSafeInteger(commentId) || commentId <= 0 || Number(event.comment?.user?.id) !== senderId) {
    throw brokerError("The comment author does not match the authenticated event sender.", 401, "BROKER_ACTOR_MISMATCH");
  }
  const body = String(event.comment.body || "");
  if (body.length > maxCommentLength || !body.startsWith(ENVELOPE_PREFIX)) {
    throw brokerError("The encrypted request envelope is missing or exceeds the size limit.");
  }
  let envelope;
  try {
    envelope = parseBrokerRequestComment(body);
  } catch {
    throw brokerError("The encrypted request envelope is malformed.");
  }
  if (!envelope || envelope.protocol !== "YARDHUB_GITHUB_BROKER" || envelope.version !== 1 ||
      typeof envelope.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(envelope.requestId) ||
      typeof envelope.clientPublicKey !== "string" || typeof envelope.nonce !== "string" ||
      typeof envelope.ciphertext !== "string") {
    throw brokerError("The encrypted request envelope failed schema validation.");
  }
  return Object.freeze({
    repositoryId,
    issueId,
    issueNumber,
    commentId,
    actor: Object.freeze({
      githubUserId: String(senderId),
      login: String(event.sender.login || "").slice(0, 39)
    }),
    envelope: Object.freeze(envelope)
  });
}

export function createGitHubActionsBroker({
  expectedRepositoryId,
  resolvePrincipal,
  authorizeInboxIssue,
  decryptRequest,
  authorize,
  createServiceSession = null,
  store = null,
  cryptoProvider = globalThis.crypto,
  now = () => new Date(),
  execute,
  encryptResponse,
  publishEncryptedResponse,
  idempotencyStore,
  getAuthorityEpoch
} = {}) {
  const sessionFactory = createServiceSession || (store
    ? args => createGitHubCentralServiceSession({ store, cryptoProvider, now, ...args })
    : null);
  const required = { resolvePrincipal, authorizeInboxIssue, decryptRequest, authorize, sessionFactory, execute, encryptResponse, publishEncryptedResponse, getAuthorityEpoch };
  for (const [name, callback] of Object.entries(required)) {
    if (typeof callback !== "function") throw new TypeError("GitHub Actions broker requires " + name + ".");
  }
  if (!idempotencyStore || typeof idempotencyStore.claim !== "function" ||
      typeof idempotencyStore.complete !== "function") {
    throw new TypeError("GitHub Actions broker requires an atomic idempotency store.");
  }

  return Object.freeze({
    async handleIssueComment(event) {
      const parsed = parseGitHubIssueCommentEvent(event, { expectedRepositoryId });
      // GitHub's authenticated event sender ID is the transport identity.
      // No identity value inside the encrypted request can override it.
      const principal = await resolvePrincipal(parsed.actor.githubUserId);
      if (!principal || String(principal.githubUserId) !== parsed.actor.githubUserId ||
          !principal.userId || !principal.staffId ||
          principal.enabled !== true || principal.status !== "ACTIVE") {
        throw brokerError("The GitHub actor is not mapped to an active canonical USER/STAFF identity.", 403, "BROKER_USER_DENIED");
      }
      const issueAllowed = await authorizeInboxIssue({
        principal,
        issueId: parsed.issueId,
        issueNumber: parsed.issueNumber
      });
      if (issueAllowed !== true) {
        throw brokerError("The broker issue is not assigned to this canonical USER.", 403, "BROKER_ISSUE_OWNERSHIP_DENIED");
      }

      let claimedRequestId = null;
      let completed = false;
      let serviceSession = null;
      try {
        const request = await decryptRequest({
          envelope: parsed.envelope,
          actorUserId: principal.userId
        });
        if (!request || typeof request !== "object" || Array.isArray(request) ||
            request.requestId !== parsed.envelope.requestId ||
            typeof request.service !== "string" || !SERVICE_NAMES.has(request.service) ||
            typeof request.action !== "string" || !ACTION_PATTERN.test(request.action) ||
            !request.args || typeof request.args !== "object" || Array.isArray(request.args)) {
          throw brokerError("The decrypted request failed service/action schema validation.");
        }
        assertNoCallerIdentity(request);

        const authorityEpoch = await getAuthorityEpoch();
        if (!Number.isSafeInteger(authorityEpoch) || authorityEpoch < 1) {
          throw brokerError("The authority epoch is unavailable; request denied.", 503, "BROKER_AUTHORITY_UNAVAILABLE");
        }
        const decision = await authorize({
          principal,
          service: request.service,
          action: request.action,
          args: request.args,
          authorityEpoch
        });
        if (decision !== true) throw brokerError("The USER is not authorised for this service action.", 403, "BROKER_PERMISSION_DENIED");

        // Decrypt and authorize before reserving an idempotency key; caller data never supplies a session.
        const claim = await idempotencyStore.claim({
          requestId: parsed.envelope.requestId,
          actorUserId: principal.userId,
          commentId: parsed.commentId,
          service: request.service,
          action: request.action,
          args: request.args,
          authorityEpoch
        });
        if (!claim?.acquired) {
          if (claim?.actorUserId && claim.actorUserId !== principal.userId) {
            throw brokerError("The request identifier is already bound to another USER.", 409, "BROKER_REPLAY_CONFLICT");
          }
          let encryptedResponse = claim?.encryptedResponse || null;
          if (!encryptedResponse && claim?.state === "COMMITTED") {
            encryptedResponse = await encryptResponse({
              requestEnvelope: parsed.envelope,
              payload: {
                ok: true,
                requestId: parsed.envelope.requestId,
                result: { committed: true, refreshRequired: true }
              }
            });
            await idempotencyStore.complete({
              requestId: parsed.envelope.requestId,
              actorUserId: principal.userId,
              encryptedResponse
            });
          }
          if (encryptedResponse) {
            await publishEncryptedResponse({
              issueNumber: parsed.issueNumber,
              actorUserId: principal.userId,
              encryptedResponse
            });
          }
          return {
            accepted: true,
            replayed: true,
            pending: claim?.state === "PROCESSING",
            requestId: parsed.envelope.requestId
          };
        }
        claimedRequestId = parsed.envelope.requestId;

        // The broker creates a fresh short-lived service session from the verified USER.
        // It is never supplied by the browser and is never included in the public inbox.
        serviceSession = await sessionFactory({
          principal,
          service: request.service,
          requestId: parsed.envelope.requestId,
          authorityEpoch
        });
        const sessionToken = serviceSession && typeof serviceSession === "object" ? serviceSession.token : null;
        if (typeof sessionToken !== "string" || sessionToken.length < 24 || sessionToken.length > 4096 ||
            typeof serviceSession.dispose !== "function") {
          throw brokerError("The trusted service session must provide an opaque token and revocation function.", 503, "BROKER_SESSION_UNAVAILABLE");
        }

        const result = await execute({
          principal,
          service: request.service,
          action: request.action,
          args: request.args,
          sessionToken,
          requestId: parsed.envelope.requestId,
          authorityEpoch
        });
        const encryptedResponse = await encryptResponse({
          requestEnvelope: parsed.envelope,
          payload: { ok: true, requestId: parsed.envelope.requestId, result }
        });
        // Revoke/remove the service session before persisting and publishing the response.
        if (typeof serviceSession?.dispose === "function") {
          await serviceSession.dispose();
          serviceSession = null;
        }
        await idempotencyStore.complete({
          requestId: parsed.envelope.requestId,
          actorUserId: principal.userId,
          encryptedResponse
        });
        completed = true;
        await publishEncryptedResponse({
          issueNumber: parsed.issueNumber,
          actorUserId: principal.userId,
          encryptedResponse
        });
        return { accepted: true, replayed: false, requestId: parsed.envelope.requestId };
      } catch (error) {
        if (typeof serviceSession?.dispose === "function") {
          try { await serviceSession.dispose(); } catch { /* Keep the original broker failure. */ }
        }
        if (claimedRequestId && !completed) {
          await idempotencyStore.fail?.({
            requestId: claimedRequestId,
            actorUserId: principal.userId,
            code: error?.code || "BROKER_EXECUTION_FAILED"
          });
        }
        throw error;
      }
    }
  });
}

export const GITHUB_ACTIONS_BROKER_PROTOCOL = Object.freeze({
  envelopePrefix: ENVELOPE_PREFIX,
  maxCommentLength: MAX_COMMENT_LENGTH
});
