/**
 * DOWNTIME USER / STAFF identity contract helpers.
 *
 * USER / STAFF identity and staged provisioning contracts.
 * - preserves legacy records without inventing identifiers;
 * - validates immutable UUID references and reciprocal links;
 * - reports migration diagnostics without writing data;
 * - builds pending USER/STAFF payloads that remain inactive until a trusted
 *   canonical YARD ROLE assignment is independently verified.
 *
 * This module is deliberately not wired to a provisioning API until the
 * canonical YARD ROLE catalogue and assignment store are implemented.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const normaliseUsername = (value) => String(value ?? "").trim().toLocaleLowerCase("en-GB");
const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);

function addDiagnostic(diagnostics, severity, code, path, message) {
  diagnostics.push({ severity, code, path, message });
}

/**
 * Returns a non-mutating, backwards-compatible view of the identity collections.
 * Missing IDs remain missing; this function never generates IDs or creates STAFF.
 */
export function normaliseIdentityDirectory(bank) {
  const source = isObject(bank) ? bank : {};
  const users = Array.isArray(source.users)
    ? source.users.filter(isObject).map((user) => ({ ...user }))
    : [];
  const staff = isObject(source.staff) ? source.staff : {};
  const profiles = isObject(staff.profiles) ? staff.profiles : {};
  const staffProfiles = Object.entries(profiles)
    .filter(([, profile]) => isObject(profile))
    .map(([legacyKey, profile]) => ({ legacyKey, ...profile }));

  return {
    users,
    staffProfiles,
    staffRoster: Array.isArray(staff.roster) ? [...staff.roster] : [],
  };
}

/**
 * Read-only diagnostics for legacy and partially migrated identity data.
 * Legacy records without IDs are warnings, not silently repaired records.
 */
