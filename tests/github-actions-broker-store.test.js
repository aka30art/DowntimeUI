import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeGitHubBrokerInboxIssue,
  createGitHubBrokerIdempotencyStore,
  getGitHubBrokerAuthorityEpoch,
  resolveGitHubBrokerPrincipal
} from "../src/infrastructure/github-actions-broker-store.js";

function makeStore() {
  let revision = 0;
  const tables = {
    downtime_github_identities: [{
      github_user_id: "987654",
      user_id: "user-01",
      staff_id: "staff-01",
      broker_issue_id: 333,
      status: "ACTIVE"
    }],
    downtime_central_bank: [{
      id: 1,
      payload: { users: [{
        userId: "user-01", staffId: "staff-01", username: "operator",
        tier: "USER", enabled: true, status: "ACTIVE"
      }] }
    }],
    downtime_github_broker_requests: []
  };
  let authority = { status: "ACTIVE", primarySystemId: "DOWNTIMEUI-GITHUB", epoch: 4 };
  return {
    async readDatabase() { return { revision, tables: structuredClone(tables) }; },
    async readTable(name) { return structuredClone(tables[name] || []); },
    async readAuthority() { return structuredClone(authority); },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== revision) {
        const error = new Error("revision conflict");
        error.status = 409;
        throw error;
      }
      const draft = structuredClone(tables);
      const result = await mutate(draft);
      for (const [name, rows] of Object.entries(draft)) tables[name] = rows;
      revision += 1;
      return { committed: true, revision, result };
    },
    setAuthority(value) { authority = value; },
    get tables() { return structuredClone(tables); },
    get revision() { return revision; }
  };
}

const REQUEST_ID = "10fd938a-2107-4b8a-ade1-ba77bc542182";

test("GitHub actor resolves only through active identity mapping to an active canonical USER/STAFF", async () => {
  const store = makeStore();
  const principal = await resolveGitHubBrokerPrincipal({ store, githubUserId: 987654 });
  assert.deepEqual(principal, {
    githubUserId: "987654",
    userId: "user-01",
    staffId: "staff-01",
    username: "operator",
    tier: "USER",
    enabled: true,
    status: "ACTIVE",
    brokerIssueId: 333
  });
  assert.equal(await authorizeGitHubBrokerInboxIssue({ principal, issueId: 333 }), true);
  assert.equal(await authorizeGitHubBrokerInboxIssue({ principal, issueId: 334 }), false);
  assert.equal(await resolveGitHubBrokerPrincipal({ store, githubUserId: 111 }), null);
});

test("broker authority epoch is available only when GitHub twin is active primary", async () => {
  const store = makeStore();
  assert.equal(await getGitHubBrokerAuthorityEpoch({ store }), 4);
  store.setAuthority({ status: "ACTIVE", primarySystemId: "YARDHUB-PRIMARY", epoch: 4 });
  assert.equal(await getGitHubBrokerAuthorityEpoch({ store }), null);
  store.setAuthority({ status: "FROZEN", primarySystemId: "DOWNTIMEUI-GITHUB", epoch: 4 });
  assert.equal(await getGitHubBrokerAuthorityEpoch({ store }), null);
});

test("durable broker idempotency serializes claims, recovers expired leases and replays encrypted responses", async () => {
  const store = makeStore();
  let clock = new Date("2026-11-27T12:00:00.000Z");
  const ledger = createGitHubBrokerIdempotencyStore({
    store,
    now: () => new Date(clock),
    leaseMs: 15 * 60 * 1000
  });
  const args = {
    requestId: REQUEST_ID,
    actorUserId: "user-01",
    commentId: 444,
    service: "gatelog-api",
    action: "history",
    authorityEpoch: 4
  };
  const first = await ledger.claim(args);
  assert.deepEqual(first, { acquired: true });
  const duplicate = await ledger.claim(args);
  assert.equal(duplicate.acquired, false);
  assert.equal(duplicate.state, "PROCESSING");

  clock = new Date("2026-11-27T12:16:00.000Z");
  const recovered = await ledger.claim(args);
  assert.deepEqual(recovered, { acquired: true });

  await store.transactDatabase({
    expectedRevision: store.revision,
    mutate: tables => {
      const row = tables.downtime_github_broker_requests.find(item => item.request_id === REQUEST_ID);
      row.state = "COMMITTED";
      row.lease_until = null;
    }
  });
  const committed = await ledger.claim(args);
  assert.equal(committed.acquired, false);
  assert.equal(committed.state, "COMMITTED");

  await ledger.complete({
    requestId: REQUEST_ID,
    actorUserId: "user-01",
    encryptedResponse: "YARDHUB_RESPONSE_V1:encrypted"
  });
  const completed = await ledger.claim(args);
  assert.equal(completed.acquired, false);
  assert.equal(completed.state, "COMPLETED");
  assert.equal(completed.encryptedResponse, "YARDHUB_RESPONSE_V1:encrypted");
  await ledger.fail({ requestId: REQUEST_ID, actorUserId: "user-01", code: "late-error" });
  assert.equal(store.tables.downtime_github_broker_requests[0].state, "COMPLETED");
});

test("idempotency claim cannot be replayed by a different canonical USER", async () => {
  const store = makeStore();
  const ledger = createGitHubBrokerIdempotencyStore({ store });
  await ledger.claim({ requestId: REQUEST_ID, actorUserId: "user-01", commentId: 444 });
  const other = await ledger.claim({ requestId: REQUEST_ID, actorUserId: "user-02", commentId: 555 });
  assert.equal(other.acquired, false);
  assert.equal(other.actorUserId, "user-01");
});
