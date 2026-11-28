import test from "node:test";
import assert from "node:assert/strict";
import {
  createGitHubBrokerAuthority,
  SERVICE_ACTION_POLICIES
} from "../src/infrastructure/github-broker-authority.js";

const DEV_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const STAFF_ID = "00000000-0000-4000-8000-000000000003";
const ROLE_ID = "00000000-0000-4000-8000-000000000004";
const BROKER_REPOSITORY_ID = 12345678;
const DEV_GITHUB_ID = "111111";
const USER_GITHUB_ID = "222222";
const DEV_INBOX_ISSUE_ID = 1001;
const USER_INBOX_ISSUE_ID = 1002;

function makeStore() {
  const state = {
    revision: 0,
    snapshot: {
      version: 1,
      payload: {
        links: [{
          githubUserId: USER_GITHUB_ID,
          userId: USER_ID,
          brokerRepositoryId: BROKER_REPOSITORY_ID,
          brokerIssueId: USER_INBOX_ISSUE_ID,
          status: "ACTIVE"
        }]
      }
    },
    tables: {
      downtime_github_identities: [{
        github_user_id: USER_GITHUB_ID,
        user_id: USER_ID,
        staff_id: STAFF_ID,
        broker_issue_id: USER_INBOX_ISSUE_ID,
        status: "ACTIVE"
      }],
      downtime_github_broker_identity_audit: [],
      downtime_central_bank: [{
        id: 1,
        version: 1,
        payload: {
          users: [
            { userId: DEV_ID, username: "DEV", enabled: true, tier: "DEV" },
            { userId: USER_ID, username: "OPERATOR", enabled: true, status: "ACTIVE", staffId: STAFF_ID, tier: "USER" },
            { userId: "00000000-0000-4000-8000-000000000099", username: "DISABLED", enabled: false, status: "ACTIVE", staffId: "00000000-0000-4000-8000-000000000098" },
            { userId: "00000000-0000-4000-8000-000000000005", username: "NEWOPERATOR", enabled: true, status: "ACTIVE", staffId: "00000000-0000-4000-8000-000000000006", tier: "USER" }
          ],
          staff: {
            profiles: {
              OPERATOR: { staffId: STAFF_ID, linkedUserId: USER_ID, displayName: "Operator" },
              NEWOPERATOR: { staffId: "00000000-0000-4000-8000-000000000006", linkedUserId: "00000000-0000-4000-8000-000000000005", displayName: "New Operator" }
            }
          }
        }
      }],
      downtime_roots_bootstrap: [{ singleton: true, user_id: DEV_ID }],
      downtime_roots_assignments: [],
      yard_roles: [{ id: ROLE_ID, name: "YARD OPERATOR", status: "ACTIVE" }],
      yard_role_assignments: [{ user_id: USER_ID, staff_id: STAFF_ID, yard_role_id: ROLE_ID, status: "ACTIVE" }],
      yard_role_department_permissions: [
        { yard_role_id: ROLE_ID, department: "SCPL", can_view: true, can_enter: true, can_edit: false, can_manage: false },
        { yard_role_id: ROLE_ID, department: "R&M", can_view: true, can_enter: true, can_edit: false, can_manage: false },
        { yard_role_id: ROLE_ID, department: "Management", can_view: true, can_enter: false, can_edit: false, can_manage: false },
        { yard_role_id: ROLE_ID, department: "SCFL", can_view: false, can_enter: false, can_edit: false, can_manage: false },
        { yard_role_id: ROLE_ID, department: "Traffic", can_view: true, can_enter: true, can_edit: false, can_manage: false }
      ]
    }
  };

  return {
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
      const result = await mutate(draft);
      state.tables = draft;
      state.revision += 1;
      return { committed: true, revision: state.revision, result };
    },
    async readSnapshot() {
      return state.snapshot ? structuredClone(state.snapshot) : null;
    },
    async writeSnapshot({ expectedVersion, payload, actorId }) {
      const version = state.snapshot?.version ?? null;
      assert.equal(version, expectedVersion);
      state.snapshot = {
        version: (version || 0) + 1,
        actorId,
        payload: structuredClone(payload)
      };
      return { ok: true, snapshot: structuredClone(state.snapshot) };
    },
    async readAuthority() { return { status: "ACTIVE", primarySystemId: "DOWNTIMEUI-GITHUB", epoch: 4 }; },
    state
  };
}

test("broker maps only a linked GitHub numeric actor to a reciprocal active USER/STAFF and role", async () => {
  const store = makeStore();
  const authority = createGitHubBrokerAuthority({
    store, brokerRepositoryId: BROKER_REPOSITORY_ID
  });
  const principal = await authority.resolvePrincipal(USER_GITHUB_ID);
  assert.equal(principal.userId, USER_ID);
  assert.equal(principal.staffId, STAFF_ID);
  assert.equal(principal.username, "OPERATOR");
  assert.equal(principal.yardRoleId, ROLE_ID);
  assert.equal(principal.departments.Traffic.enter, true);
  assert.equal(await authority.resolvePrincipal("333333"), null);
  assert.equal(await authority.resolvePrincipal(DEV_GITHUB_ID), null);
});