export function diagnoseIdentityDirectory(bank) {
  const { users, staffProfiles } = normaliseIdentityDirectory(bank);
  const diagnostics = [];
  const source = isObject(bank) ? bank : {};
  if (source.users != null && !Array.isArray(source.users)) {
    addDiagnostic(diagnostics, "error", "user-collection-invalid", "users", "USER collection must be an array.");
  }
  if (Array.isArray(source.users)) {
    source.users.forEach((user, index) => {
      if (!isObject(user)) addDiagnostic(diagnostics, "error", "user-record-invalid", `users[${index}]`, "USER record must be an object.");
    });
  }
  if (source.staff != null && !isObject(source.staff)) {
    addDiagnostic(diagnostics, "error", "staff-collection-invalid", "staff", "STAFF collection must be an object.");
  }
  const rawProfiles = isObject(source.staff) ? source.staff.profiles : undefined;
  if (rawProfiles != null && !isObject(rawProfiles)) {
    addDiagnostic(diagnostics, "error", "staff-profiles-invalid", "staff.profiles", "STAFF profiles must be an object keyed by the legacy profile key.");
  }
  if (isObject(rawProfiles)) {
    const profileKeys = new Map();
    for (const [key, profile] of Object.entries(rawProfiles)) {
      if (!isObject(profile)) {
        addDiagnostic(diagnostics, "error", "staff-profile-invalid", `staff.profiles[${JSON.stringify(key)}]`, "STAFF profile must be an object.");
        continue;
      }
      const normalisedKey = normaliseUsername(key);
      if (profileKeys.has(normalisedKey)) addDiagnostic(diagnostics, "error", "duplicate-staff-profile-key", `staff.profiles[${JSON.stringify(key)}]`, `Profile key duplicates ${profileKeys.get(normalisedKey)} case-insensitively.`);
      else profileKeys.set(normalisedKey, key);
    }
  }
  const rawRoster = isObject(source.staff) ? source.staff.roster : undefined;
  if (rawRoster != null && !Array.isArray(rawRoster)) {
    addDiagnostic(diagnostics, "error", "staff-roster-invalid", "staff.roster", "STAFF roster must be an array.");
  }
  const rosterSeen = new Map();
  if (Array.isArray(rawRoster)) {
    const profileKeySet = new Set(Object.keys(isObject(rawProfiles) ? rawProfiles : {}).map(normaliseUsername));
    rawRoster.forEach((entry, index) => {
      if (typeof entry !== "string" || !entry.trim()) {
        addDiagnostic(diagnostics, "error", "staff-roster-entry-invalid", `staff.roster[${index}]`, "STAFF roster entries must be non-empty names.");
        return;
      }
      const key = normaliseUsername(entry);
      if (rosterSeen.has(key)) addDiagnostic(diagnostics, "error", "duplicate-staff-roster-entry", `staff.roster[${index}]`, `Roster entry duplicates ${rosterSeen.get(key)} case-insensitively.`);
      else rosterSeen.set(key, entry);
      if (!profileKeySet.has(key)) addDiagnostic(diagnostics, "warning", "staff-roster-profile-missing", `staff.roster[${index}]`, "Roster entry has no matching canonical STAFF profile; compatibility copies must be reviewed.");
    });
  }
  const appData = isObject(source.appData) ? source.appData : {};
  if (Array.isArray(appData.staffRoster) && Array.isArray(rawRoster)) {
    const canonicalNames = new Set(rawRoster.filter((name) => typeof name === "string").map(normaliseUsername));
    const compatibilityNames = new Set(appData.staffRoster.filter((name) => typeof name === "string").map(normaliseUsername));
    if (canonicalNames.size !== compatibilityNames.size || [...canonicalNames].some((name) => !compatibilityNames.has(name))) {
      addDiagnostic(diagnostics, "warning", "staff-roster-compatibility-mismatch", "appData.staffRoster", "STAFF roster compatibility copy differs from staff.roster.");
    }
  }
  if (appData.staffRoster != null && !Array.isArray(appData.staffRoster)) {
    addDiagnostic(diagnostics, "error", "staff-roster-compatibility-invalid", "appData.staffRoster", "STAFF roster compatibility copy must be an array.");
  }
  if (appData.operatorProfiles != null && !isObject(appData.operatorProfiles)) {
    addDiagnostic(diagnostics, "error", "staff-profile-compatibility-invalid", "appData.operatorProfiles", "STAFF profile compatibility copy must be an object.");
  }
  if (isObject(appData.operatorProfiles) && isObject(rawProfiles)) {
    const canonicalNames = new Set(Object.keys(rawProfiles).map(normaliseUsername));
    const compatibilityNames = new Set(Object.keys(appData.operatorProfiles).map(normaliseUsername));
    if (canonicalNames.size !== compatibilityNames.size || [...canonicalNames].some((name) => !compatibilityNames.has(name))) {
      addDiagnostic(diagnostics, "warning", "staff-profile-compatibility-mismatch", "appData.operatorProfiles", "STAFF profile compatibility copy differs from staff.profiles.");
    }
  }
  const userIds = new Map();
  const staffIds = new Map();
  const linkedUsers = new Map();
  const usernames = new Map();

  users.forEach((user, index) => {
    const path = `users[${index}]`;
    const username = normaliseUsername(user.username);

    if (!username) {
      addDiagnostic(diagnostics, "error", "user-username-missing", path, "USER has no usable username.");
    } else if (usernames.has(username)) {
      addDiagnostic(diagnostics, "error", "duplicate-username", path, `Username duplicates ${usernames.get(username)} case-insensitively.`);
    } else {
      usernames.set(username, path);
    }

    if (user.userId == null || user.userId === "") {
      addDiagnostic(diagnostics, "warning", "legacy-user-id-missing", path, "Legacy USER has no immutable userId; no identifier was generated.");
    } else if (!isUuid(user.userId)) {
      addDiagnostic(diagnostics, "error", "user-id-invalid", path, "USER userId must be a UUID.");
    } else if (userIds.has(user.userId.toLowerCase())) {
      addDiagnostic(diagnostics, "error", "duplicate-user-id", path, `userId duplicates ${userIds.get(user.userId.toLowerCase())}.`);
    } else {
      userIds.set(user.userId.toLowerCase(), path);
    }

    if (normaliseUsername(user.username) === "dev") {
      if (user.staffId) addDiagnostic(diagnostics, "error", "dev-staff-link-forbidden", path, "The immutable DEV root identity must not be linked to a STAFF profile.");
    } else if (!user.staffId) {
      addDiagnostic(diagnostics, "warning", "legacy-user-staff-link-missing", path, "USER has no linked STAFF identity; this is not repaired during diagnostics.");
    } else if (!isUuid(user.staffId)) {
      addDiagnostic(diagnostics, "error", "user-staff-id-invalid", path, "USER staffId must be a UUID.");
    }
  });

  staffProfiles.forEach((profile, index) => {
    const path = `staff.profiles[${JSON.stringify(profile.legacyKey)}]`;

    if (profile.staffId == null || profile.staffId === "") {
      addDiagnostic(diagnostics, "warning", "legacy-staff-id-missing", path, "Legacy STAFF profile has no immutable staffId; no identifier was generated.");
    } else if (!isUuid(profile.staffId)) {
      addDiagnostic(diagnostics, "error", "staff-id-invalid", path, "STAFF staffId must be a UUID.");
    } else if (staffIds.has(profile.staffId.toLowerCase())) {
      addDiagnostic(diagnostics, "error", "duplicate-staff-id", path, `staffId duplicates ${staffIds.get(profile.staffId.toLowerCase())}.`);
    } else {
      staffIds.set(profile.staffId.toLowerCase(), path);
    }

    if (profile.linkedUserId) {
      if (!isUuid(profile.linkedUserId)) {
        addDiagnostic(diagnostics, "error", "staff-linked-user-id-invalid", path, "STAFF linkedUserId must be a UUID.");
      } else {
        const key = profile.linkedUserId.toLowerCase();
        if (linkedUsers.has(key)) {
          addDiagnostic(diagnostics, "error", "user-has-multiple-staff", path, `linkedUserId is already used by ${linkedUsers.get(key)}.`);
        } else {
          linkedUsers.set(key, path);
        }
      }
    }
  });

  // Name similarity is a diagnostic only. It never creates or repairs an identity link.
  users.forEach((user, index) => {
    if (normaliseUsername(user.username) === "dev" || user.staffId) return;
    const userNames = new Set([normaliseUsername(user.username), normaliseUsername(user.displayName)].filter(Boolean));
    const candidates = staffProfiles.filter((profile) => {
      const profileNames = [normaliseUsername(profile.legacyKey), normaliseUsername(profile.displayName)].filter(Boolean);
      return profileNames.some((name) => userNames.has(name));
    });
    if (candidates.length > 1) {
      addDiagnostic(diagnostics, "error", "ambiguous-legacy-name-match", `users[${index}]`, "Multiple STAFF profiles resemble this USER by name; no link may be inferred.");
    } else if (candidates.length === 1) {
      addDiagnostic(diagnostics, "warning", "legacy-name-match-unverified", `users[${index}]`, "A STAFF profile resembles this USER by name, but names are not identity links.");
    }
  });

  const staffById = new Map(
    staffProfiles.filter((profile) => isUuid(profile.staffId))
      .map((profile) => [profile.staffId.toLowerCase(), profile]),
  );
  const usersById = new Map(
    users.filter((user) => isUuid(user.userId))
      .map((user) => [user.userId.toLowerCase(), user]),
  );

  users.forEach((user, index) => {
    if (!user.staffId || !isUuid(user.staffId) || normaliseUsername(user.username) === "dev") return;
    const staff = staffById.get(user.staffId.toLowerCase());
    if (!staff) {
      addDiagnostic(diagnostics, "error", "orphan-user-staff-link", `users[${index}]`, "USER references a STAFF staffId that does not exist.");
    } else if (staff.linkedUserId?.toLowerCase() !== user.userId?.toLowerCase()) {
      addDiagnostic(diagnostics, "error", "identity-link-not-reciprocal", `users[${index}]`, "USER.staffId and STAFF.linkedUserId do not form a reciprocal link.");
    }
  });

  staffProfiles.forEach((profile, index) => {
    if (!profile.linkedUserId || !isUuid(profile.linkedUserId)) return;
    const user = usersById.get(profile.linkedUserId.toLowerCase());
    if (!user) {
      addDiagnostic(diagnostics, "error", "orphan-staff-user-link", `staff.profiles[${JSON.stringify(profile.legacyKey)}]`, "STAFF references a USER userId that does not exist.");
    } else if (user.staffId?.toLowerCase() !== profile.staffId?.toLowerCase()) {
      addDiagnostic(diagnostics, "error", "identity-link-not-reciprocal", `staff.profiles[${JSON.stringify(profile.legacyKey)}]`, "STAFF.linkedUserId and USER.staffId do not form a reciprocal link.");
    }
  });

  return diagnostics;
}

