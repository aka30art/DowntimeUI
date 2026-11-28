/**
 * Canonical ordinary YARD ROLE access resolver.
 * Each department receives exactly one of four hierarchical access levels.
 * ROOTS classifications are handled by a separate authorization layer.
 */
export const YARD_ROLE_PERMISSION_KEYS = Object.freeze(["view", "enter", "edit", "manage"]);
export const YARD_ROLE_ACCESS_LEVELS = Object.freeze(["OFF", "READ ONLY", "INPUT", "MANAGE"]);
export const YARD_ROLE_DEPARTMENTS = Object.freeze(["SCPL", "R&M", "Management", "SCFL", "Traffic"]);
/** Department-to-application mapping. A null value means no module is connected. */
export const YARD_ROLE_DEPARTMENT_MODULES = Object.freeze({
  SCPL: "DOWNTIME",
  "R&M": "R&M",
  Management: "Staff & Management",
  SCFL: null,
  Traffic: "GATELOG",
});

/** Project department permissions onto connected modules without crossing access domains. */
export function resolveYardRoleModulePermissions(resolvedRole) {
  if (!isObject(resolvedRole) || !isObject(resolvedRole.departments)) {
    throw new Error("A resolved canonical YARD ROLE is required to map module permissions.");
  }
  const modules = Object.create(null);
  for (const [department, module] of Object.entries(YARD_ROLE_DEPARTMENT_MODULES)) {
    if (!module) continue;
    const permissions = resolvedRole.departments[department];
    if (!isObject(permissions)) throw new Error("YARD ROLE module mapping is missing its " + department + " department permissions.");
    modules[module] = permissions;
  }
  return Object.freeze(modules);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function resolveAccessLevel(permissions) {
  const { view, enter, edit, manage } = permissions;
  if (!view && !enter && !edit && !manage) return "OFF";
  if (view && !enter && !edit && !manage) return "READ ONLY";
  if (view && enter && !edit && !manage) return "INPUT";
  if (view && enter && edit && manage) return "MANAGE";
  throw new Error("YARD ROLE department permissions must map to OFF, READ ONLY, INPUT or MANAGE.");
}

export function resolveYardRolePermissions(role, permissionRows = []) {
  if (!isObject(role) || !UUID_PATTERN.test(String(role.id || ""))) throw new Error("A canonical YARD ROLE with an immutable UUID is required.");
  if (String(role.status || "").toUpperCase() !== "ACTIVE") throw new Error("YARD ROLE is not active.");
  const roleName = String(role.name || "").trim();
  if (!roleName || roleName.length > 80) throw new Error("YARD ROLE name is invalid.");
  if (!Array.isArray(permissionRows)) throw new Error("YARD ROLE department permissions must be an array.");
  const departments = Object.create(null), seen = new Set();
  for (const row of permissionRows) {
    if (!isObject(row)) throw new Error("YARD ROLE department permission record is invalid.");
    if (String(row.yard_role_id || row.yardRoleId || "").toLowerCase() !== String(role.id).toLowerCase()) continue;
    const department = String(row.department || "").trim(), key = department.toLocaleLowerCase("en-GB");
    if (!YARD_ROLE_DEPARTMENTS.includes(department)) throw new Error("YARD ROLE department is not in the approved department catalogue.");
    if (seen.has(key)) throw new Error("A YARD ROLE can have only one permission record per department.");
    const permissions = {};
    for (const permission of YARD_ROLE_PERMISSION_KEYS) {
      const field = "can_" + permission;
      if (typeof row[field] !== "boolean") throw new Error("YARD ROLE " + permission + " permission must be an explicit boolean.");
      permissions[permission] = row[field];
    }
    permissions.level = resolveAccessLevel(permissions);
    seen.add(key); departments[department] = Object.freeze(permissions);
  }
  const missing = YARD_ROLE_DEPARTMENTS.filter((department) => !seen.has(department.toLocaleLowerCase("en-GB")));
  if (missing.length) throw new Error("YARD ROLE must define exactly one access-level record for each approved department: " + missing.join(", "));
  return Object.freeze({ yardRoleId: role.id, name: roleName, departments: Object.freeze({ ...departments }) });
}

/** Ordinary role permissions only; ROOTS authority must be evaluated separately. */
export function canYardRolePerform(resolvedRole, department, action) {
  if (!isObject(resolvedRole) || !isObject(resolvedRole.departments)) return false;
  const key = Object.keys(resolvedRole.departments).find((name) => name.toLocaleLowerCase("en-GB") === String(department || "").trim().toLocaleLowerCase("en-GB"));
  if (!key) return false;
  const p = resolvedRole.departments[key], a = String(action || "").toUpperCase();
  if (["VIEW", "READ"].includes(a)) return p.view === true;
  if (["ADD", "ENTER", "CREATE", "SUBMIT"].includes(a)) return p.enter === true;
  if (["EDIT", "UPDATE"].includes(a)) return p.edit === true;
  if (["REMOVE", "DELETE", "MANAGE"].includes(a)) return p.manage === true;
  return false;
}
