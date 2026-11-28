import test from "node:test";
import assert from "node:assert/strict";
import { runGitHubBrokerIdentityAdmin } from "../scripts/manage-github-broker-identity.mjs";

const DEV_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const STAFF_ID = "00000000-0000-4000-8000-000000000003";
const BROKER_REPOSITORY_ID = 123456;
const DATA_REPOSITORY_ID = 789012;
const DEV_GITHUB_ID = "111111";
const TARGET_GITHUB_ID = "222222";

function makeStore(initialLinks = []) {
  const state = {
    revision: 0,
    tables: {
      downtime_central_bank: [{
        id: 1,
        payload: {
          users: [
            { userId: DEV_ID, username: "DEV", enabled: true, status: "ACTIVE", tier: "DEVACC" },
            { userId: USER_ID, username: "OPERATOR", enabled: true, status: "ACTIVE", staffId: STAFF_ID, tier: "USER" }
          ],
          staff: { profiles: {
            OPERATOR: { staffId: STAFF_ID, linkedUserId: USER_ID, displayName: "Operator" }
          } }
        }
      }],
      downtime_roots_bootstrap: [{ singleton: true, user_id: DEV_ID }],
      downtime_github_identities: structuredClone(initialLinks),
      downtime_github_broker_identity_audit: []
    }
  };
  return {
    state,
    async readDatabase() { return { revision: state.revision, tables: structuredClone(state.tables) }; },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== state.revision) { const error = new Error("revision conflict"); error.status = 409; throw error; }
      const draft = structuredClone(state.tables);
      const result = await mutate(draft);
      state.tables = draft;
      state.revision += 1;
      return { committed: true, revision: state.revision, result };
    }
  };
}