/**
 * Produces a dry-run summary only. It has no persistence or mutation capability.
 */
export function buildIdentityMigrationPreview(bank) {
  const { users, staffProfiles, staffRoster } = normaliseIdentityDirectory(bank);
  const diagnostics = diagnoseIdentityDirectory(bank);
  const rawUsersCount = Array.isArray(bank?.users) ? bank.users.length : 0;
  const rawStaffProfilesCount = isObject(bank?.staff?.profiles) ? Object.keys(bank.staff.profiles).length : 0;
  const invalidUserRecordCount = Math.max(0, rawUsersCount - users.length);
  const invalidStaffProfileCount = Math.max(0, rawStaffProfilesCount - staffProfiles.length);
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  const onlyDevRemains = users.length === 1 && normaliseUsername(users[0]?.username) === "dev";
  const appData = isObject(bank?.appData) ? bank.appData : {};
  const compatibilityStaffRosterCount = Array.isArray(appData.staffRoster) ? appData.staffRoster.length : 0;
  const compatibilityOperatorProfileCount = isObject(appData.operatorProfiles) ? Object.keys(appData.operatorProfiles).length : 0;
  const noStaffRemains = staffProfiles.length === 0 && staffRoster.length === 0;
  const noCompatibilityStaffCopies = compatibilityStaffRosterCount === 0 && compatibilityOperatorProfileCount === 0;
  const devIdentityIsStable = onlyDevRemains && isUuid(users[0]?.userId) && !users[0]?.staffId;
  const cutoverTargetChecks = {
    onlyDevRemains,
    noStaffRemains,
    noCompatibilityStaffCopies,
    devIdentityIsStable,
    noDiagnostics: diagnostics.length === 0,
  };

  return {
    mode: "read-only",
    writesPerformed: 0,
    users: {
      total: rawUsersCount,
      validRecordCount: users.length,
      invalidRecordCount: invalidUserRecordCount,
      withUserId: users.filter((user) => isUuid(user.userId)).length,
      withStaffLink: users.filter((user) => Boolean(user.staffId)).length,
      devRootCount: users.filter((user) => normaliseUsername(user.username) === "dev").length,
    },
    staff: {
      profileCount: rawStaffProfilesCount,
      validProfileCount: staffProfiles.length,
      invalidProfileCount: invalidStaffProfileCount,
      rosterEntryCount: staffRoster.length,
      withStaffId: staffProfiles.filter((profile) => isUuid(profile.staffId)).length,
      linkedToUser: staffProfiles.filter((profile) => Boolean(profile.linkedUserId)).length,
      compatibilityRosterEntryCount: compatibilityStaffRosterCount,
      compatibilityProfileCount: compatibilityOperatorProfileCount,
    },
    diagnostics: { total: diagnostics.length, errors, warnings },
    cutoverTargetChecks,
    readyForIdentityCutover: errors === 0 && warnings === 0 && onlyDevRemains && noStaffRemains && noCompatibilityStaffCopies && devIdentityIsStable,
    findings: diagnostics,
  };
}