test("broker pins requests to the linked user's own inbox issue and repository", async () => {
  const authority = createGitHubBrokerAuthority({
    store: makeStore(), brokerRepositoryId: BROKER_REPOSITORY_ID
  });
  const principal = await authority.resolvePrincipal(USER_GITHUB_ID);
  assert.equal(await authority.authorizeInboxIssue({
    principal, issueId: USER_INBOX_ISSUE_ID, repositoryId: BROKER_REPOSITORY_ID
  }), true);
  assert.equal(await authority.authorizeInboxIssue({
    principal, issueId: DEV_INBOX_ISSUE_ID, repositoryId: BROKER_REPOSITORY_ID
  }), false);
  assert.equal(await authority.authorizeInboxIssue({
    principal, issueId: USER_INBOX_ISSUE_ID, repositoryId: 99999999
  }), false);
});

test("broker authorization requires the exact department capability and denies unknown actions", async () => {
  const authority = createGitHubBrokerAuthority({
    store: makeStore(), brokerRepositoryId: BROKER_REPOSITORY_ID
  });
  const principal = await authority.resolvePrincipal(USER_GITHUB_ID);
  assert.equal(await authority.authorize({
    principal, service: "gatelog-api", action: "customer-arrival",
    args: {}, authorityEpoch: 4
  }), true);
  assert.equal(await authority.authorize({
    principal, service: "gatelog-api", action: "visit-delete",
    args: {}, authorityEpoch: 4
  }), false);
  assert.equal(await authority.authorize({
    principal, service: "repair-maintenance-api", action: "update",
    args: {}, authorityEpoch: 4
  }), false);
  assert.equal(await authority.authorize({
    principal, service: "central-bank", action: "not-a-source-action",
    args: {}, authorityEpoch: 4
  }), false);
  assert.equal(await authority.authorize({
    principal, service: "yard-hub-settings-api", action: "my-access",
    args: {}, authorityEpoch: 4
  }), true);
  assert.equal(await authority.authorize({
    principal: { ...principal, rootsClass: "DEV" },
    service: "central-bank", action: "identity-reset",
    args: {}, authorityEpoch: 4
  }), true);
});

test("only immutable DEV can link or revoke GitHub identities", async () => {
  const store = makeStore();
  const authority = createGitHubBrokerAuthority({
    store, brokerRepositoryId: BROKER_REPOSITORY_ID
  });
  const user = await authority.resolvePrincipal(USER_GITHUB_ID);
  await assert.rejects(authority.linkIdentity({
    actorPrincipal: user,
    githubUserId: "444444",
    userId: "00000000-0000-4000-8000-000000000005",
    staffId: "00000000-0000-4000-8000-000000000006",
    issueId: 1003,
    reason: "Provision operator broker identity"
  }), /Only .*immutable DEV/);

  const rootAuthority = createGitHubBrokerAuthority({
    store, brokerRepositoryId: BROKER_REPOSITORY_ID,
    bootstrapGitHubUserId: DEV_GITHUB_ID,
    bootstrapIssueId: DEV_INBOX_ISSUE_ID
  });
  const dev = await rootAuthority.resolvePrincipal(DEV_GITHUB_ID);
  assert.equal(dev.rootsClass, "DEV");
  assert.equal(dev.staffId, null);
  assert.equal(await rootAuthority.authorizeInboxIssue({
    principal: dev, issueId: DEV_INBOX_ISSUE_ID, repositoryId: BROKER_REPOSITORY_ID
  }), true);

  const linked = await rootAuthority.linkIdentity({
    actorPrincipal: dev,
    githubUserId: "444444",
    userId: "00000000-0000-4000-8000-000000000005",
    staffId: "00000000-0000-4000-8000-000000000006",
    issueId: 1003,
    reason: "Provision operator broker identity"
  });
  assert.equal(linked.status, "ACTIVE");
  assert.equal(linked.github_user_id, "444444");
  assert.equal(linked.user_id, "00000000-0000-4000-8000-000000000005");
  assert.ok(store.state.tables.downtime_github_identities.some(link => link.github_user_id === "444444"));
  await rootAuthority.revokeIdentity({
    actorPrincipal: dev,
    githubUserId: "444444",
    reason: "Remove operator broker access"
  });
  assert.equal(store.state.tables.downtime_github_identities.find(link => link.github_user_id === "444444").status, "REVOKED");
  assert.deepEqual(store.state.tables.downtime_github_broker_identity_audit.map(row => row.event_type), ["LINKED", "REVOKED"]);
});

