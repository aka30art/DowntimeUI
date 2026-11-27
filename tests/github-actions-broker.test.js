import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createGitHubCentralServiceSession } from "../src/infrastructure/github-central-service-session.js";
import {
  createGitHubActionsBroker,
  parseGitHubIssueCommentEvent
} from "../src/infrastructure/github-actions-broker.js";

const REPOSITORY_ID = 123456;
const ACTOR_ID = 987654;
const USER_ID = "canonical-user-01";
const REQUEST_ID = "10fd938a-2107-4b8a-ade1-ba77bc542182";

function envelope() {
  return {
    protocol: "YARDHUB_GITHUB_BROKER",
    version: 1,
    requestId: REQUEST_ID,
    createdAt: "2026-11-27T12:00:00.000Z",
    expiresAt: "2026-11-27T12:05:00.000Z",
    clientPublicKey: "A".repeat(87),
    nonce: "B".repeat(16),
    ciphertext: "C".repeat(96)
  };
}

function event(overrides = {}) {
  const body = "YARDHUB_REQUEST_V1:" + Buffer.from(JSON.stringify(envelope())).toString("base64url");
  return {
    action: "created",
    repository: { id: REPOSITORY_ID },
    sender: { id: ACTOR_ID, login: "yard-operator", type: "User" },
    issue: { id: 333, number: 7, pull_request: null },
    comment: { id: 444, user: { id: ACTOR_ID }, body },
    ...overrides
  };
}

function createBrokerHarness({
  request = { requestId: REQUEST_ID, service: "gatelog-api", action: "history", args: { range: "today" } },
  principalOverrides = {},
  authorised = true,
  decryptError = null
} = {}) {
  const calls = { resolved: [], issueChecks: [], decrypted: [], authorised: [], sessions: [], sessionDisposals: 0, executed: [], encrypted: [], published: [] };
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
        ...principalOverrides
      };
    },
    async authorizeInboxIssue(args) { calls.issueChecks.push(args); return true; },
    async decryptRequest(args) {
      calls.decrypted.push(args);
      if (decryptError) throw decryptError;
      return request;
    },
    async authorize(args) {
      calls.authorised.push(args);
      return authorised;
    },
    async createServiceSession(args) {
      calls.sessions.push(args);
      return { token: "broker-created-short-lived-service-session-token", async dispose() { calls.sessionDisposals += 1; } };
    },
    async execute(args) {
      calls.executed.push(args);
      return { count: 3 };
    },
    async encryptResponse(args) {
      calls.encrypted.push(args);
      return "encrypted-response-for-request-key";
    },
    async publishEncryptedResponse(args) {
      calls.published.push(args);
    },
    idempotencyStore,
    async getAuthorityEpoch() { return 4; }
  });
  return { broker, calls, records };
}

test("event parser derives actor from GitHub sender ID and accepts the encrypted ECDH client envelope", () => {
  const parsed = parseGitHubIssueCommentEvent(event(), { expectedRepositoryId: REPOSITORY_ID });
  assert.equal(parsed.actor.githubUserId, String(ACTOR_ID));
  assert.equal(parsed.actor.login, "yard-operator");
  assert.equal(parsed.repositoryId, REPOSITORY_ID);
  assert.equal(parsed.issueNumber, 7);
  assert.equal(parsed.commentId, 444);
  assert.equal(parsed.envelope.protocol, "YARDHUB_GITHUB_BROKER");
  assert.equal(parsed.envelope.requestId, REQUEST_ID);
});

test("event parser rejects pull requests, other repositories, bot actors and author mismatches", () => {
  const base = event();
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, issue: { ...base.issue, pull_request: { url: "x" } } }, { expectedRepositoryId: REPOSITORY_ID }), /not a pull request|not a pull/i);
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, repository: { id: REPOSITORY_ID + 1 } }, { expectedRepositoryId: REPOSITORY_ID }), /unapproved broker repository/);
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, sender: { ...base.sender, type: "Bot" } }, { expectedRepositoryId: REPOSITORY_ID }), /human account/);
  assert.throws(() => parseGitHubIssueCommentEvent({ ...base, comment: { ...base.comment, user: { id: 1 } } }, { expectedRepositoryId: REPOSITORY_ID }), /author does not match/);
});