/**
 * Validates a newly provisioned ordinary USER/STAFF pair before persistence.
 * DEV is deliberately excluded because the root USER is not a STAFF member.
 */
export function validateNewUserStaffPair(user, staff, existingUsers = [], existingStaffProfiles = []) {
  if (!isObject(user) || !isObject(staff)) throw new TypeError("USER and STAFF records are required.");
  if ("rootsClass" in user || "rootClass" in user || "rootsClass" in staff || "rootClass" in staff) {
    throw new Error("Protected ROOTS classification cannot be supplied through ordinary USER/STAFF provisioning.");
  }
  if (user.tier != null) throw new Error("Legacy tier claims cannot be supplied through ordinary USER provisioning.");
  if (normaliseUsername(user.username) === "dev") throw new Error("DEV is the immutable root identity and cannot be linked to STAFF.");
  if (!isUuid(user.userId)) throw new Error("USER userId must be a valid immutable UUID.");
  if (!isUuid(user.staffId)) throw new Error("USER staffId must be a valid immutable UUID.");
  if (!isUuid(staff.staffId)) throw new Error("STAFF staffId must be a valid immutable UUID.");
  if (!isUuid(staff.linkedUserId)) throw new Error("STAFF linkedUserId must be a valid immutable UUID.");
  if (user.staffId.toLowerCase() !== staff.staffId.toLowerCase()) throw new Error("USER.staffId must match STAFF.staffId.");
  if (staff.linkedUserId.toLowerCase() !== user.userId.toLowerCase()) throw new Error("STAFF.linkedUserId must match USER.userId.");
  if (!normaliseUsername(user.username)) throw new Error("USER username is required.");

  const username = normaliseUsername(user.username);
  if (existingUsers.some((item) => normaliseUsername(item?.username) === username)) throw new Error("USER username already exists.");
  if (existingUsers.some((item) => item?.userId?.toLowerCase() === user.userId.toLowerCase())) throw new Error("USER userId already exists.");
  if (existingUsers.some((item) => item?.staffId?.toLowerCase() === user.staffId.toLowerCase())) throw new Error("USER staffId is already linked.");
  if (existingStaffProfiles.some((item) => item?.staffId?.toLowerCase() === staff.staffId.toLowerCase())) throw new Error("STAFF staffId already exists.");
  if (existingStaffProfiles.some((item) => item?.linkedUserId?.toLowerCase() === user.userId.toLowerCase())) throw new Error("USER is already linked to a STAFF profile.");

  return { valid: true, userId: user.userId, staffId: staff.staffId, linkedUserId: staff.linkedUserId };
}


/**
 * Builds a new ordinary USER/STAFF identity pair with fresh immutable IDs.
 * The new USER is deliberately non-active until the cross-store YARD ROLE
 * provisioning workflow finalizes it. Callers cannot provide IDs, tier claims,
 * credentials, ROOTS classifications or an active status.
 *
 * Idempotency and persistence are handled by the Phase 3 provisioning API.
 */
export function buildNewUserStaffIdentityPair(
  userFields,
  staffFields,
  existingUsers = [],
  existingStaffProfiles = [],
  uuidFactory = () => crypto.randomUUID(),
) {
  if (!isObject(userFields) || !isObject(staffFields)) throw new TypeError("USER and STAFF fields are required.");
  const userReserved = ["userId", "staffId", "rootsClass", "rootClass", "tier", "enabled", "status", "pinSalt", "pinHash"];
  const staffReserved = ["staffId", "linkedUserId", "rootsClass", "rootClass"];
  if (userReserved.some((key) => Object.hasOwn(userFields, key))) throw new Error("USER identity, tier, credential and activation fields are server-generated.");
  if (staffReserved.some((key) => Object.hasOwn(staffFields, key))) throw new Error("STAFF identity and ROOTS fields are server-generated.");
  if (normaliseUsername(userFields.username) === "dev") throw new Error("DEV is the immutable root identity and cannot be provisioned as an ordinary USER.");

  const userId = uuidFactory();
  const staffId = uuidFactory();
  if (!isUuid(userId) || !isUuid(staffId) || userId.toLowerCase() === staffId.toLowerCase()) {
    throw new Error("Identity ID generator must return two distinct UUIDs.");
  }

  const user = { ...userFields, userId, staffId, status: "PROVISIONING", enabled: false };
  const staff = { ...staffFields, staffId, linkedUserId: userId };
  validateNewUserStaffPair(user, staff, existingUsers, existingStaffProfiles);

  return { user, staff };
}