test("broker policy table explicitly lists all 96 source action/read surfaces", () => {
  const expected = {
    "central-bank": [
      "bootstrap","login","logout","list-users","get-state","user-staff-provision",
      "user-staff-activate","identity-reset","identity-diagnostics","photo-evidence-context",
      "central-admin-state","central-config-state","central-config-save-draft","central-config-publish",
      "central-config-restore-draft","daily-operator-list","daily-operator-assign","daily-operator-unlock",
      "save-state","save-settings","staff-save","user-save","user-delete","staff-original-upload",
      "staff-photo-url","staff-photo-read","staff-photo-remove","set-plant-status","tiers-save","users"
    ],
    "central-config-admin": [
      "central-config-audit","central-config-impact","central-config-publish","central-config-restore-draft",
      "central-config-save-draft","central-config-state","central-config-validate","yard-hub-menu"
    ],
    "gatelog-api": [
      "arrival","bootstrap","customer-archive","customer-arrival","customer-save","customer-update",
      "day-register","departure","gateman-lock","gateman-save","history","report","report-archive",
      "report-save","vehicle-save","visit-delete","visit-update","waste-type-create","waste-type-update"
    ],
    "photo-evidence": ["cleanup","create-upload","delete","view"],
    "repair-maintenance-api": [
      "access","asset-add","asset-archive","asset-delete","asset-list","asset-update","create","delete",
      "export-create","export-delete","export-list","export-url","get","list","model-add","model-delete",
      "model-list","note-add","preset-add","preset-delete","preset-list","settings-get","settings-update",
      "update","upload"
    ],
    "spectator-read": ["spectator-snapshot-read"],
    "yard-hub-settings-api": [
      "assign-user-role","my-access","remove-user-tier","roots-manage","roots-state","save-tier-settings",
      "save-user-tier","settings-state","yard-role-save"
    ]
  };
  for (const [service, actions] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(SERVICE_ACTION_POLICIES[service]).sort(), actions.sort(), service + " policy catalogue");
  }
  assert.equal(Object.values(expected).reduce((total, actions) => total + actions.length, 0), 96);
});

console.log("PASS: GitHub broker authority — actor mapping, DEV bootstrap, inbox ownership, YARD ROLE checks and 96-action default-deny policy");


test("broker refuses to issue an authority epoch or authorize actions while YARDHUB remains primary", async () => {
  const store = makeStore();
  store.readAuthority = async () => ({
    status: "ACTIVE",
    primarySystemId: "YARDHUB-PRIMARY",
    secondarySystemId: "DOWNTIMEUI-GITHUB",
    epoch: 4
  });
  const authority = createGitHubBrokerAuthority({ store, brokerRepositoryId: BROKER_REPOSITORY_ID });
  const principal = await authority.resolvePrincipal(USER_GITHUB_ID);
  await assert.rejects(authority.getAuthorityEpoch(), /not the active YARDHUB primary/);
  assert.equal(await authority.authorize({
    principal, service: "gatelog-api", action: "customer-arrival", args: {}, authorityEpoch: 4
  }), false);
});


test("immutable DEV cannot be rebound to another GitHub account or revoked through identity administration", async () => {
  const store = makeStore();
  const authority = createGitHubBrokerAuthority({
    store,
    brokerRepositoryId: BROKER_REPOSITORY_ID,
    bootstrapGitHubUserId: DEV_GITHUB_ID,
    bootstrapIssueId: 777
  });
  const dev = await authority.resolvePrincipal(DEV_GITHUB_ID);
  await assert.rejects(authority.linkIdentity({
    actorPrincipal: dev,
    githubUserId: "999999",
    userId: dev.userId,
    staffId: dev.staffId || "00000000-0000-4000-8000-000000000003",
    issueId: 888,
    reason: "Attempt to rebind immutable DEV"
  }), /immutable DEV identity cannot be rebound/);
  await assert.rejects(authority.revokeIdentity({
    actorPrincipal: dev,
    githubUserId: DEV_GITHUB_ID,
    reason: "Attempt to revoke immutable DEV"
  }), /immutable DEV identity cannot be revoked/);
});


test("broker default-denies binary operations and protected DOWNTIME write paths even for DEV", async () => {
  const store = makeStore();
  const authority = createGitHubBrokerAuthority({
    store,
    brokerRepositoryId: BROKER_REPOSITORY_ID,
    bootstrapGitHubUserId: DEV_GITHUB_ID,
    bootstrapIssueId: 777
  });
  const dev = await authority.resolvePrincipal(DEV_GITHUB_ID);
  for (const [service, action] of [
    ["central-bank", "identity-reset"],
    ["central-bank", "staff-original-upload"],
    ["central-bank", "staff-photo-url"],
    ["central-bank", "staff-photo-read"],
    ["photo-evidence", "create-upload"],
    ["photo-evidence", "view"],
    ["photo-evidence", "cleanup"],
    ["repair-maintenance-api", "upload"],
    ["repair-maintenance-api", "export-create"],
    ["repair-maintenance-api", "export-url"]
  ]) {
    assert.equal(await authority.authorize({ principal: dev, service, action, args: {}, authorityEpoch: 4 }), false, service + ":" + action);
  }
});