test("broker maps GitHub numeric actor to canonical active USER and authorises before executing", async () => {
  const harness = createBrokerHarness();
  const result = await harness.broker.handleIssueComment(event());
  assert.deepEqual(result, { accepted: true, replayed: false, requestId: REQUEST_ID });
  assert.deepEqual(harness.calls.resolved, [String(ACTOR_ID)]);
  assert.equal(harness.calls.authorised[0].service, "gatelog-api");
  assert.equal(harness.calls.sessions[0].principal.userId, USER_ID);
  assert.equal(harness.calls.sessions[0].service, "gatelog-api");
  assert.equal(harness.calls.issueChecks[0].principal.userId, USER_ID);
  assert.equal(harness.calls.issueChecks[0].issueId, 333);
  assert.equal(harness.calls.decrypted[0].actorUserId, USER_ID);
  assert.equal(harness.calls.decrypted[0].envelope.protocol, "YARDHUB_GITHUB_BROKER");
  assert.equal(harness.calls.authorised[0].principal.userId, USER_ID);
  assert.equal(harness.calls.authorised[0].authorityEpoch, 4);
  assert.equal(harness.calls.executed[0].principal.userId, USER_ID);
  assert.equal(harness.calls.executed[0].service, "gatelog-api");
  assert.equal(harness.calls.executed[0].sessionToken, "broker-created-short-lived-service-session-token");
  assert.equal(harness.calls.sessionDisposals, 1);
  assert.equal(harness.calls.executed[0].authorityEpoch, 4);
  assert.equal(harness.calls.encrypted[0].requestEnvelope.requestId, REQUEST_ID);
  assert.equal(harness.calls.published[0].encryptedResponse, "encrypted-response-for-request-key");
});

test("broker denies unknown, disabled or incomplete canonical USER identities before decryption", async () => {
  for (const principalOverrides of [
    { enabled: false },
    { status: "SUSPENDED" },
    { userId: null },
    { staffId: null },
    { githubUserId: "another-github-user" }
  ]) {
    const harness = createBrokerHarness({ principalOverrides });
    await assert.rejects(harness.broker.handleIssueComment(event()), /not mapped to an active canonical USER/);
    assert.equal(harness.calls.decrypted.length, 0);
    assert.equal(harness.calls.executed.length, 0);
  }
});

test("broker rejects decryption failures and insufficient YARD ROLE permissions", async () => {
  const invalidEnvelope = createBrokerHarness({ decryptError: new Error("AEAD authentication failed") });
  await assert.rejects(invalidEnvelope.broker.handleIssueComment(event()), /AEAD authentication failed/);
  assert.equal(invalidEnvelope.calls.executed.length, 0);

  const denied = createBrokerHarness({ authorised: false });
  await assert.rejects(denied.broker.handleIssueComment(event()), /not authorised/);
  assert.equal(denied.calls.executed.length, 0);
});

test("broker rejects caller-supplied actor, role and privilege fields inside encrypted requests", async () => {
  for (const args of [
    { actorId: "DEV" },
    { actor_user_id: USER_ID },
    { permissions: { canManage: true } },
    { nested: { callerTier: "OWNER" } }
  ]) {
    const harness = createBrokerHarness({ request: { requestId: REQUEST_ID, service: "gatelog-api", action: "history", args } });
    await assert.rejects(harness.broker.handleIssueComment(event()), error => error.code === "BROKER_CALLER_IDENTITY_FORBIDDEN");
    assert.equal(harness.calls.executed.length, 0);
  }
});

