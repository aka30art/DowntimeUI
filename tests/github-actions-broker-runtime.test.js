import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createEncryptedBrokerRequest } from "../src/infrastructure/github-app-broker-client.js";
import { createGitHubYardHubBroker } from "../src/infrastructure/github-actions-broker-runtime.js";

const SERVICE_NAMES = [
  "central-bank",
  "central-config-admin",
  "gatelog-api",
  "photo-evidence",
  "repair-maintenance-api",
  "spectator-read",
  "yard-hub-settings-api"
];

function makeRuntimeOptions(overrides = {}) {
  const store = {
    async readDatabase() {
      return { revision: 0, tables: {
        downtime_github_broker_requests: [],
        downtime_github_identities: [],
        downtime_central_bank: [],
        downtime_central_sessions: [],
        downtime_roots_bootstrap: [],
        downtime_roots_assignments: [],
        yard_role_assignments: [],
        yard_roles: [],
        yard_role_department_permissions: []
      } };
    },
    async readSnapshot() { return null; },
    async writeSnapshot() { return { ok: true, version: 1 }; },
    async readTable() { return []; },
    async readAuthority() {
      return { status: "ACTIVE", primarySystemId: "YARDHUB-PRIMARY", epoch: 1 };
    },
    async transactDatabase() {
      return { committed: true, revision: 1 };
    }
  };
  const handlers = Object.fromEntries(SERVICE_NAMES.map(name => [
    name,
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  ]));
  return {
    store,
    handlers,
    expectedRepositoryId: 123456,
    brokerPrivateKey: Object.freeze({ key: "test-only-placeholder" }),
    githubToken: "test-broker-token",
    brokerOwner: "test-owner",
    brokerRepository: "test-inbox",
    cryptoProvider: { subtle: {} },
    fetchImpl: async () => new Response("{}", { status: 201 }),
    ...overrides
  };
}

test("GitHub YARDHUB broker runtime composes all seven preserved service handlers", () => {
  const broker = createGitHubYardHubBroker(makeRuntimeOptions());
  assert.equal(typeof broker.handleIssueComment, "function");
});


