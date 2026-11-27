import test from "node:test";
import assert from "node:assert/strict";
import {
  createGitHubActionsBroker,
  parseGitHubIssueCommentEvent
} from "../src/infrastructure/github-actions-broker.js";

const REPOSITORY_ID = 123456;
const ACTOR_ID = 987654;
const USER_ID = "canonical-user-01";
const REQUEST_ID = "request_123456789";

function envelope(request, overrides = {}) {
  return {
    version: 1,
    requestId: REQUEST_ID,
    ciphertext: Buffer.from(JSON.stringify(request)).toString("base64url"),
    signature: "s".repeat(64),
    ...overrides
  };
}

function event(request, overrides = {}) {
  const body = "YARDHUB_REQUEST_V1:" + Buffer.from(JSON.stringify(envelope(request))).toString("base64url");
  return {
    action: "created",
    repository: { id: REPOSITORY_ID },
    sender: { id: ACTOR_ID, login: "yard-operator", type: "User" },
    issue: { id: 333, number: 7, pull_request: null },
    comment: { id: 444, user: { id: ACTOR_ID }, body },
    ...overrides
  };
}

function createBrokerHarness({ request = { requestId: REQUEST_ID, action: "gatelog-history", args: { range: "today" } }, principalOverrides = {}, signatureValid = true, authorised = true } = {}) {
  const calls = { resolved: [], verified: [], authorised: [], executed: [], published: [] };
  const records = new Map();
  const idempotencyStore = {
    async claim({ requestId, actorUserId, commentId }) {
      const current = records.get(requestId);
      if (current) return { acquired: false, actorUserId: current.actorUserId, encryptedResponse: current.encryptedResponse || null };
      records.set(requestId, { actorUserId, commentId, encryptedResponse: null });
      return { acquired: true };
    },
    async complete({ requestId, actorUserId, encryptedResponse }) {
      records.set(requestId, { ...records.get(requestId), actorUserId, encryptedResponse });
    },
    async fail({ requestId, code }) {
      records.set(requestId, { ...records.get(requestId), failed: code });
    }
  };
  const broker = createGitHubActionsBroker({
    expectedRepositoryId: REPOSITORY_ID,
    async resolvePrincipal(githubUserId) {
      calls.resolved.push(githubUserId);
      return {
        githubUserId,
        userId: USER_ID,
        staffId: "staff-01",
        enabled: true,
        status: "ACTIVE",
        signingPublicKey: "registered-signing-public-key",
        responseEncryptionKey: "registered-response-public-key",
        ...principalOverrides
      };
    },
    async verifySignature(args) {
      calls.verified.push(args);
      return signatureValid;
    },
    async decryptRequest(args) {
      return JSON.parse(Buffer.from(args.ciphertext, "base64url").toString("utf8"));
    },
    async authorize(args) {
      calls.authorised.push(args);
      return authorised;
    },
    async execute(args) {
      calls.executed.push(args);
      return { count: 3 };
    },
    async encryptResponse(args) {
      return "encrypted-response-for-" + args.publicKey;
    },
    async publishEncryptedResponse(args) {
      calls.published.push(args);
    },
    idempotencyStore,
    async getAuthorityEpoch() { return 4; }
  });
  return { broker, calls, records };
}

test("event parser derives the actor from GitHub event sender and accepts only the configured issue inbox", () => {
  const parsed = parseGitHubIssueCommentEvent(
    event({ requestId: REQUEST_ID, action: "gatelog-history" }),
    { expectedRepositoryId: REPOSITORY_ID }
  );
  assert.equal(parsed.actor.githubUserId, String(ACTOR_ID));
  assert.equal(parsed.actor.login, "yard-operator");
  assert.equal(parsed.repositoryId, REPOSITORY_ID);
  assert.equal(parsed.issueNumber, 7);
  assert.equal(parsed.commentId, 444);
  assert.equal(parsed.envelope.requestId, REQUEST_ID);
});

test("event parser rejects pull requests, other repositories, bot actors and author mismatches", () => {
  const base = event({ requestId: REQUEST_ID, action: "gatelog-history" });
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, issue: { ...base.issue, pull_request: { url: "x" } } }, { expectedRepositoryId: REPOSITORY_ID }), /not a pull request|not a pull/i);
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, repository: { id: REPOSITORY_ID + 1 } }, { expectedRepositoryId: REPOSITORY_ID }), /unapproved broker repository/);
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, sender: { ...base.sender, type: "Bot" } }, { expectedRepositoryId: REPOSITORY_ID }), /human account/);
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, comment: { ...base.comment, user: { id: 1 } } }, { expectedRepositoryId: REPOSITORY_ID }), /author does not match/);
});