test("broker pins idempotency to canonical USER and replays only the saved encrypted response", async () => {
  const harness = createBrokerHarness();
  await harness.broker.handleIssueComment(event());
  const replay = await harness.broker.handleIssueComment(event());
  assert.deepEqual(replay, { accepted: true, replayed: true, pending: false, requestId: REQUEST_ID });
  assert.equal(harness.calls.executed.length, 1);
  assert.equal(harness.calls.published.length, 2);
  assert.equal(harness.calls.published[1].encryptedResponse, "encrypted-response-for-request-key");
});

test("broker rejects caller-supplied session or access tokens before idempotency claim", async () => {
  for (const request of [
    { requestId: REQUEST_ID, service: "gatelog-api", action: "history", args: { sessionToken: "forged" } },
    { requestId: REQUEST_ID, service: "gatelog-api", action: "history", args: { accessToken: "forged" } }
  ]) {
    const harness = createBrokerHarness({ request });
    await assert.rejects(
      harness.broker.handleIssueComment(event()),
      error => error.code === "BROKER_CALLER_IDENTITY_FORBIDDEN"
    );
    assert.equal(harness.records.has(REQUEST_ID), false);
    assert.equal(harness.calls.sessions.length, 0);
    assert.equal(harness.calls.executed.length, 0);
  }
});

test("broker refuses execution if the current authority epoch is unavailable", async () => {
  const broker = createGitHubActionsBroker({
    expectedRepositoryId: REPOSITORY_ID,
    resolvePrincipal: async id => ({ githubUserId: id, userId: USER_ID, staffId: "staff-01", enabled: true, status: "ACTIVE" }),
    authorizeInboxIssue: async () => true,
    decryptRequest: async () => ({ requestId: REQUEST_ID, service: "gatelog-api", action: "history", args: {} }),
    authorize: async () => true,
    createServiceSession: async () => { throw new Error("Must not create a session without authority epoch."); },
    execute: async () => { throw new Error("Must not execute without authority epoch."); },
    encryptResponse: async () => "encrypted",
    publishEncryptedResponse: async () => {},
    idempotencyStore: { claim: async () => ({ acquired: true }), complete: async () => {} },
    getAuthorityEpoch: async () => null
  });
  await assert.rejects(broker.handleIssueComment(event()), /authority epoch is unavailable/);
});


test("broker denies a valid USER when the request issue is not assigned to that USER", async () => {
  const restricted = createGitHubActionsBroker({
    expectedRepositoryId: REPOSITORY_ID,
    resolvePrincipal: async id => ({ githubUserId: id, userId: USER_ID, staffId: "staff-01", enabled: true, status: "ACTIVE" }),
    authorizeInboxIssue: async () => false,
    decryptRequest: async () => { throw new Error("Must not decrypt an unassigned inbox issue."); },
    authorize: async () => true,
    createServiceSession: async () => { throw new Error("Must not create a session for an unassigned inbox issue."); },
    execute: async () => { throw new Error("Must not execute an unassigned inbox issue."); },
    encryptResponse: async () => "encrypted",
    publishEncryptedResponse: async () => {},
    idempotencyStore: { claim: async () => ({ acquired: true }), complete: async () => {} },
    getAuthorityEpoch: async () => 1
  });
  await assert.rejects(restricted.handleIssueComment(event()), error => error.code === "BROKER_ISSUE_OWNERSHIP_DENIED");
});


test("broker rejects unregistered service names before authorisation or execution", async () => {
  const harness = createBrokerHarness({
    request: { requestId: REQUEST_ID, service: "unknown-service", action: "history", args: {} }
  });
  await assert.rejects(harness.broker.handleIssueComment(event()), /schema validation/);
  assert.equal(harness.calls.authorised.length, 0);
  assert.equal(harness.calls.executed.length, 0);
});


