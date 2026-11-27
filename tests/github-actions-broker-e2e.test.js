import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  createEncryptedBrokerRequest,
  decryptBrokerRequest,
  encryptBrokerResponse,
  decryptBrokerResponse,
  parseBrokerResponseComment,
  formatBrokerResponseComment
} from "../src/infrastructure/github-app-broker-client.js";
import { createGitHubActionsBroker } from "../src/infrastructure/github-actions-broker.js";

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

test("encrypted browser request traverses the Actions broker core and returns only a decryptable response", async () => {
  const repositoryId = 12345678;
  const actorId = 990011;
  const userId = "yardhub-user-001";
  const staffId = "yardhub-staff-001";
  const issueId = 45678;
  const issueNumber = 91;
  const commentId = 98765;
  const brokerKeyPair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]
  );
  const brokerPublicKey = base64Url(await webcrypto.subtle.exportKey("raw", brokerKeyPair.publicKey));
  const requestContext = await createEncryptedBrokerRequest({
    payload: {
      action: "gatelog-customer-arrival",
      args: {
        customer: "Private customer",
        registration: "AB12 CDE",
        wasteTypes: ["General"]
      }
    },
    brokerPublicKey,
    cryptoProvider: webcrypto
  });
  const event = {
    action: "created",
    repository: { id: repositoryId },
    sender: { id: actorId, login: "yard-operator", type: "User" },
    issue: { id: issueId, number: issueNumber },
    comment: {
      id: commentId,
      user: { id: actorId },
      body: requestContext.commentBody
    }
  };

  const ledger = new Map();
  const published = [];
  const calls = { principal: [], issue: [], authorize: [], execute: [] };
  const broker = createGitHubActionsBroker({
    expectedRepositoryId: repositoryId,
    async resolvePrincipal(githubUserId) {
      calls.principal.push(githubUserId);
      assert.equal(githubUserId, String(actorId));
      return {
        githubUserId,
        userId,
        staffId,
        enabled: true,
        status: "ACTIVE"
      };
    },
    async authorizeInboxIssue({ principal, issueId: requestedIssueId }) {
      calls.issue.push({ principal, issueId: requestedIssueId });
      return principal.userId === userId && requestedIssueId === issueId;
    },
    async decryptRequest({ envelope, actorUserId }) {
      assert.equal(actorUserId, userId);
      return decryptBrokerRequest({
        envelope,
        brokerPrivateKey: brokerKeyPair.privateKey,
        cryptoProvider: webcrypto
      });
    },
    async authorize({ principal, action, args, authorityEpoch }) {
      calls.authorize.push({ principal, action, args, authorityEpoch });
      return principal.userId === userId &&
        action === "gatelog-customer-arrival" &&
        args.registration === "AB12 CDE" &&
        authorityEpoch === 3;
    },
    async execute({ principal, action, args, requestId, authorityEpoch }) {
      calls.execute.push({ principal, action, args, requestId, authorityEpoch });
      return {
        visitId: "private-visit-1001",
        customerName: args.customer,
        registration: args.registration
      };
    },
    async encryptResponse({ requestEnvelope, payload }) {
      return encryptBrokerResponse({
        requestEnvelope,
        payload,
        brokerPrivateKey: brokerKeyPair.privateKey,
        cryptoProvider: webcrypto
      });
    },
    async publishEncryptedResponse({ issueNumber: targetIssue, actorUserId, encryptedResponse }) {
      assert.equal(targetIssue, issueNumber);
      assert.equal(actorUserId, userId);
      published.push(formatBrokerResponseComment(encryptedResponse));
    },
    idempotencyStore: {
      async claim({ requestId, actorUserId, commentId: sourceCommentId }) {
        const existing = ledger.get(requestId);
        if (existing) {
          return {
            acquired: false,
            actorUserId: existing.actorUserId,
            encryptedResponse: existing.encryptedResponse
          };
        }
        ledger.set(requestId, { actorUserId, commentId: sourceCommentId, encryptedResponse: null });
        return { acquired: true };
      },
      async complete({ requestId, actorUserId, encryptedResponse }) {
        ledger.set(requestId, { ...ledger.get(requestId), actorUserId, encryptedResponse });
      },
      async fail({ requestId, code }) {
        ledger.set(requestId, { ...ledger.get(requestId), failed: code });
      }
    },
    async getAuthorityEpoch() { return 3; }
  });

  const result = await broker.handleIssueComment(event);
  assert.deepEqual(result, {
    accepted: true,
    replayed: false,
    requestId: requestContext.requestId
  });
  assert.equal(calls.principal.length, 1);
  assert.equal(calls.issue.length, 1);
  assert.equal(calls.authorize.length, 1);
  assert.equal(calls.execute.length, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].includes("Private customer"), false);
  assert.equal(published[0].includes("private-visit-1001"), false);

  const reply = await decryptBrokerResponse(
    requestContext,
    parseBrokerResponseComment(published[0]),
    webcrypto
  );
  assert.deepEqual(reply, {
    ok: true,
    requestId: requestContext.requestId,
    result: {
      visitId: "private-visit-1001",
      customerName: "Private customer",
      registration: "AB12 CDE"
    }
  });

  const replay = await broker.handleIssueComment(event);
  assert.deepEqual(replay, {
    accepted: true,
    replayed: true,
    requestId: requestContext.requestId
  });
  assert.equal(calls.execute.length, 1, "replay must not repeat the business operation");
  assert.equal(published.length, 2, "replay republishes the same encrypted response only");
  assert.equal(published[0], published[1]);
});

test("broker denies a comment when its event actor differs from the comment author", async () => {
  const broker = createGitHubActionsBroker({
    expectedRepositoryId: 12345678,
    resolvePrincipal: async () => { throw new Error("Must not resolve a mismatched actor."); },
    authorizeInboxIssue: async () => true,
    decryptRequest: async () => { throw new Error("Must not decrypt a mismatched actor."); },
    authorize: async () => true,
    execute: async () => { throw new Error("Must not execute a mismatched actor."); },
    encryptResponse: async () => null,
    publishEncryptedResponse: async () => {},
    idempotencyStore: { claim: async () => ({ acquired: true }), complete: async () => {} },
    getAuthorityEpoch: async () => 1
  });
  const event = {
    action: "created",
    repository: { id: 12345678 },
    sender: { id: 990011, login: "actual-actor", type: "User" },
    issue: { id: 45678, number: 91 },
    comment: { id: 98765, user: { id: 112233 }, body: "YARDHUB_REQUEST_V1:invalid" }
  };
  await assert.rejects(broker.handleIssueComment(event), error => error.code === "BROKER_ACTOR_MISMATCH");
});

console.log("PASS: GitHub App encrypted browser request, trusted Actions broker, per-user inbox and idempotent encrypted response integration");