export const identityUuidPattern = UUID_PATTERN;


const STAFF_DEPARTMENT_RULES = Object.freeze({
  SCPL: { roles: ["Main Operator", "Picking Line Crew"] },
  "R&M": { role: "Mechanic" },
  Management: { role: "Manager" },
  SCFL: { role: "Floor Crew" },
  Traffic: { role: "Gateman" },
});

const DEFAULT_STATIONS = [
  { id: "station-1", name: "Station 1", category: "WOOD", active: true, aliases: [] },
  { id: "station-2", name: "Station 2", category: "WOOD", active: true, aliases: [] },
  { id: "station-3", name: "Station 3", category: "SCRAP", active: true, aliases: [] },
  { id: "station-4", name: "Station 4", category: "SCRAP", active: true, aliases: [] },
  { id: "station-5", name: "Station 5", category: "GENERAL", active: true, aliases: [] },
  { id: "station-6", name: "Station 6", category: "GENERAL", active: true, aliases: [] },
];

/** Validate existing operational STAFF fields without granting application access. */
export function validateStaffOperationalProfile(fields, stationConfig = DEFAULT_STATIONS) {
  if (!isObject(fields)) throw new TypeError("STAFF operational details are required.");
  const department = String(fields.department ?? "").trim();
  const rule = STAFF_DEPARTMENT_RULES[department];
  if (!rule) throw new Error("A valid STAFF department is required.");
  const onSiteRole = String(fields.onSiteRole ?? "").trim();
  const allowedRoles = rule.roles || [rule.role];
  if (!allowedRoles.includes(onSiteRole)) throw new Error("STAFF operational role is invalid for the selected department.");
  if (typeof fields.onSite !== "boolean") throw new Error("STAFF onSite status must be explicitly supplied.");
  if (typeof fields.stationLocked !== "boolean") throw new Error("STAFF stationLocked status must be explicitly supplied.");

  const station = String(fields.station ?? "").trim();
  const activeStations = (Array.isArray(stationConfig) && stationConfig.length ? stationConfig : DEFAULT_STATIONS)
    .filter((item) => isObject(item) && item.active !== false && /^station-[1-6]$/.test(String(item.id ?? "")));

  if (department === "SCPL") {
    if (station && !activeStations.some((item) => {
      const label = String(item.name || "Station") + " · " + String(item.category || "GENERAL");
      const aliases = Array.isArray(item.aliases) ? item.aliases : [];
      return station === item.id || station === item.name || station === label || aliases.includes(station);
    })) throw new Error("STAFF station must match an active SCPL station.");
    if (fields.stationLocked && !station) throw new Error("A locked STAFF station must have an assigned station.");
  } else if (station || fields.stationLocked) {
    throw new Error("Station assignment and station lock are available only for SCPL STAFF.");
  }

  for (const key of ["photo", "photoPath", "photoOriginalStored", "rootsClass", "rootClass", "staffId", "linkedUserId"]) {
    if (Object.hasOwn(fields, key)) throw new Error("STAFF identity, ROOTS and photo fields are not accepted by ordinary provisioning.");
  }

  return {
    department,
    onSiteRole,
    station: department === "SCPL" ? station : "",
    stationLocked: department === "SCPL" && fields.stationLocked,
    onSite: fields.onSite,
  };
}

/**
 * Create a pending USER and linked STAFF record in one cloned Central Bank payload.
 * The USER remains disabled and the STAFF profile stays out of active roster copies
 * until the canonical YARD ROLE assignment is independently persisted and verified.
 */