function setup({ action = "link", actorId = DEV_GITHUB_ID, isPrivate = true, assigneeId = TARGET_GITHUB_ID, assignees = null, labels = [{ name: "yardhub-inbox" }], links = [] } = {}) {
  const store = makeStore(links);
  const calls = { token: [], issue: [], metadata: [], brokerMetadata: [] };
  const event = {
    repository: { id: BROKER_REPOSITORY_ID, full_name: "private-yardhub/yardhub-inbox", private: isPrivate, default_branch: "main" },
    sender: { id: Number(actorId), login: "workflow-actor" },
    inputs: {
      action,
      github_user_id: TARGET_GITHUB_ID,
      user_id: USER_ID,
      staff_id: STAFF_ID,
      broker_issue_number: "77",
      broker_issue_id: "333",
      reason: "Provision operator inbox"
    }
  };
  const env = {
    GITHUB_EVENT_PATH: "/tmp/event.json",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "private-yardhub/yardhub-inbox",
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR_ID: String(actorId),
    YARDHUB_BROKER_REPOSITORY_ID: String(BROKER_REPOSITORY_ID),
    YARDHUB_BROKER_BOOTSTRAP_GITHUB_USER_ID: DEV_GITHUB_ID,
    YARDHUB_BROKER_BOOTSTRAP_ISSUE_ID: "1001",
    YARDHUB_DATA_OWNER: "private-yardhub",
    YARDHUB_DATA_REPOSITORY: "yardhub-data",
    YARDHUB_DATA_REPOSITORY_ID: String(DATA_REPOSITORY_ID),
    YARDHUB_DATA_APP_ID: "1234",
    YARDHUB_DATA_APP_INSTALLATION_ID: "5678",
    YARDHUB_DATA_APP_PRIVATE_KEY: "mock-private-key",
    GITHUB_TOKEN: "broker-issues-read-token"
  };
  const run = () => runGitHubBrokerIdentityAdmin({
    env,
    readEvent: async () => JSON.stringify(event),
    mintDataToken: async args => { calls.token.push(args); return "repository-restricted-data-token"; },
    createStore: args => {
      assert.equal(args.owner, "private-yardhub");
      assert.equal(args.repo, "yardhub-data");
      assert.equal(args.branch, "data/yardhub");
      assert.equal(args.token, "repository-restricted-data-token");
      return store;
    },
    fetchImpl: async (url, options) => {
      if (url.endsWith("/repos/private-yardhub/yardhub-inbox")) {
        calls.brokerMetadata.push({ url, options });
        return new Response(JSON.stringify({ id: BROKER_REPOSITORY_ID, private: true }), { status: 200 });
      }
      if (url.endsWith("/repos/private-yardhub/yardhub-data")) {
        calls.metadata.push({ url, options });
        return new Response(JSON.stringify({ id: DATA_REPOSITORY_ID, private: true }), { status: 200 });
      }
      calls.issue.push({ url, options });
      return new Response(JSON.stringify({
        id: 333,
        number: 77,
        state: "open",
        labels,
        assignees: assignees || [{ id: Number(assigneeId) }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  return { run, store, calls, event, env };
}

test("DEV can link a GitHub actor only to an active reciprocal USER/STAFF and an open inbox issue assigned to that actor", async () => {
  const h = setup();
  const result = await h.run();
  assert.deepEqual(result, { accepted: true, action: "link" });
  assert.equal(h.store.state.tables.downtime_github_identities.length, 1);
  const identity = h.store.state.tables.downtime_github_identities[0];
  assert.equal(identity.github_user_id, TARGET_GITHUB_ID);
  assert.equal(identity.user_id, USER_ID);
  assert.equal(identity.staff_id, STAFF_ID);
  assert.equal(identity.broker_issue_id, 333);
  assert.equal(identity.status, "ACTIVE");
  assert.equal(h.store.state.tables.downtime_github_broker_identity_audit[0].event_type, "LINKED");
  assert.equal(h.calls.issue.length, 1);
  assert.equal(h.calls.issue[0].options.headers.Authorization, "Bearer broker-issues-read-token");
  assert.equal(h.calls.brokerMetadata.length, 1);
  assert.equal(h.calls.brokerMetadata[0].options.headers.Authorization, "Bearer broker-issues-read-token");
  assert.equal(h.calls.metadata.length, 1);
  assert.equal(h.calls.metadata[0].options.headers.Authorization, "Bearer repository-restricted-data-token");
  assert.equal(h.calls.token[0].repositoryId, DATA_REPOSITORY_ID);
});

test("only the authenticated immutable DEV actor can administer broker identities", async () => {
  const h = setup({ actorId: "333333" });
  await assert.rejects(h.run(), /Only the authenticated immutable DEV principal/);
  assert.equal(h.store.state.tables.downtime_github_identities.length, 0);
});

test("identity linking rejects a public broker repository or an inbox issue not exclusively assigned to the target actor", async () => {
  const publicRepo = setup({ isPrivate: false });
  await assert.rejects(publicRepo.run(), /configured private broker repository/);
  assert.equal(publicRepo.calls.token.length, 0);

  const wrongAssignee = setup({ assigneeId: "999999" });
  await assert.rejects(wrongAssignee.run(), /must be open, non-PR and assigned/);
  assert.equal(wrongAssignee.store.state.tables.downtime_github_identities.length, 0);

  const sharedInbox = setup({ assignees: [{ id: Number(TARGET_GITHUB_ID) }, { id: 999999 }] });
  await assert.rejects(sharedInbox.run(), /must be open, non-PR and assigned/);
  assert.equal(sharedInbox.store.state.tables.downtime_github_identities.length, 0);
});

test("DEV can revoke an existing GitHub identity and the operation is audited", async () => {
  const links = [{
    github_user_id: TARGET_GITHUB_ID,
    user_id: USER_ID,
    staff_id: STAFF_ID,
    broker_issue_id: 333,
    status: "ACTIVE"
  }];
  const h = setup({ action: "revoke", links });
  const result = await h.run();
  assert.deepEqual(result, { accepted: true, action: "revoke" });
  assert.equal(h.store.state.tables.downtime_github_identities[0].status, "REVOKED");
  assert.equal(h.store.state.tables.downtime_github_broker_identity_audit[0].event_type, "REVOKED");
});


test("identity administration refuses protected or reused repositories before minting a Data App token", async () => {
  const protectedRepo = setup();
  protectedRepo.env.YARDHUB_DATA_OWNER = "aka30art";
  protectedRepo.env.YARDHUB_DATA_REPOSITORY = "DOWNTIME";
  await assert.rejects(protectedRepo.run(), /dedicated private repositories/);
  assert.equal(protectedRepo.calls.token.length, 0);
});


test("identity linking rejects an inbox issue without the required yardhub-inbox label", async () => {
  const h = setup({ labels: [] });
  await assert.rejects(h.run(), /must be open, non-PR and assigned/);
  assert.equal(h.store.state.tables.downtime_github_identities.length, 0);
});
