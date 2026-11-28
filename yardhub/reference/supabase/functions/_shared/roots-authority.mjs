/**
 * Protected ROOTS authority resolver.
 * DEV is recognised only by the immutable bootstrap USER ID.
 * DEV1 and ADMIN require an active matching USER/STAFF assignment.
 * Legacy tier labels are never ROOTS authority evidence.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = value => String(value ?? "").trim().toLowerCase();

/** @param {any} user @param {any} [assignment] @param {string|null} [immutableDevUserId] */
/**
 * @param {any} user
 * @param {any} [assignment]
 * @param {string|null} [immutableDevUserId]
 * @returns {string|null}
 */
export function resolveRootsAuthority(user, assignment = null, immutableDevUserId = null) {
  if (!user || typeof user !== "object" || user.enabled === false) return null;
  if (user.status && String(user.status).toUpperCase() !== "ACTIVE") return null;
  const userId = String(user.userId || "");
  if (!UUID.test(userId)) return null;

  // DEV is the singleton bootstrap USER; a STAFF identity is not required to preserve root access.
  if (UUID.test(String(immutableDevUserId || "")) && norm(userId) === norm(immutableDevUserId)) return "DEV";

  const staffId = String(user.staffId || "");
  if (!UUID.test(staffId) || norm(userId) === norm(staffId)) return null;
  if (!assignment || String(assignment.status || "ACTIVE").toUpperCase() !== "ACTIVE") return null;
  if (!["DEV1", "ADMIN"].includes(String(assignment.roots_class || ""))) return null;
  if (norm(assignment.user_id) !== norm(userId) || norm(assignment.staff_id) !== norm(staffId)) return null;
  return String(assignment.roots_class);
}

export function rootsCapabilities(authority) {
  return Object.freeze({
    canBrowseRoots: authority === "DEV",
    canAssignDev1: authority === "DEV",
    canAssignAdmin: authority === "DEV" || authority === "DEV1",
    canManageYardRoles: ["DEV", "DEV1", "ADMIN"].includes(authority),
    hasAutomaticDepartmentManage: ["DEV", "DEV1", "ADMIN"].includes(authority),
    canReclassifyRoots: authority === "DEV",
    canRevokeRoots: authority === "DEV",
  });
}

export function canInteractWithRootsTarget(actorAuthority, targetAuthority) {
  if (!["DEV", "DEV1", "ADMIN"].includes(actorAuthority)) return false;
  if (!targetAuthority) return true;
  if (targetAuthority === "DEV") return actorAuthority === "DEV";
  if (targetAuthority === "DEV1" && actorAuthority !== "DEV") return false;
  if (targetAuthority === "ADMIN" && actorAuthority === "ADMIN") return false;
  return true;
}

/**
 * YARD ROLE assignment is available to protected ROOTS actors for ordinary users.
 * Assigning a YARD ROLE to another protected ROOTS identity is DEV-only.
 * The immutable bootstrap DEV identity can never receive an ordinary YARD ROLE.
 */
export function canAssignYardRoleToTarget(actorAuthority, targetAuthority, isImmutableDevTarget = false) {
  if (isImmutableDevTarget) return false;
  if (!["DEV", "DEV1", "ADMIN"].includes(actorAuthority)) return false;
  if (targetAuthority && !["DEV1", "ADMIN"].includes(targetAuthority)) return false;
  return !targetAuthority || actorAuthority === "DEV";
}