test("composed broker denies a GATELOG MANAGE action for a USER whose Traffic role is INPUT", async () => {
  const userId = "00000000-0000-4000-8000-000000000002";
  const staffId = "00000000-0000-4000-8000-000000000003";
  const roleId = "00000000-0000-4000-8000-000000000004";
  const brokerRepositoryId = 123456;
  const inboxIssueId = 3001;
  const githubUserId = "987654";
  const tables = {
    downtime_github_broker_requests: [],
    downtime_github_identities: [{
      github_user_id: githubUserId,
      user_id: userId,
      staff_id: staffId,
      broker_issue_id: inboxIssueId,
      status: "ACTIVE"
    }],
    downtime_central_bank: [{
      id: 1,
      payload: {
        users: [{
          userId, staffId, username: "operator",
          enabled: true, status: "ACTIVE", tier: "USER"
        }],
        staff: { profiles: { operator: { staffId, linkedUserId: userId, displayName: "Operator" } } }
      }
    }],
    downtime_central_sessions: [],
    downtime_roots_bootstrap: [{ singleton: true, user_id: "00000000-0000-4000-8000-000000000001" }],
    downtime_roots_assignments: [],
    yard_role_assignments: [{ user_id: userId, staff_id: staffId, yard_role_id: roleId, status: "ACTIVE" }],
    yard_roles: [{ id: roleId, name: "YARD OPERATOR", status: "ACTIVE" }],
    yard_role_department_permissions: [
      { yard_role_id: roleId, department: "SCPL", can_view: true, can_enter: true, can_edit: false, can_manage: false },
      { yard_role_id: roleId, department: "R&M", can_view: false, can_enter: false, can_edit: false, can_manage: false },
      { yard_role_id: roleId, department: "Management", can_view: false, can_enter: false, can_edit: false, can_manage: false },
      { yard_role_id: roleId, department: "SCFL", can_view: false, can_enter: false, can_edit: false, can_manage: false },
      { yard_role_id: roleId, department: "Traffic", can_view: true, can_enter: true, can_edit: false, can_manage: false }
    ]
  };
  const identitySnapshot = {
    version: 1,
    payload: {
      links: [{
        githubUserId,
        userId,
        brokerRepositoryId,
        brokerIssueId: inboxIssueId,
        status: "ACTIVE"
      }]
    }
  };
  let handlerCalls = 0;
  const store = {
    async readDatabase() { return { revision: 0, tables: structuredClone(tables) }; },
    async readSnapshot() { return structuredClone(identitySnapshot); },
    async writeSnapshot() { throw new Error("Identity link must not change during an ordinary request."); },
    async readAuthority() { return { status: "ACTIVE", primarySystemId: "DOWNTIMEUI-GITHUB", epoch: 1 }; },
    async transactDatabase() { throw new Error("Denied action must not claim idempotency or create a session."); }
  };
  const handlers = Object.fromEntries(SERVICE_NAMES.map(name => [name, async () => {
    handlerCalls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }]));
  const brokerKeys = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]
  );
  const brokerPublicKey = Buffer.from(await webcrypto.subtle.exportKey("raw", brokerKeys.publicKey)).toString("base64url");
  const encryptedRequest = await createEncryptedBrokerRequest({
    payload: {
      service: "gatelog-api",
      action: "visit-delete",
      args: { visitId: "visit-01" }
    },
    brokerPublicKey,
    cryptoProvider: webcrypto
  });
  const broker = createGitHubYardHubBroker({
    store,
    handlers,
    expectedRepositoryId: brokerRepositoryId,
    brokerPrivateKey: brokerKeys.privateKey,
    githubToken: "broker-token-only",
    brokerOwner: "test-owner",
    brokerRepository: "test-inbox",
    cryptoProvider: webcrypto,
    fetchImpl: async () => { throw new Error("A denied action must not publish a response."); }
  });
  const event = {
    action: "created",
    repository: { id: brokerRepositoryId },
    sender: { id: Number(githubUserId), login: "operator", type: "User" },
    issue: { id: inboxIssueId, number: 77 },
    comment: { id: 88, user: { id: Number(githubUserId) }, body: encryptedRequest.commentBody }
  };
  await assert.rejects(
    broker.handleIssueComment(event),
    error => error.code === "BROKER_PERMISSION_DENIED"
  );
  assert.equal(handlerCalls, 0);
});

test("GitHub YARDHUB broker runtime rejects a missing private data store", () => {
  assert.throws(
    () => createGitHubYardHubBroker(makeRuntimeOptions({ store: null })),
    /private GitHub YARDHUB data store/
  );
});

test("GitHub YARDHUB broker runtime requires every preserved service handler", () => {
  const handlers = Object.fromEntries(SERVICE_NAMES.map(name => [name, async () => new Response("{}")]));
  delete handlers["gatelog-api"];
  assert.throws(
    () => createGitHubYardHubBroker(makeRuntimeOptions({ handlers })),
    /All seven preserved YARDHUB service handlers/
  );
});

test("GitHub YARDHUB broker runtime refuses to start without broker key material or WebCrypto", () => {
  assert.throws(
    () => createGitHubYardHubBroker(makeRuntimeOptions({ brokerPrivateKey: null })),
    /Broker private key, WebCrypto and fetch/
  );
  assert.throws(
    () => createGitHubYardHubBroker(makeRuntimeOptions({ cryptoProvider: null })),
    /Broker private key, WebCrypto and fetch/
  );
});

test("GitHub YARDHUB broker runtime requires a broker-repository response credential", () => {
  assert.throws(
    () => createGitHubYardHubBroker(makeRuntimeOptions({ githubToken: "" })),
    /broker-repository issue-comment token and repository identity/
  );
});
