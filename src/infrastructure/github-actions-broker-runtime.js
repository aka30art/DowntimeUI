import { createGitHubActionsBroker } from "./github-actions-broker.js";
import { createGitHubBrokerIdempotencyStore, getGitHubBrokerAuthorityEpoch } from "./github-actions-broker-store.js";
import { createGitHubBrokerAuthority } from "./github-broker-authority.js";
import {
  decryptBrokerRequest,
  encryptBrokerResponse,
  formatBrokerResponseComment
} from "./github-app-broker-client.js";
import { executeGitHubEdgeAction } from "../../yardhub/runtime/github-edge-runtime.js";

const SERVICES = new Set([
  "central-bank", "central-config-admin", "gatelog-api", "photo-evidence",
  "repair-maintenance-api", "spectator-read", "yard-hub-settings-api"
]);

/**
 * Composes the GitHub App encrypted inbox, private GitHub data store, source
 * YARDHUB Edge handlers and broker idempotency ledger into one Actions runtime.
 *
 * The preserved Edge handlers remain the final YARD ROLE enforcement point:
 * they receive a broker-minted Central Bank session and execute their original
 * server-side identity/department checks against the private store.
 */
export function createGitHubYardHubBroker({
  store,
  handlers,
  expectedRepositoryId,
  bootstrapGitHubUserId = null,
  bootstrapIssueId = null,
  brokerPrivateKey,
  githubToken,
  brokerOwner,
  brokerRepository,
  cryptoProvider = globalThis.crypto,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  origin = "https://aka30art.github.io"
} = {}) {
  if (!store || typeof store.readDatabase !== "function" || typeof store.readAuthority !== "function") {
    throw new TypeError("A private GitHub YARDHUB data store is required.");
  }
  if (!handlers || !SERVICES.size || [...SERVICES].some(name => typeof handlers[name] !== "function")) {
    throw new TypeError("All seven preserved YARDHUB service handlers must be registered.");
  }
  if (!brokerPrivateKey || !cryptoProvider?.subtle || typeof fetchImpl !== "function") {
    throw new TypeError("Broker private key, WebCrypto and fetch are required.");
  }
  if (!githubToken || !brokerOwner || !brokerRepository) {
    throw new TypeError("A broker-repository issue-comment token and repository identity are required.");
  }

  const authority = createGitHubBrokerAuthority({
    store,
    brokerRepositoryId: expectedRepositoryId,
    bootstrapGitHubUserId,
    bootstrapIssueId,
    now
  });
  const idempotencyStore = createGitHubBrokerIdempotencyStore({ store, now });
  const broker = createGitHubActionsBroker({
    expectedRepositoryId,
    store,
    cryptoProvider,
    now,
    resolvePrincipal: authority.resolvePrincipal,
    authorizeInboxIssue: authority.authorizeInboxIssue,
    decryptRequest: ({ envelope }) => decryptBrokerRequest({
      envelope, brokerPrivateKey, cryptoProvider, now
    }),
    authorize: authority.authorize,
    createServiceSession: authority.createServiceSession,
    execute: ({ principal, service, action, args, sessionToken, requestId }) =>
      executeGitHubEdgeAction({
        store,
        handlers,
        service,
        action,
        args,
        sessionToken,
        requestId,
        actorUserId: principal.userId,
        expectedAuthorityEpoch: authorityEpoch,
        origin
      }),
    encryptResponse: ({ requestEnvelope, payload }) => encryptBrokerResponse({
      requestEnvelope, payload, brokerPrivateKey, cryptoProvider, now
    }),
    publishEncryptedResponse: async ({ issueNumber, encryptedResponse }) => {
      const url = "https://api.github.com/repos/" +
        encodeURIComponent(brokerOwner) + "/" + encodeURIComponent(brokerRepository) +
        "/issues/" + encodeURIComponent(String(issueNumber)) + "/comments";
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + githubToken,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ body: formatBrokerResponseComment(encryptedResponse) })
      });
      if (!response.ok) {
        throw new Error("Encrypted broker response could not be published to the private response channel.");
      }
    },
    idempotencyStore,
    getAuthorityEpoch: async () => {
      const activePrimaryEpoch = await getGitHubBrokerAuthorityEpoch({ store });
      if (activePrimaryEpoch === null) return null;
      return authority.getAuthorityEpoch();
    }
  });
  return broker;
}
