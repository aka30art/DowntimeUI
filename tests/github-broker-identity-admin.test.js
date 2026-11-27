import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubBrokerIdentityManager } from "../src/infrastructure/github-broker-identity-admin.js";
import { resolveGitHubBrokerPrincipal } from "../src/infrastructure/github-actions-broker-store.js";

function makeStore() {
  let revision = 0;
  let counter = 0;
  const tables = {
    downtime_central_bank: [{ id: 1, payload: { users: [{
      userId: "user-01", staffId: "staff-01", username: "operator", tier: "USER", enabled: true
    }] } }],
    downtime_github_identities: [],
    downtime_github_broker_identity_audit: []
  };
  return {
    async readDatabase() { return { revision, tables: structuredClone(tables) }; },
    async readTable(name) { return structuredClone(tables[name] || []); },
    async transactDatabase({ expectedRevision, mutate }) {
      if (expectedRevision !== revision) { const error = new Error("revision conflict"); error.status = 409; throw error; }
      const draft = structuredClone(tables);
      const result = await mutate(draft);
      for (const [name, rows] of Object.entries(draft)) tables[name] = rows;
      revision += 1;
      return { committed: true, revision, result };
    },
    get tables() { return structuredClone(tables); },
    cryptoProvider: { randomUUID: () => "00000000-0000-4000-8000-" + String(++counter).padStart(12, "0") }
  };
}

test("only immutable DEV can link a GitHub actor to an active canonical USER and dedicated inbox issue", async () => {
  const store = makeStore();
  const manager = createGitHubBrokerIdentityManager({
    store,
    cryptoProvider: store.cryptoProvider,
    now: () => new Date("2026-11-27T12:00:00.000Z"),
    verifyDevAuthority: async context => context?.session === "dev-session"
      ? { userId: "immutable-dev", isImmutableDev: true }
      : { userId: "admin-user", isImmutableDev: false }
  });
  const linked = await manager.link({
    actorContext: { session: "dev-session" },
    githubUserId: "987654",
    userId: "user-01",
    staffId: "staff-01",
    brokerIssueId: 333,
    reason: "Initial secure broker enrolment"
  });
  assert.equal(linked.status, "ACTIVE");
  assert.equal(linked.linked_by_user_id, "immutable-dev");
  assert.equal(store.tables.downtime_github_broker_identity_audit.length, 1);
  assert.equal(await resolveGitHubBrokerPrincipal({ store, githubUserId: "987654" }).then(Boolean), true);
  await assert.rejects(manager.link({
    actorContext: { session: "admin-session" }, githubUserId: "111",
    userId: "user-01", staffId: "staff-01", brokerIssueId: 334, reason: "Not DEV"
  }), /immutable DEV/);
});

test("identity mapping enforces one-to-one USER/GitHub/inbox binding and revocation is audited", async () => {
  const store = makeStore();
  const manager = createGitHubBrokerIdentityManager({
    store, cryptoProvider: store.cryptoProvider,
    now: () => new Date("2026-11-27T12:00:00.000Z"),
    verifyDevAuthority: async () => ({ userId: "immutable-dev", isImmutableDev: true })
  });
  await manager.link({
    actorContext: {}, githubUserId: "987654", userId: "user-01",
    staffId: "staff-01", brokerIssueId: 333, reason: "Link"
  });
  await assert.rejects(manager.link({
    actorContext: {}, githubUserId: "123456", userId: "user-01",
    staffId: "staff-01", brokerIssueId: 444, reason: "Duplicate USER"
  }), /already linked/);
  const revoked = await manager.revoke({
    actorContext: {}, githubUserId: "987654", reason: "Staff account deactivated"
  });
  assert.equal(revoked.status, "REVOKED");
  assert.equal(revoked.revoked_by_user_id, "immutable-dev");
  assert.equal(store.tables.downtime_github_broker_identity_audit.length, 2);
  assert.equal(store.tables.downtime_github_broker_identity_audit[1].event_type, "REVOKED");
  assert.equal(await resolveGitHubBrokerPrincipal({ store, githubUserId: "987654" }), null);
});
