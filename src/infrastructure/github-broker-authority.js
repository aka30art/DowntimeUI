import { resolveYardRolePermissions } from "../../yardhub/reference/supabase/functions/_shared/yard-role-resolver.mjs";
import { createGitHubCentralServiceSession } from "./github-central-service-session.js";
import { createGitHubBrokerIdentityManager } from "./github-broker-identity-admin.js";

const IDENTITY_TABLE = "downtime_github_identities";
const GITHUB_ID_PATTERN = /^[0-9]{1,20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DENY = Object.freeze({ deny: true });
const SELF = Object.freeze({ self: true });
const view = department => Object.freeze({ department, capability: "view" });
const enter = department => Object.freeze({ department, capability: "enter" });
const edit = department => Object.freeze({ department, capability: "edit" });
const manage = department => Object.freeze({ department, capability: "manage" });
const root = (...classes) => Object.freeze({ roots: classes });
const dev = Object.freeze({ roots: ["DEV"] });

const SERVICE_ACTION_POLICIES = Object.freeze({
  "central-bank": Object.freeze({
    bootstrap: DENY, login: DENY, logout: DENY, "list-users": DENY,
    "get-state": view("SCPL"), "save-state": edit("SCPL"),
    "save-settings": manage("SCPL"), "set-plant-status": manage("SCPL"),
    "daily-operator-list": view("SCPL"), "daily-operator-assign": manage("SCPL"),
    "daily-operator-unlock": manage("SCPL"), "photo-evidence-context": view("SCPL"),
    "central-admin-state": dev, "central-config-state": dev,
    "central-config-save-draft": dev, "central-config-publish": dev,
    "central-config-restore-draft": dev, "identity-diagnostics": root("DEV", "DEV1", "ADMIN"),
    "identity-reset": dev, "user-staff-provision": root("DEV", "DEV1", "ADMIN"),
    "user-staff-activate": root("DEV", "DEV1", "ADMIN"),
    users: view("Management"), "user-save": manage("Management"),
    "user-delete": manage("Management"), "staff-save": manage("Management"),
    "tiers-save": manage("Management"), "staff-original-upload": manage("Management"),
    "staff-photo-url": manage("Management"), "staff-photo-read": view("Management"),
    "staff-photo-remove": manage("Management")
  }),
  "central-config-admin": Object.freeze({
    "central-config-audit": dev, "central-config-impact": dev,
    "central-config-publish": dev, "central-config-restore-draft": dev,
    "central-config-save-draft": dev, "central-config-state": dev,
    "central-config-validate": dev, "yard-hub-menu": dev
  }),
  "gatelog-api": Object.freeze({
    bootstrap: view("Traffic"), history: view("Traffic"), "day-register": view("Traffic"),
    arrival: enter("Traffic"), "customer-arrival": enter("Traffic"),
    "customer-save": enter("Traffic"), "vehicle-save": enter("Traffic"),
    departure: enter("Traffic"), "customer-update": edit("Traffic"),
    "visit-update": edit("Traffic"), "visit-delete": manage("Traffic"),
    "customer-archive": manage("Traffic"), "waste-type-create": manage("Traffic"),
    "waste-type-update": manage("Traffic"), "gateman-save": manage("Traffic"),
    "gateman-lock": manage("Traffic"), report: view("Traffic"),
    "report-save": enter("Traffic"), "report-archive": manage("Traffic")
  }),
  "photo-evidence": Object.freeze({
    "create-upload": enter("SCPL"), view: view("SCPL"),
    delete: manage("SCPL"), cleanup: dev
  }),
  "repair-maintenance-api": Object.freeze({
    access: view("R&M"), "asset-list": view("R&M"), "asset-add": enter("R&M"),
    "asset-update": edit("R&M"), "asset-delete": manage("R&M"),
    "asset-archive": manage("R&M"), "model-list": view("R&M"),
    "model-add": enter("R&M"), "model-delete": manage("R&M"),
    "preset-list": view("R&M"), "preset-add": manage("R&M"),
    "preset-delete": manage("R&M"), "settings-get": view("R&M"),
    "settings-update": manage("R&M"), list: view("R&M"), get: view("R&M"),
    create: enter("R&M"), update: edit("R&M"), delete: manage("R&M"),
    "note-add": enter("R&M"), upload: enter("R&M"),
    "export-create": enter("R&M"), "export-list": view("R&M"),
    "export-url": view("R&M"), "export-delete": manage("R&M")
  }),
  "spectator-read": Object.freeze({
    "spectator-snapshot-read": view("SCPL")
  }),
  "yard-hub-settings-api": Object.freeze({
    "my-access": SELF, "settings-state": root("DEV", "DEV1", "ADMIN"),
    "roots-state": root("DEV", "DEV1", "ADMIN"), "roots-manage": dev,
    "yard-role-save": root("DEV", "DEV1", "ADMIN"),
    "assign-user-role": root("DEV", "DEV1", "ADMIN"),
    "save-tier-settings": root("DEV", "DEV1", "ADMIN"),
    "save-user-tier": root("DEV", "DEV1", "ADMIN"),
    "remove-user-tier": root("DEV", "DEV1", "ADMIN")
  })
});

function requiredString(value, label, pattern = null) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 256 || (pattern && !pattern.test(result))) {
    throw new TypeError(label + " is invalid.");
  }
  return result;
}

