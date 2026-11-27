import test from "node:test";
import assert from "node:assert/strict";
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