export function buildPendingUserStaffProvisioning(bank, input) {
  if (!isObject(input) || !isObject(input.userFields) || !isObject(input.staffFields)) {
    throw new TypeError("USER and STAFF provisioning fields are required.");
  }
  if (!isUuid(input.idempotencyKey)) throw new Error("A UUID idempotencyKey is required.");
  if (!isUuid(input.userId) || !isUuid(input.staffId) || input.userId.toLowerCase() === input.staffId.toLowerCase()) {
    throw new Error("Two distinct server-generated identity UUIDs are required.");
  }
  if (!isUuid(input.requestedYardRoleId)) throw new Error("A canonical YARD ROLE ID is required.");
  if (typeof input.requestFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(input.requestFingerprint)) {
    throw new Error("A SHA-256 provisioning request fingerprint is required.");
  }
  if (typeof input.pinSalt !== "string" || !/^[a-f0-9]{32}$/i.test(input.pinSalt) ||
      typeof input.pinHash !== "string" || !/^[a-f0-9]{64}$/i.test(input.pinHash)) {
    throw new Error("Server-hashed PIN credentials are required.");
  }
  const actorUserId = String(input.actorUserId ?? "");
  const actorUsername = String(input.actorUsername ?? input.actor ?? "").trim();
  const actorDisplayName = String(input.actorDisplayName ?? actorUsername).trim();
  if (!isUuid(actorUserId) || !actorUsername || !actorDisplayName) {
    throw new Error("Authenticated actor USER ID, username and display-name snapshot are required.");
  }

  const source = isObject(bank) ? bank : {};
  if (source.staff != null && !isObject(source.staff)) throw new Error("Canonical STAFF collection is malformed.");
  if (source.staff?.profiles != null && !isObject(source.staff.profiles)) throw new Error("Canonical STAFF profiles are malformed.");
  if (source.staff?.roster != null && !Array.isArray(source.staff.roster)) throw new Error("Canonical STAFF roster is malformed.");
  if (source.appData != null && !isObject(source.appData)) throw new Error("STAFF compatibility collection is malformed.");
  if (source.appData?.operatorProfiles != null && !isObject(source.appData.operatorProfiles)) throw new Error("STAFF compatibility profiles are malformed.");
  if (source.appData?.staffRoster != null && !Array.isArray(source.appData.staffRoster)) throw new Error("STAFF compatibility roster is malformed.");
  const receipts = isObject(source.identityProvisioningReceipts) ? source.identityProvisioningReceipts : {};
  const prior = receipts[input.idempotencyKey];
  if (prior) {
    if (prior.requestFingerprint !== input.requestFingerprint) {
      throw new Error("Idempotency key was already used for a different provisioning request.");
    }
    return { payload: bank, receipt: prior, replayed: true };
  }

  const username = String(input.userFields.username ?? "").trim();
  const displayName = String(input.userFields.displayName ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) throw new Error("Username must be 2–32 letters, numbers, dots, underscores or hyphens.");
  if (!displayName || displayName.length > 80) throw new Error("A display name of up to 80 characters is required.");
  if (normaliseUsername(username) === "dev") throw new Error("DEV is the immutable root identity.");
  if (!Array.isArray(source.users) || source.users.some((item) => normaliseUsername(item?.username) === normaliseUsername(username))) {
    throw new Error("USER username already exists or the USER collection is invalid.");
  }

  const staff = validateStaffOperationalProfile(input.staffFields, source.appData?.stationConfig);
  const profiles = isObject(source.staff?.profiles) ? source.staff.profiles : {};
  const roster = Array.isArray(source.staff?.roster) ? source.staff.roster : [];
  const compatibilityProfiles = isObject(source.appData?.operatorProfiles) ? Object.keys(source.appData.operatorProfiles) : [];
  const compatibilityRoster = Array.isArray(source.appData?.staffRoster) ? source.appData.staffRoster : [];
  const duplicateStaffName = [...Object.keys(profiles), ...roster, ...compatibilityProfiles, ...compatibilityRoster]
    .some((name) => normaliseUsername(name) === normaliseUsername(displayName));
  if (duplicateStaffName) throw new Error("STAFF display name already exists; use a unique display name.");

  const { user, staff: linkedStaff } = buildNewUserStaffIdentityPair(
    { username, displayName },
    { ...staff, name: displayName },
    source.users,
    Object.values(profiles),
    (() => { const ids = [input.userId, input.staffId]; return () => ids.shift(); })(),
  );

  const next = structuredClone(source);
  next.users = Array.isArray(next.users) ? next.users : [];
  next.staff = isObject(next.staff) ? next.staff : {};
  next.staff.profiles = isObject(next.staff.profiles) ? next.staff.profiles : {};
  next.staff.roster = Array.isArray(next.staff.roster) ? next.staff.roster : [];
  next.appData = isObject(next.appData) ? next.appData : {};
  next.appData.operatorProfiles = isObject(next.appData.operatorProfiles) ? next.appData.operatorProfiles : {};
  next.appData.staffRoster = Array.isArray(next.appData.staffRoster) ? next.appData.staffRoster : [];

  const now = String(input.createdAt || new Date().toISOString());
  const record = {
    ...user,
    pinSalt: input.pinSalt,
    pinHash: input.pinHash,
    provisioning: {
      stage: "YARD_ROLE_PENDING",
      idempotencyKey: input.idempotencyKey,
      requestedYardRoleId: input.requestedYardRoleId,
      createdAt: now,
    },
  };
  next.users.push(record);

  const staffProfile = { ...linkedStaff, status: "PROVISIONING", createdAt: now };
  next.staff.profiles[displayName] = staffProfile;

  const receipt = {
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    username,
    userId: input.userId,
    staffId: input.staffId,
    requestedYardRoleId: input.requestedYardRoleId,
    stage: "YARD_ROLE_PENDING",
    createdAt: now,
  };
  next.identityProvisioningReceipts = { ...receipts, [input.idempotencyKey]: receipt };
  const auditEvent = {
    action: "USER_STAFF_PROVISIONING_STARTED",
    actorUserId,
    actorUsername,
    actorDisplayName,
    username,
    displayName,
    userId: input.userId,
    staffId: input.staffId,
    requestedYardRoleId: input.requestedYardRoleId,
    at: now,
  };

  // The caller must persist auditEvent through the service-role audit RPC as
  // part of the same Central Bank compare-and-swap commit. It is not stored as
  // mutable JSON and is not itself an immutable audit record.
  return { payload: next, receipt, replayed: false, auditEvent };
}