function activeUser(user) {
  return Boolean(user && user.enabled === true &&
    (!user.status || String(user.status).toUpperCase() === "ACTIVE") &&
    typeof user.username === "string" && user.username.trim() &&
    typeof user.userId === "string" && UUID_PATTERN.test(user.userId));
}

function getBank(tables) {
  const row = (tables.downtime_central_bank || []).find(item => Number(item.id) === 1);
  return row?.payload && typeof row.payload === "object" ? row.payload : null;
}

function findStaffProfile(bank, user) {
  const profiles = bank?.staff?.profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) return null;
  return Object.values(profiles).find(profile =>
    profile && profile.staffId === user.staffId && profile.linkedUserId === user.userId
  ) || null;
}

function resolveRootsClass(tables, userId) {
  const bootstrap = (tables.downtime_roots_bootstrap || []).find(row => row.singleton === true);
  if (bootstrap?.user_id === userId) return "DEV";
  const assignment = (tables.downtime_roots_assignments || []).find(row =>
    row.user_id === userId && String(row.status || "ACTIVE").toUpperCase() === "ACTIVE"
  );
  return assignment?.roots_class || null;
}

function resolveRole(tables, userId) {
  const assignment = (tables.yard_role_assignments || []).find(row =>
    row.user_id === userId && String(row.status || "").toUpperCase() === "ACTIVE"
  );
  if (!assignment) return null;
  const role = (tables.yard_roles || []).find(row =>
    row.id === assignment.yard_role_id && String(row.status || "").toUpperCase() === "ACTIVE"
  );
  if (!role) return null;
  const permissions = tables.yard_role_department_permissions || [];
  try {
    return resolveYardRolePermissions(role, permissions);
  } catch {
    return null;
  }
}

function hasCapability(principal, department, capability) {
  const row = principal.departments?.[department];
  return row?.[capability] === true;
}

/**
 * Creates the trusted broker identity and permission adapter. It fails closed
 * for unmapped GitHub IDs, inactive USER/STAFF identities, missing ROOTS/ROLE
 * data, unknown service actions and unassigned inbox issue IDs.
 *
 * GitHub identity links are held in a versioned private-repository snapshot,
 * separate from the 39 source tables. Only immutable DEV may change the links.
 */