test("broker service sessions store only a hash and are revoked after the service action", async () => {
  const state = {
    revision: 0,
    tables: { downtime_central_sessions: [] }
  };
  const store = {
    async readDatabase() {
      return { revision: state.revision, tables: structuredClone(state.tables) };
    },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== state.revision) {
        const error = new Error("revision conflict");
        error.status = 409;
        throw error;
      }
      const draft = structuredClone(state.tables);
      await mutate(draft);
      state.tables = draft;
      state.revision += 1;
      return { committed: true, revision: state.revision };
    }
  };
  const session = await createGitHubCentralServiceSession({
    store,
    principal: { userId: USER_ID, staffId: "staff-01", username: "operator", tier: "USER", enabled: true, status: "ACTIVE" },
    requestId: REQUEST_ID,
    cryptoProvider: webcrypto,
    now: () => new Date("2026-11-27T12:00:00.000Z")
  });
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.equal(state.tables.downtime_central_sessions.length, 1);
  const row = state.tables.downtime_central_sessions[0];
  assert.equal(row.username, "operator");
  assert.equal(row.tier, "USER");
  assert.equal(row.created_at, "2026-11-27T12:00:00.000Z");
  assert.equal(row.expires_at, "2026-11-27T12:02:00.000Z");
  assert.equal(Object.hasOwn(row, "token"), false);
  assert.notEqual(row.token_hash, session.token);
  await session.dispose();
  assert.equal(state.tables.downtime_central_sessions.length, 0);
  await session.dispose();
  assert.equal(state.revision, 2);
});

test("broker service session refuses non-active or incomplete canonical identities", async () => {
  const store = { readDatabase: async () => ({ revision: 0, tables: {} }), transactDatabase: async () => { throw new Error("must not write"); } };
  await assert.rejects(createGitHubCentralServiceSession({
    store, principal: { userId: USER_ID, staffId: "staff-01", username: "operator", enabled: false, status: "ACTIVE" },
    requestId: REQUEST_ID, cryptoProvider: webcrypto
  }), /active canonical USER/);
});


test("broker uses the private-store Central Bank session factory when no override is supplied", async () => {
  const state = { revision: 0, tables: { downtime_central_sessions: [] } };
  const store = {
    async readDatabase() { return { revision: state.revision, tables: structuredClone(state.tables) }; },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== state.revision) {
        const error = new Error("revision conflict");
        error.status = 409;
        throw error;
      }
      const draft = structuredClone(state.tables);
      await mutate(draft);
      state.tables = draft;
      state.revision += 1;
      return { committed: true, revision: state.revision };
    }
  };
  let executedToken = null;
  const broker = createGitHubActionsBroker({
    expectedRepositoryId: REPOSITORY_ID,
    store,
    cryptoProvider: webcrypto,
    now: () => new Date("2026-11-27T12:00:00.000Z"),
    resolvePrincipal: async id => ({
      githubUserId: id, userId: USER_ID, staffId: "staff-01",
      username: "operator", tier: "USER", enabled: true, status: "ACTIVE"
    }),
    authorizeInboxIssue: async () => true,
    decryptRequest: async () => ({
      requestId: REQUEST_ID, service: "gatelog-api", action: "history", args: {}
    }),
    authorize: async () => true,
    execute: async ({ sessionToken }) => {
      executedToken = sessionToken;
      assert.match(sessionToken, /^[a-f0-9]{64}$/);
      return { ok: true };
    },
    encryptResponse: async () => "encrypted-response",
    publishEncryptedResponse: async () => {},
    idempotencyStore: {
      claim: async () => ({ acquired: true }),
      complete: async () => {},
      fail: async () => {}
    },
    getAuthorityEpoch: async () => 2
  });
  await broker.handleIssueComment(event());
  assert.match(executedToken, /^[a-f0-9]{64}$/);
  assert.equal(state.tables.downtime_central_sessions.length, 0);
  assert.equal(state.revision, 2);
});