/**
 * Finalize only from a trusted server-side result read from the canonical YARD ROLE
 * assignment store. The caller must not pass a client-supplied role claim.
 */
export function activatePendingUserStaffProvisioning(bank, roleAssignment, actor, now = new Date().toISOString()) {
  if (!isObject(bank)) throw new TypeError("Central Bank payload is required.");
  if (!isObject(actor) || !isUuid(actor.userId) || !String(actor.username ?? "").trim() || !String(actor.displayName ?? "").trim()) {
    throw new Error("Authenticated actor USER ID, username and display-name snapshot are required.");
  }
  if (!isObject(roleAssignment) ||
      !isUuid(roleAssignment.userId) ||
      !isUuid(roleAssignment.staffId) ||
      !isUuid(roleAssignment.yardRoleId) ||
      roleAssignment.status !== "ACTIVE" ||
      !Number.isInteger(roleAssignment.version) ||
      roleAssignment.version < 1 ||
      typeof roleAssignment.verifiedAt !== "string" ||
      Number.isNaN(Date.parse(roleAssignment.verifiedAt))) {
    throw new Error("A verified active canonical YARD ROLE assignment is required.");
  }

  const next = structuredClone(bank);
  const user = (Array.isArray(next.users) ? next.users : [])
    .find((item) => item?.userId?.toLowerCase() === roleAssignment.userId.toLowerCase());
  if (!user) throw new Error("Provisioned USER was not found.");
  if (user.staffId?.toLowerCase() !== roleAssignment.staffId.toLowerCase()) {
    throw new Error("Canonical YARD ROLE assignment does not match the USER/STAFF identity pair.");
  }

  if (!user.provisioning) {
    if (user.status === "ACTIVE" && user.enabled === true && user.yardRoleId === roleAssignment.yardRoleId) {
      const activeProfiles = Object.entries(isObject(next.staff?.profiles) ? next.staff.profiles : {})
        .filter(([, profile]) => profile?.staffId?.toLowerCase() === user.staffId?.toLowerCase());
      if (activeProfiles.length !== 1 ||
          activeProfiles[0][1].linkedUserId?.toLowerCase() !== user.userId.toLowerCase() ||
          activeProfiles[0][1].status !== "ACTIVE") {
        throw new Error("Active USER is missing its reciprocal active STAFF profile.");
      }
      const activeName = activeProfiles[0][0];
      if (!(Array.isArray(next.staff?.roster) && next.staff.roster.some((name) => normaliseUsername(name) === normaliseUsername(activeName)))) {
        throw new Error("Active STAFF profile is missing from the canonical roster.");
      }
      return { payload: bank, replayed: true, user };
    }
    throw new Error("USER is not awaiting provisioning activation.");
  }
  if (user.status !== "PROVISIONING" || user.enabled !== false) {
    throw new Error("USER must remain disabled and in PROVISIONING state until canonical YARD ROLE assignment is verified.");
  }
  if (user.provisioning.stage !== "YARD_ROLE_PENDING") throw new Error("Unsupported USER provisioning stage.");
  if (user.provisioning.requestedYardRoleId !== roleAssignment.yardRoleId) {
    throw new Error("Persisted YARD ROLE assignment does not match the requested role.");
  }
  if (user.tier != null) throw new Error("New USER provisioning must not restore a legacy tier permission claim.");

  const profiles = isObject(next.staff?.profiles) ? next.staff.profiles : {};
  const matchingStaff = Object.entries(profiles)
    .filter(([, profile]) => profile?.staffId?.toLowerCase() === user.staffId.toLowerCase());
  if (matchingStaff.length !== 1) throw new Error("Exactly one linked STAFF profile is required.");
  const [staffName, staff] = matchingStaff[0];
  if (staff.linkedUserId?.toLowerCase() !== user.userId.toLowerCase() || staff.status !== "PROVISIONING") {
    throw new Error("USER/STAFF reciprocal identity link or provisioning state is invalid.");
  }

  next.staff = isObject(next.staff) ? next.staff : {};
  next.staff.roster = Array.isArray(next.staff.roster) ? next.staff.roster : [];
  next.appData = isObject(next.appData) ? next.appData : {};
  next.appData.operatorProfiles = isObject(next.appData.operatorProfiles) ? next.appData.operatorProfiles : {};
  next.appData.staffRoster = Array.isArray(next.appData.staffRoster) ? next.appData.staffRoster : [];

  if (next.staff.roster.some((name) => normaliseUsername(name) === normaliseUsername(staffName)) ||
      next.appData.staffRoster.some((name) => normaliseUsername(name) === normaliseUsername(staffName)) ||
      Object.keys(next.appData.operatorProfiles).some((name) => normaliseUsername(name) === normaliseUsername(staffName))) {
    throw new Error("STAFF display name became occupied before provisioning activation.");
  }

  staff.status = "ACTIVE";
  user.yardRoleId = roleAssignment.yardRoleId;
  user.status = "ACTIVE";
  user.enabled = true;

  next.staff.roster.push(staffName);
  next.appData.operatorProfiles[staffName] = structuredClone(staff);
  next.appData.staffRoster = next.staff.roster.slice();

  const idempotencyKey = user.provisioning.idempotencyKey;
  delete user.provisioning;
  const receipts = isObject(next.identityProvisioningReceipts) ? next.identityProvisioningReceipts : {};
  if (!receipts[idempotencyKey] || receipts[idempotencyKey].userId !== user.userId) {
    throw new Error("Provisioning receipt is missing or does not match the USER.");
  }
  next.identityProvisioningReceipts[idempotencyKey] = {
    ...receipts[idempotencyKey],
    stage: "ACTIVE",
    activatedAt: now,
    yardRoleId: roleAssignment.yardRoleId,
    roleAssignmentVersion: roleAssignment.version,
  };
  const auditEvent = {
    action: "USER_STAFF_PROVISIONING_ACTIVATED",
    actorUserId: actor.userId,
    actorUsername: String(actor.username).trim(),
    actorDisplayName: String(actor.displayName).trim(),
    username: user.username,
    displayName: user.displayName || user.username,
    userId: user.userId,
    staffId: user.staffId,
    yardRoleId: roleAssignment.yardRoleId,
    roleAssignmentVersion: roleAssignment.version,
    at: now,
  };

  // The caller must persist auditEvent through the service-role audit RPC as
  // part of the same Central Bank compare-and-swap commit.
  return { payload: next, replayed: false, user, auditEvent };
}