test("broker maps GitHub numeric actor to canonical active USER and executes only after signature and permission checks", async () => {
  const harness = createBrokerHarness();
  const result = await harness.broker.handleIssueComment(event({ requestId: REQUEST_ID, action: "gatelog-history", args: { range: "today" } }));
  assert.deepEqual(result, { accepted: true, replayed: false, requestId: REQUEST_ID });
  assert.deepEqual(harness.calls.resolved, [String(ACTOR_ID)]);
  assert.equal(harness.calls.verified[0].publicKey, "registered-signing-public-key");
  assert.equal(harness.calls.authorised[0].principal.userId, USER_ID);
  assert.equal(harness.calls.authorised[0].authorityEpoch, 4);
  assert.equal(harness.calls.executed[0].principal.userId, USER_ID);
  assert.equal(harness.calls.executed[0].authorityEpoch, 4);
  assert.equal(harness.calls.published[0].encryptedResponse, "encrypted-response-for-registered-response-public-key");
});

test("broker denies unknown, disabled or incomplete canonical USER identities before data access", async () => {
  for (const principalOverrides of [
    { enabled: false },
    { status: "SUSPENDED" },
    { userId: null },
    { staffId: null },
    { githubUserId: "another-github-user" }
  ]) {
    const harness = createBrokerHarness({ principalOverrides });
    await assert.rejects(harness.broker.handleIssueComment(event({ requestId: REQUEST_ID, action: "gatelog-history" })), /not mapped to an active canonical USER/);
    assert.equal(harness.calls.verified.length, 0);
    assert.equal(harness.calls.executed.length, 0);
  }
});

test("broker rejects invalid signatures and insufficient YARD ROLE permissions", async () => {
  const invalidSignature = createBrokerHarness({ signatureValid: false });
  await assert.rejects(invalidSignature.broker.handleIssueComment(event({ requestId: REQUEST_ID, action: "gatelog-history" })), /signature is invalid/);
  assert.equal(invalidSignature.calls.executed.length, 0);

  const denied = createBrokerHarness({ authorised: false });
  await assert.rejects(denied.broker.handleIssueComment(event({ requestId: REQUEST_ID, action: "gatelog-history" })), /not authorised/);
  assert.equal(denied.calls.executed.length, 0);
});

test("broker rejects caller-supplied actor, role and privilege fields inside encrypted requests", async () => {
  for (const args of [
    { actorId: "DEV" },
    { user_id: USER_ID },
    { permissions: { canManage: true } },
    { nested: { tier: "OWNER" } }
  ]) {
    const harness = createBrokerHarness({ request: { requestId: REQUEST_ID, action: "gatelog-history", args } });
    await assert.rejects(harness.broker.handleIssueComment(event({ requestId: REQUEST_ID, action: "gatelog-history", args })), error => error.code === "BROKER_CALLER_IDENTITY_FORBIDDEN");
    assert.equal(harness.calls.executed.length, 0);
  }
});

test("broker pins idempotency to canonical USER and replays only the saved encrypted response", async () => {
  const harness = createBrokerHarness();
  const requestEvent = event({ requestId: REQUEST_ID, action: "gatelog-history" });
  await harness.broker.handleIssueComment(requestEvent);
  const replay = await harness.broker.handleIssueComment(requestEvent);
  assert.deepEqual(replay, { accepted: true, replayed: true, requestId: REQUEST_ID });
  assert.equal(harness.calls.executed.length, 1);
  assert.equal(harness.calls.published.length, 2);
  assert.equal(harness.calls.published[1].encryptedResponse, "encrypted-response-for-registered-response-public-key");
});

test("broker refuses execution if the current authority epoch is unavailable", async () => {
  const harness = createBrokerHarness();
  const broker = createGitHubActionsBroker({
    expectedRepositoryId: REPOSITORY_ID,
    resolvePrincipal: async id => ({ githubUserId: id, userId: USER_ID, staffId: "staff-01", enabled: true, status: "ACTIVE", signingPublicKey: "key", responseEncryptionKey: "key" }),
    verifySignature: async () => true,
    decryptRequest: async () => ({ requestId: REQUEST_ID, action: "gatelog-history" }),
    authorize: async () => true,
    execute: async () => { throw new Error("Must not execute without authority epoch."); },
    encryptResponse: async () => "encrypted",
    publishEncryptedResponse: async () => {},
    idempotencyStore: { claim: async () => ({ acquired: true }), complete: async () => {} },
    getAuthorityEpoch: async () => null
  });
  await assert.rejects(broker.handleIssueComment(event({ requestId: REQUEST_ID, action: "gatelog-history" })), /authority epoch is unavailable/);
  assert.equal(harness.calls.executed.length, 0);
});