export function createGitHubBrokerAuthority({
  store,
  brokerRepositoryId,
  brokerIssueId = null,
  bootstrapGitHubUserId = null,
  bootstrapIssueId = null,
  now = () => new Date()
} = {}) {
  if (!store || typeof store.readDatabase !== "function" ||
      typeof store.transactDatabase !== "function") {
    throw new TypeError("A private GitHub data store with transactional table support is required.");
  }
  const repositoryId = Number(brokerRepositoryId);
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 1) throw new TypeError("Broker repository ID is invalid.");
  const defaultIssueId = brokerIssueId == null ? null : Number(brokerIssueId);
  if (defaultIssueId !== null && (!Number.isSafeInteger(defaultIssueId) || defaultIssueId < 1)) {
    throw new TypeError("Broker inbox issue ID is invalid.");
  }
  const bootstrapExternalId = bootstrapGitHubUserId == null
    ? null
    : requiredString(bootstrapGitHubUserId, "Bootstrap GitHub user ID", GITHUB_ID_PATTERN);
  const bootstrapTicketId = bootstrapIssueId == null ? defaultIssueId : Number(bootstrapIssueId);
  if (bootstrapExternalId && (!Number.isSafeInteger(bootstrapTicketId) || bootstrapTicketId < 1)) {
    throw new TypeError("Immutable DEV bootstrap requires a dedicated broker issue ID.");
  }

  async function readLinks(database = null) {
    const source = database || await store.readDatabase();
    const rows = source.tables?.[IDENTITY_TABLE] || [];
    if (!Array.isArray(rows)) throw new Error("Private GitHub identity table is malformed.");
    return rows.map(row => ({
      githubUserId: String(row.github_user_id || ""),
      userId: String(row.user_id || ""),
      staffId: String(row.staff_id || ""),
      brokerIssueId: Number(row.broker_issue_id),
      brokerRepositoryId: repositoryId,
      status: String(row.status || "").toUpperCase(),
      linkedAt: row.linked_at || null,
      linkedByUserId: row.linked_by_user_id || null,
      revokedAt: row.revoked_at || null,
      revokedByUserId: row.revoked_by_user_id || null
    }));
  }

  async function resolvePrincipal(githubUserId) {
    const externalId = requiredString(githubUserId, "GitHub numeric user ID", GITHUB_ID_PATTERN);
    const database = await store.readDatabase();
    const bank = getBank(database.tables);
    const users = Array.isArray(bank?.users) ? bank.users : [];

    // First trusted account is pinned out-of-band to the immutable DEV root.
    // This breaks the first-enrolment circular dependency without creating a
    // self-assignable public bootstrap path.
    if (bootstrapExternalId && externalId === bootstrapExternalId) {
      const rootRow = (database.tables.downtime_roots_bootstrap || []).find(row => row.singleton === true);
      const rootUser = users.find(row => row?.userId === rootRow?.user_id);
      if (activeUser(rootUser) && String(rootUser.username).toUpperCase() === "DEV" &&
          resolveRootsClass(database.tables, rootUser.userId) === "DEV") {
        return Object.freeze({
          githubUserId: externalId,
          userId: rootUser.userId,
          staffId: null,
          username: rootUser.username,
          displayName: rootUser.displayName || rootUser.username,
          enabled: true,
          status: "ACTIVE",
          tier: rootUser.tier || null,
          rootsClass: "DEV",
          staffProfile: null,
          yardRoleId: null,
          yardRoleName: null,
          departments: Object.freeze({}),
          brokerRepositoryId: repositoryId,
          brokerIssueId: bootstrapTicketId,
          bootstrapRoot: true
        });
      }
      return null;
    }

    const links = (await readLinks(database)).filter(link =>
      link.githubUserId === externalId && link.status === "ACTIVE"
    );
    if (links.length !== 1) return null;
    const link = links[0];
    if (link.brokerRepositoryId !== repositoryId ||
        !Number.isSafeInteger(Number(link.brokerIssueId || defaultIssueId))) return null;

    const user = users.find(row => row?.userId === link.userId);
    if (!activeUser(user)) return null;
    const rootsClass = resolveRootsClass(database.tables, user.userId);
    const staffProfile = user.staffId ? findStaffProfile(bank, user) : null;
    if (user.staffId) {
      if (!UUID_PATTERN.test(String(user.staffId)) || !staffProfile) return null;
    } else if (rootsClass !== "DEV") {
      return null;
    }
    const role = resolveRole(database.tables, user.userId);
    if (!role && !rootsClass) return null;

    return Object.freeze({
      githubUserId: externalId,
      userId: user.userId,
      staffId: user.staffId || null,
      username: user.username,
      displayName: user.displayName || user.username,
      enabled: user.enabled === true,
      status: "ACTIVE",
      tier: user.tier || null,
      rootsClass,
      staffProfile,
      yardRoleId: role?.yardRoleId || null,
      yardRoleName: role?.name || null,
      departments: role?.departments || Object.freeze({}),
      brokerRepositoryId: repositoryId,
      brokerIssueId: Number(link.brokerIssueId || defaultIssueId)
    });
  }

  async function authorizeInboxIssue({ principal, issueId, repositoryId: requestedRepositoryId }) {
    if (!principal?.githubUserId || requestedRepositoryId !== repositoryId ||
        !Number.isSafeInteger(Number(issueId))) return false;
    if (principal.bootstrapRoot === true) {
      return principal.rootsClass === "DEV" && Number(issueId) === bootstrapTicketId;
    }
    const matching = (await readLinks()).filter(link =>
      link.githubUserId === principal.githubUserId &&
      link.userId === principal.userId &&
      link.status === "ACTIVE" &&
      link.brokerRepositoryId === repositoryId &&
      Number(link.brokerIssueId) === Number(issueId)
    );
    return matching.length === 1;
  }

  async function authorize({ principal, service, action, args, authorityEpoch }) {
    if (!principal?.userId || !Number.isSafeInteger(authorityEpoch) || authorityEpoch < 1) return false;
    const currentAuthority = await store.readAuthority();
    if (!currentAuthority || currentAuthority.status !== "ACTIVE" ||
        currentAuthority.primarySystemId !== "DOWNTIMEUI-GITHUB" ||
        currentAuthority.epoch !== authorityEpoch) return false;
    const policy = SERVICE_ACTION_POLICIES[service]?.[action];
    if (!policy || policy.deny) return false;
    if (policy.self) return true;
    if (policy.roots) return policy.roots.includes(principal.rootsClass);
    return hasCapability(principal, policy.department, policy.capability);
  }

  async function createServiceSession({ principal, requestId }) {
    return createGitHubCentralServiceSession({ store, principal, requestId, now });
  }

  async function getAuthorityEpoch() {
    const authority = await store.readAuthority();
    if (!authority || authority.status !== "ACTIVE" ||
        authority.primarySystemId !== "DOWNTIMEUI-GITHUB" ||
        !Number.isSafeInteger(authority.epoch) || authority.epoch < 1) {
      throw new Error("GitHub twin is not the active YARDHUB primary; broker actions are disabled until an approved authority transfer.");
    }
    return authority.epoch;
  }

  const identityManager = createGitHubBrokerIdentityManager({
    store,
    now,
    verifyDevAuthority: async actorContext => {
      const caller = await resolvePrincipal(actorContext?.githubUserId);
      if (!caller || caller.rootsClass !== "DEV") return null;
      return { userId: caller.userId, isImmutableDev: true };
    }
  });

  async function linkIdentity({ actorPrincipal, githubUserId, userId, staffId, issueId, reason } = {}) {
    if (!actorPrincipal?.githubUserId || actorPrincipal.rootsClass !== "DEV") {
      throw new Error("Only the authenticated immutable DEV broker principal may link GitHub identities.");
    }
    return identityManager.link({
      actorContext: { githubUserId: actorPrincipal.githubUserId },
      githubUserId,
      userId,
      staffId,
      brokerIssueId: issueId,
      reason
    });
  }

  async function revokeIdentity({ actorPrincipal, githubUserId, reason } = {}) {
    if (!actorPrincipal?.githubUserId || actorPrincipal.rootsClass !== "DEV") {
      throw new Error("Only the authenticated immutable DEV broker principal may revoke GitHub identities.");
    }
    return identityManager.revoke({
      actorContext: { githubUserId: actorPrincipal.githubUserId },
      githubUserId,
      reason
    });
  }

  return Object.freeze({
    resolvePrincipal,
    authorizeInboxIssue,
    authorize,
    createServiceSession,
    getAuthorityEpoch,
    linkIdentity,
    revokeIdentity,
    readLinks
  });
}

export { SERVICE_ACTION_POLICIES, IDENTITY_TABLE };