/** Rename the STAFF presentation key without changing immutable USER/STAFF links. */
export function renameLinkedStaffDisplayName(bank, userId, staffId, nextDisplayName) {
  if (!isObject(bank) || !isUuid(userId) || !isUuid(staffId)) {
    throw new Error("A valid Central Bank payload and immutable USER/STAFF IDs are required.");
  }
  const name = String(nextDisplayName ?? "").trim();
  if (!name || name.length > 80) throw new Error("STAFF display name must contain 1–80 characters.");
  const user = (Array.isArray(bank.users) ? bank.users : [])
    .find((item) => item?.userId?.toLowerCase() === userId.toLowerCase());
  if (!user || user.staffId?.toLowerCase() !== staffId.toLowerCase()) {
    throw new Error("USER/STAFF identity pair does not match.");
  }
  const profiles = isObject(bank.staff?.profiles) ? bank.staff.profiles : {};
  const matches = Object.entries(profiles)
    .filter(([, profile]) => profile?.staffId?.toLowerCase() === staffId.toLowerCase());
  if (matches.length !== 1) throw new Error("Exactly one linked STAFF profile is required for a name change.");
  const [oldName, existingProfile] = matches[0];
  if (oldName === name) return { payload: bank, changed: false, oldName, newName: name };
  const collision = Object.keys(profiles).some((key) =>
    key !== oldName && normaliseUsername(key) === normaliseUsername(name)
  );
  if (collision) throw new Error("STAFF display name already exists.");
  const roster = Array.isArray(bank.staff?.roster) ? bank.staff.roster : [];
  if (roster.some((entry) => normaliseUsername(entry) === normaliseUsername(name))) {
    throw new Error("STAFF roster display name already exists.");
  }

  const next = structuredClone(bank);
  const profile = { ...existingProfile, name, displayName: name };
  delete next.staff.profiles[oldName];
  next.staff.profiles[name] = profile;
  next.staff.roster = (Array.isArray(next.staff.roster) ? next.staff.roster : [])
    .map((entry) => entry === oldName ? name : entry);
  next.appData = isObject(next.appData) ? next.appData : {};
  if (isObject(next.appData.operatorProfiles)) {
    delete next.appData.operatorProfiles[oldName];
    next.appData.operatorProfiles[name] = structuredClone(profile);
  }
  if (Array.isArray(next.appData.staffRoster)) {
    next.appData.staffRoster = next.appData.staffRoster.map((entry) => entry === oldName ? name : entry);
  }
  return { payload: next, changed: true, oldName, newName: name };
}
