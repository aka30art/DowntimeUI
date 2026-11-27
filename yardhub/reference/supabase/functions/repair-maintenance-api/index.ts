import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { canYardRolePerform, resolveYardRolePermissions } from "../_shared/yard-role-resolver.mjs";
import { resolveRootsAuthority } from "../_shared/roots-authority.mjs";
import { buildRepairMaintenancePdf } from "./pdf.ts";
import { RM_FAULT_PRIORITIES, isFaultUpdateValid } from "./update-contract.js";

const allowedOrigin = "https://aka30art.github.io";
const bucket = "repair-maintenance-evidence";
const reportBucket = "repair-maintenance-reports";
const machineTypes = ["KIVERCO_PICKING_LINE", "TANNA_SHREDDER", "FORKLIFT", "TELEHANDLER", "EXCAVATORS_360", "OTHER_EQUIPMENT"] as const;

const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"]);
const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-downtime-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const cryptoHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const digest = async (s: string) => cryptoHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const cleanText = (value: unknown, label: string, max: number, required = true) => {
  const result = String(value ?? "").trim();
  if (required && !result) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return result;
};
const isOneOf = <T extends readonly string[]>(value: unknown, allowed: T): value is T[number] => typeof value === "string" && allowed.includes(value);
const fail = (message: string) => ({ error: message });

const tierDefault: Record<string, Record<string, boolean>> = {
  OWNER: { canAccessYardHub: true, canAccessRepairMaintenance: true, canEditRepairMaintenance: true, canDeleteRepairMaintenance: true, canExportRepairMaintenanceReports: true },
  DEVACC: { canAccessYardHub: true, canAccessRepairMaintenance: true, canEditRepairMaintenance: true, canDeleteRepairMaintenance: true, canExportRepairMaintenanceReports: true },
  ADMIN: { canAccessYardHub: true, canAccessRepairMaintenance: true, canEditRepairMaintenance: true, canDeleteRepairMaintenance: true, canExportRepairMaintenanceReports: true },
  MANAGER: { canAccessYardHub: true, canAccessRepairMaintenance: true, canEditRepairMaintenance: true, canDeleteRepairMaintenance: true, canExportRepairMaintenanceReports: true },
  SUPERVISOR: { canAccessYardHub: true, canAccessRepairMaintenance: true, canEditRepairMaintenance: true, canDeleteRepairMaintenance: true, canExportRepairMaintenanceReports: true },
  USER: { canAccessYardHub: true, canAccessRepairMaintenance: false, canEditRepairMaintenance: false, canDeleteRepairMaintenance: false, canExportRepairMaintenanceReports: false },
  SPECTATOR: { canAccessYardHub: true, canAccessRepairMaintenance: false, canEditRepairMaintenance: false, canDeleteRepairMaintenance: false, canExportRepairMaintenanceReports: false },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    if (req.headers.get("origin") && req.headers.get("origin") !== allowedOrigin) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers });
  }
  if (req.headers.get("origin") && req.headers.get("origin") !== allowedOrigin) return json({ error: "Origin denied" }, 403);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "R&M service configuration missing" }, 500);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON request" }, 400); }
  const action = String(body.action || "");

  // Reuse the exact session issued by the existing DOWNTIME Central Bank login.
  const rawToken = req.headers.get("x-downtime-session") || "";
  if (!rawToken) return json({ error: "YARD HUB session required. Sign in through DOWNTIME first." }, 401);
  const tokenHash = await digest(rawToken);
  const { data: session, error: sessionError } = await db.from("downtime_central_sessions")
    .select("username,expires_at").eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (sessionError || !session) return json({ error: "YARD HUB session expired. Sign in again." }, 401);

  const { data: bankRow, error: bankError } = await db.from("downtime_central_bank").select("payload").eq("id", 1).maybeSingle();
  if (bankError || !bankRow?.payload) return json({ error: "Central user directory is unavailable." }, 503);
  const bank = bankRow.payload as Record<string, any>;
  const user = (Array.isArray(bank.users) ? bank.users : []).find((item: any) => String(item.username).toLowerCase() === String(session.username).toLowerCase() && item.enabled !== false);
  if (!user) return json({ error: "This account is disabled or no longer exists." }, 401);

  const [{ data: rootsBootstrap, error: rootsBootstrapError }, { data: rootsAssignment, error: rootsAssignmentError }] = await Promise.all([
    db.from("downtime_roots_bootstrap").select("user_id").eq("singleton", true).maybeSingle(),
    user.userId ? db.from("downtime_roots_assignments").select("user_id,staff_id,roots_class,status").eq("user_id", user.userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (rootsBootstrapError || rootsAssignmentError || !rootsBootstrap?.user_id) return json({ error: "Protected ROOTS identity registry is unavailable." }, 503);
  const rootsAuthority = resolveRootsAuthority(user, rootsAssignment, rootsBootstrap.user_id);
  const isProtectedRoot = ["DEV", "DEV1", "ADMIN"].includes(rootsAuthority || "");
  const isCanonicalIdentity = Boolean(user.userId || user.staffId);

  let resolvedYardRole: any = null;
  if (user.userId && user.staffId && !isProtectedRoot) {
    if (user.enabled !== true || user.status !== "ACTIVE") return json({ error: "Canonical USER/STAFF identity is not active." }, 403);
    const { data: assignment, error: assignmentError } = await db.from("yard_role_assignments")
      .select("user_id,staff_id,yard_role_id,status").eq("user_id", user.userId).eq("status", "ACTIVE").maybeSingle();
    if (assignmentError) return json({ error: "Canonical YARD ROLE assignment is unavailable." }, 503);
    if (!assignment || String(assignment.staff_id).toLowerCase() !== String(user.staffId).toLowerCase()) {
      return json({ error: "An active linked canonical YARD ROLE assignment is required." }, 403);
    }
    const [{ data: role, error: roleError }, { data: rolePermissions, error: rolePermissionsError }] = await Promise.all([
      db.from("yard_roles").select("id,name,description,status").eq("id", assignment.yard_role_id).eq("status", "ACTIVE").maybeSingle(),
      db.from("yard_role_department_permissions").select("yard_role_id,department,can_view,can_enter,can_edit,can_manage").eq("yard_role_id", assignment.yard_role_id),
    ]);
    if (roleError || rolePermissionsError || !role) return json({ error: "Canonical YARD ROLE permission profile is unavailable." }, 503);
    try { resolvedYardRole = resolveYardRolePermissions(role, rolePermissions || []); }
    catch { return json({ error: "Canonical YARD ROLE permission profile is invalid." }, 503); }
  }
  if (isCanonicalIdentity && !isProtectedRoot && !resolvedYardRole) {
    return json({ error: "An active canonical YARD ROLE assignment is required for R&M access." }, 403);
  }

  const tier = String(user.tier || "USER").toUpperCase();
  const effectiveTier = isCanonicalIdentity && !isProtectedRoot ? "USER" : tier;
  const stored = bank.tiers?.[effectiveTier] || {};
  const permissions = { ...(tierDefault[effectiveTier] || tierDefault.USER), ...stored };
  if (!isCanonicalIdentity && (effectiveTier === "OWNER" || effectiveTier === "DEVACC")) Object.assign(permissions, tierDefault[effectiveTier]);

  let hubTier = "USER";
  if (!resolvedYardRole && !isProtectedRoot) {
    // Legacy YARD HUB matrix is retained only for non-canonical transitional accounts.
    const { data: hubAccessRow, error: hubAccessError } = await db.from("yard_hub_tier_config")
      .select("payload").eq("id", 1).maybeSingle();
    const missingHubTable = hubAccessError?.code === "42P01" || hubAccessError?.code === "PGRST205";
    if (hubAccessError && !missingHubTable) return json({ error: "YARD HUB permissions are temporarily unavailable." }, 503);
    if (!hubAccessError && !hubAccessRow?.payload) return json({ error: "YARD HUB permissions are temporarily unavailable." }, 503);
    hubTier = String(hubAccessRow?.payload?.userTiers?.[String(user.username).toLowerCase()] || (effectiveTier === "OWNER" ? "OWNER" : effectiveTier)).toUpperCase();
    if (!hubAccessError && hubAccessRow?.payload) {
      const profile = hubAccessRow.payload?.tiers?.[hubTier] || {};
      const mode = profile.repairMaintenance;
      if (!["NONE", "READ", "INPUT", "EDIT"].includes(mode)) return json({ error: "YARD HUB R&M permission profile is invalid." }, 503);
      const machineryMode = profile.repairMaintenanceMachinery ?? mode;
      if (!["NONE", "READ", "INPUT", "EDIT"].includes(machineryMode)) return json({ error: "YARD HUB R&M Machinery permission profile is invalid." }, 503);
      permissions.canAccessRepairMaintenance = mode !== "NONE";
      permissions.canCreateRepairMaintenance = mode === "INPUT" || mode === "EDIT";
      permissions.canEditRepairMaintenance = mode === "EDIT";
      permissions.canDeleteRepairMaintenance = mode === "EDIT";
      permissions.canExportRepairMaintenanceReports = mode === "READ" || mode === "EDIT";
      permissions.canReadRepairMaintenanceMachinery = machineryMode !== "NONE";
      permissions.canAddRepairMaintenanceMachinery = machineryMode === "INPUT" || machineryMode === "EDIT";
      permissions.canManageRepairMaintenanceMachinery = machineryMode === "EDIT";
    } else {
      permissions.canReadRepairMaintenanceMachinery = permissions.canAccessRepairMaintenance === true;
      permissions.canManageRepairMaintenanceMachinery = permissions.canEditRepairMaintenance === true;
    }
  }

  if (resolvedYardRole) {
    const canView = canYardRolePerform(resolvedYardRole, "R&M", "VIEW");
    const canEnter = canYardRolePerform(resolvedYardRole, "R&M", "ENTER");
    const canEdit = canYardRolePerform(resolvedYardRole, "R&M", "EDIT");
    const canManage = canYardRolePerform(resolvedYardRole, "R&M", "MANAGE");
    Object.assign(permissions, {
      canAccessYardHub: canView || canEnter || canEdit || canManage,
      canAccessRepairMaintenance: canView || canEnter || canEdit || canManage,
      canCreateRepairMaintenance: canEnter,
      canEditRepairMaintenance: canEdit,
      canDeleteRepairMaintenance: canManage,
      canExportRepairMaintenanceReports: canView,
      canReadRepairMaintenanceMachinery: canView,
      canAddRepairMaintenanceMachinery: canEnter,
      canManageRepairMaintenanceMachinery: canManage,
      canManageRepairMaintenancePresets: canManage,
    });
  }

  if (isProtectedRoot) {
    Object.assign(permissions, {
      canAccessYardHub: true,
      canAccessRepairMaintenance: true,
      canCreateRepairMaintenance: true,
      canEditRepairMaintenance: true,
      canDeleteRepairMaintenance: true,
      canExportRepairMaintenanceReports: true,
      canReadRepairMaintenanceMachinery: true,
      canAddRepairMaintenanceMachinery: true,
      canManageRepairMaintenanceMachinery: true,
      canManageRepairMaintenancePresets: true,
    });
  } else if (!resolvedYardRole) {
    permissions.canCreateRepairMaintenance = permissions.canCreateRepairMaintenance === true || permissions.canEditRepairMaintenance === true;
    permissions.canAddRepairMaintenanceMachinery = permissions.canAddRepairMaintenanceMachinery === true || permissions.canManageRepairMaintenanceMachinery === true;
    permissions.canManageRepairMaintenancePresets = permissions.canEditRepairMaintenance === true;
  }
  if (!permissions.canAccessYardHub) return json({ error: "YARD HUB access is not enabled for this account." }, 403);
  if (!permissions.canAccessRepairMaintenance) return json({ error: "R&M access is not enabled for this account." }, 403);

  const actor = String(user.username);
  const audit = async (event: string, details: Record<string, unknown> = {}) => {
    await db.from("repair_maintenance_audit").insert({ actor, action: event, details });
  };
  const requireEdit = () => permissions.canEditRepairMaintenance === true;
  const requireDelete = () => permissions.canDeleteRepairMaintenance === true;
  const loadFault = async (faultId: unknown) => {
    if (permissions.canReadRepairMaintenanceMachinery !== true) throw new Error("You do not have READ access to R&M Machinery.");
    const id = cleanText(faultId, "Fault ID", 64);
    const { data, error } = await db.from("repair_maintenance_faults").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error("Unable to load fault record.");
    if (!data) throw new Error("Fault record not found.");
    return data;
  };

  try {
    if (action === "access") return json({ user: { username: actor, displayName: user.displayName || actor, tier }, permissions });

    if (action === "asset-list") {
      if (permissions.canReadRepairMaintenanceMachinery !== true) return json({ error: "You do not have READ access to R&M Machinery." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      const [{ data, error }, { count: unassignedCount, error: unassignedError }] = await Promise.all([
        db.from("repair_maintenance_assets")
          .select("id,machine_type,name,asset_code,make_model,status,created_at,updated_at")
          .eq("machine_type", body.machineType)
          .order("status", { ascending: true })
          .order("name", { ascending: true }),
        db.from("repair_maintenance_faults")
          .select("id", { count: "exact", head: true })
          .eq("machine_type", body.machineType)
          .is("asset_id", null),
      ]);
      if (error || unassignedError) return json({ error: "Unable to load the R&M machinery register." }, 503);
      return json({ assets: data || [], unassignedCount: Number(unassignedCount || 0) });
    }

    if (action === "asset-add") {
      if (permissions.canAddRepairMaintenanceMachinery !== true) return json({ error: "You do not have INPUT access to add R&M Machinery." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine category."), 400);
      const makeModel = cleanText(body.makeModel, "Make / model", 120);
      const name = makeModel;
      const assetCode = cleanText(body.assetCode, "Fleet number / registration", 40, false) || null;
      const { data, error } = await db.from("repair_maintenance_assets").insert({
        machine_type: body.machineType, name, asset_code: assetCode, make_model: makeModel,
        status: "ACTIVE", created_by: actor, updated_by: actor,
      }).select("id,machine_type,name,asset_code,make_model,status,created_at,updated_at").single();
      if (error?.code === "23505") return json({ error: "A machine with that name or fleet number already exists in this category." }, 409);
      if (error || !data) return json({ error: "Unable to register the new machine." }, 503);
      await audit("rm-machinery-add", { assetId: data.id, machineType: data.machine_type, name: data.name, assetCode: data.asset_code });
      return json({ asset: data }, 201);
    }

    if (action === "asset-update") {
      if (permissions.canEditRepairMaintenance !== true) return json({ error: "You do not have EDIT access to R&M Machinery." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine category."), 400);
      const assetId = cleanText(body.assetId, "Machine ID", 64);
      const makeModel = cleanText(body.makeModel, "Make / model", 120);
      const name = makeModel;
      const assetCode = cleanText(body.assetCode, "Fleet number / registration", 40, false) || null;
      const { data, error } = await db.from("repair_maintenance_assets").update({
        name, asset_code: assetCode, make_model: makeModel, updated_by: actor, updated_at: new Date().toISOString(),
      }).eq("id", assetId).eq("machine_type", body.machineType)
        .select("id,machine_type,name,asset_code,make_model,status,created_at,updated_at").maybeSingle();
      if (error?.code === "23505") return json({ error: "A machine with that name or fleet number already exists in this category." }, 409);
      if (error) return json({ error: "Unable to update the machine details." }, 503);
      if (!data) return json({ error: "Machine not found." }, 404);
      await audit("rm-machinery-update", { assetId: data.id, machineType: data.machine_type, name: data.name, assetCode: data.asset_code });
      return json({ asset: data });
    }

    if (action === "asset-delete") {
      if (permissions.canDeleteRepairMaintenance !== true) return json({ error: "You do not have MANAGE access to permanently delete R&M Machinery." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine category."), 400);
      const assetId = cleanText(body.assetId, "Machine ID", 64);
      const { count, error: faultCountError } = await db.from("repair_maintenance_faults")
        .select("id", { count: "exact", head: true })
        .eq("asset_id", assetId).eq("machine_type", body.machineType);
      if (faultCountError) return json({ error: "Unable to verify whether this machine has linked fault history. Nothing was deleted." }, 503);
      if (Number(count || 0) > 0) return json({ error: "This machine has linked fault history and cannot be permanently deleted." }, 409);
      const { data, error } = await db.from("repair_maintenance_assets").delete()
        .eq("id", assetId).eq("machine_type", body.machineType).eq("status", "ACTIVE")
        .select("id,machine_type,name").maybeSingle();
      if (error?.code === "23503") return json({ error: "This machine has linked fault history and cannot be permanently deleted." }, 409);
      if (error) return json({ error: "Unable to permanently delete the machine. Nothing was changed." }, 503);
      if (!data) return json({ error: "Active machine not found." }, 404);
      await audit("rm-machinery-delete", { assetId: data.id, machineType: data.machine_type, name: data.name });
      return json({ deleted: true, asset: data });
    }

    if (action === "asset-archive") {
      if (permissions.canDeleteRepairMaintenance !== true) return json({ error: "You do not have MANAGE access to archive R&M Machinery." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine category."), 400);
      const assetId = cleanText(body.assetId, "Machine ID", 64);
      const { data, error } = await db.from("repair_maintenance_assets").update({
        status: "ARCHIVED", updated_by: actor, updated_at: new Date().toISOString(),
      }).eq("id", assetId).eq("machine_type", body.machineType).eq("status", "ACTIVE")
        .select("id,machine_type,name,status").maybeSingle();
      if (error) return json({ error: "Unable to archive the machine." }, 503);
      if (!data) return json({ error: "Active machine not found." }, 404);
      await audit("rm-machinery-archive", { assetId: data.id, machineType: data.machine_type, name: data.name });
      return json({ asset: data });
    }

    if (action === "preset-list") {
      if (permissions.canReadRepairMaintenanceMachinery !== true && permissions.canAddRepairMaintenanceMachinery !== true && permissions.canManageRepairMaintenancePresets !== true) return json({ error: "You do not have permission to view R&M presets." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      const { data, error } = await db.from("repair_maintenance_machine_presets").select("id,machine_type,name,is_other,created_at")
        .eq("machine_type", body.machineType).order("is_other", { ascending: true }).order("created_at", { ascending: true });
      if (error) return json({ error: "Unable to load the machine presets." }, 503);
      return json({ presets: data || [] });
    }

    if (action === "preset-add") {
      if (permissions.canManageRepairMaintenancePresets !== true) return json({ error: "You do not have permission to manage R&M machine presets." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      const name = cleanText(body.name, "Preset name", 80);
      if (name.toLocaleLowerCase() === "other — enter manually") return json(fail("The built-in OTHER option cannot be recreated."), 400);
      const { data, error } = await db.from("repair_maintenance_machine_presets").insert({ machine_type: body.machineType, name, is_other: false, created_by: actor })
        .select("id,machine_type,name,is_other,created_at").single();
      if (error?.code === "23505") return json({ error: "That preset already exists for this machinery." }, 409);
      if (error || !data) return json({ error: "Unable to save the machine preset." }, 503);
      await audit("rm-machine-preset-add", { presetId: data.id, machineType: data.machine_type, name: data.name });
      return json({ preset: data }, 201);
    }

    if (action === "preset-delete") {
      if (permissions.canManageRepairMaintenancePresets !== true) return json({ error: "You do not have permission to manage R&M machine presets." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      const presetId = cleanText(body.presetId, "Preset ID", 64);
      const { data, error } = await db.from("repair_maintenance_machine_presets").delete()
        .eq("id", presetId).eq("machine_type", body.machineType).eq("is_other", false).select("id,name").maybeSingle();
      if (error) return json({ error: "Unable to remove the machine preset." }, 503);
      if (!data) return json({ error: "Preset not found or protected." }, 404);
      await audit("rm-machine-preset-delete", { presetId: data.id, machineType: body.machineType, name: data.name });
      return json({ ok: true });
    }

    if (action === "settings-get") {
      if (permissions.canReadRepairMaintenanceMachinery !== true && permissions.canManageRepairMaintenancePresets !== true) return json({ error: "You do not have READ access to R&M settings." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      const { data, error } = await db.from("repair_maintenance_machine_settings")
        .select("machine_type,model_dropdown_enabled,asset_selector_enabled,registration_enabled,updated_at")
        .eq("machine_type", body.machineType).maybeSingle();
      if (error || !data) return json({ error: "Unable to load this category's R&M settings. Apply the R&M model catalogue migration and retry." }, 503);
      return json({ settings: data });
    }

    if (action === "settings-update") {
      if (permissions.canManageRepairMaintenancePresets !== true) return json({ error: "You do not have permission to manage R&M settings." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      const updates: Record<string, unknown> = { updated_by: actor, updated_at: new Date().toISOString() };
      if (typeof body.modelDropdownEnabled === "boolean") updates.model_dropdown_enabled = body.modelDropdownEnabled;
      if (typeof body.assetSelectorEnabled === "boolean") updates.asset_selector_enabled = body.assetSelectorEnabled;
      if (typeof body.registrationEnabled === "boolean") updates.registration_enabled = body.registrationEnabled;
      if (typeof body.modelDropdownEnabled !== "boolean" && typeof body.assetSelectorEnabled !== "boolean" && typeof body.registrationEnabled !== "boolean") return json(fail("Choose a MAKE / MODEL, registration, or registered-machine menu setting."), 400);
      const { data, error } = await db.from("repair_maintenance_machine_settings").update(updates)
        .eq("machine_type", body.machineType)
        .select("machine_type,model_dropdown_enabled,asset_selector_enabled,registration_enabled,updated_at").maybeSingle();
      if (error) return json({ error: "Unable to save the R&M category settings." }, 503);
      if (!data) return json({ error: "R&M category settings were not found. Apply the R&M machine selector migration and retry." }, 404);
      await audit("rm-machine-settings-update", { machineType: data.machine_type, modelDropdownEnabled: data.model_dropdown_enabled, assetSelectorEnabled: data.asset_selector_enabled, registrationEnabled: data.registration_enabled });
      return json({ settings: data });
    }

    if (action === "model-list") {
      if (permissions.canReadRepairMaintenanceMachinery !== true && permissions.canAddRepairMaintenanceMachinery !== true && permissions.canManageRepairMaintenancePresets !== true) return json({ error: "You do not have READ access to R&M settings." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      const { data, error } = await db.from("repair_maintenance_assets")
        .select("id,machine_type,name,asset_code,make_model,status,created_at,updated_at")
        .eq("machine_type", body.machineType).eq("status", "ACTIVE").order("name", { ascending: true });
      if (error) return json({ error: "Unable to load the R&M registered-machine catalogue." }, 503);
      return json({ models: (data || []).map(asset => ({ ...asset, model: asset.make_model || asset.name })) });
    }

    if (action === "model-add") {
      if (permissions.canAddRepairMaintenanceMachinery !== true) return json({ error: "You do not have INPUT access to add R&M Machinery." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine category."), 400);
      const name = cleanText(body.name, "Registered machine / model", 120);
      const { data: existing, error: lookupError } = await db.from("repair_maintenance_assets")
        .select("id").eq("machine_type", body.machineType).eq("status", "ACTIVE").ilike("name", name).limit(1);
      if (lookupError) return json({ error: "Unable to check the registered-machine catalogue." }, 503);
      if (existing?.length) return json({ error: "That registered machine already exists in this category." }, 409);
      const { data, error } = await db.from("repair_maintenance_assets").insert({
        machine_type: body.machineType, name, make_model: name, status: "ACTIVE", created_by: actor, updated_by: actor,
      }).select("id,machine_type,name,asset_code,make_model,status,created_at,updated_at").single();
      if (error?.code === "23505") return json({ error: "That registered machine already exists in this category." }, 409);
      if (error || !data) return json({ error: "Unable to add the registered machine." }, 503);
      await audit("rm-registered-machine-add", { assetId: data.id, machineType: data.machine_type, name: data.name });
      return json({ model: { ...data, model: data.make_model || data.name }, asset: data }, 201);
    }

    if (action === "model-delete") {
      if (permissions.canDeleteRepairMaintenance !== true) return json({ error: "You do not have MANAGE access to archive the registered machine." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine category."), 400);
      const modelId = cleanText(body.modelId, "Registered machine ID", 64);
      const { data, error } = await db.from("repair_maintenance_assets").update({ status: "ARCHIVED", updated_by: actor, updated_at: new Date().toISOString() })
        .eq("id", modelId).eq("machine_type", body.machineType).eq("status", "ACTIVE").select("id,name").maybeSingle();
      if (error) return json({ error: "Unable to archive the registered machine." }, 503);
      if (!data) return json({ error: "Registered machine not found in this category." }, 404);
      await audit("rm-registered-machine-archive", { assetId: data.id, machineType: body.machineType, name: data.name });
      return json({ ok: true });
    }

    if (action === "list") {
      if (permissions.canReadRepairMaintenanceMachinery !== true) return json({ error: "You do not have READ access to R&M Machinery." }, 403);
      if (!isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machine type."), 400);
      let query = db.from("repair_maintenance_faults")
        .select("id,machine_type,asset_id,fault_name,description,priority,status,created_by,updated_by,created_at,updated_at")
        .eq("machine_type", body.machineType);
      if (body.allEquipment === true) {
        if (body.machineType !== "OTHER_EQUIPMENT") return json(fail("The combined equipment register is only available for Other Equipment."), 400);
        const { data, error } = await query.order("created_at", { ascending: true });
        if (error) return json({ error: "Unable to load the machinery fault register." }, 503);
        const rows = data || [];
        const assetIds = [...new Set(rows.map((fault: any) => fault.asset_id).filter(Boolean))];
        const assetMap = new Map<string, any>();
        if (assetIds.length) {
          const { data: linkedAssets, error: assetError } = await db.from("repair_maintenance_assets")
            .select("id,name,asset_code").in("id", assetIds);
          if (assetError) return json({ error: "Unable to load equipment names for the fault register." }, 503);
          for (const asset of linkedAssets || []) assetMap.set(asset.id, asset);
        }
        return json({ faults: rows.map((fault: any) => {
          const asset = fault.asset_id ? assetMap.get(fault.asset_id) : null;
          return { ...fault, equipment_name: asset?.name || "UNASSIGNED / LEGACY", equipment_code: asset?.asset_code || null };
        }) });
      }
      if (body.unassigned === true) {
        query = query.is("asset_id", null);
      } else {
        const assetId = cleanText(body.assetId, "Machine", 64);
        const { data: asset, error: assetError } = await db.from("repair_maintenance_assets")
          .select("id").eq("id", assetId).eq("machine_type", body.machineType).maybeSingle();
        if (assetError) return json({ error: "Unable to verify the selected machine." }, 503);
        if (!asset) return json({ error: "Machine not found in this category." }, 404);
        query = query.eq("asset_id", assetId);
      }
      const { data, error } = await query.order("created_at", { ascending: true });
      if (error) return json({ error: "Unable to load the machinery fault register." }, 503);
      return json({ faults: data || [] });
    }

    if (action === "export-create") {
      if (permissions.canExportRepairMaintenanceReports !== true) return json({ error: "You do not have permission to export R&M reports." }, 403);
      if (permissions.canReadRepairMaintenanceMachinery !== true) return json({ error: "You do not have READ access to R&M Machinery." }, 403);
      if (body.machineType !== undefined && body.machineType !== null && body.machineType !== "" && !isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machinery filter."), 400);
      let selectedAsset: any = null;
      const assetId = body.assetId ? cleanText(body.assetId, "Machine", 64) : null;
      if (assetId) {
        const { data, error } = await db.from("repair_maintenance_assets")
          .select("id,machine_type,name,asset_code").eq("id", assetId).maybeSingle();
        if (error) return json({ error: "Unable to verify the selected machine for this report." }, 503);
        if (!data) return json({ error: "Selected machine was not found." }, 404);
        if (body.machineType && body.machineType !== data.machine_type) return json(fail("Machine does not belong to the selected category."), 400);
        selectedAsset = data;
      }
      const filter = selectedAsset?.machine_type || (typeof body.machineType === "string" && body.machineType ? body.machineType : null);
      const unassigned = body.unassigned === true;
      if (unassigned && (!filter || assetId)) return json(fail("Select one category to export unassigned legacy records."), 400);
      const faults: any[] = [], pageSize = 500, maxRecords = 10000;
      for (let offset = 0; ; offset += pageSize) {
        let query = db.from("repair_maintenance_faults")
          .select("id,machine_type,asset_id,fault_name,description,priority,status,created_at");
        if (assetId) query = query.eq("asset_id", assetId);
        else if (filter) query = query.eq("machine_type", filter);
        if (unassigned) query = query.is("asset_id", null);
        const { data, error } = await query.order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
        if (error) return json({ error: "Unable to load the R&M report records." }, 503);
        const rows = data || [];
        faults.push(...rows);
        if (faults.length > maxRecords) return json({ error: "Report exceeds the 10,000-record limit. Filter by machinery or machine and retry." }, 413);
        if (rows.length < pageSize) break;
      }
      const assetIds = [...new Set(faults.map((fault) => fault.asset_id).filter(Boolean))];
      if (assetIds.length) {
        const { data: assets, error } = await db.from("repair_maintenance_assets").select("id,name,asset_code").in("id", assetIds);
        if (error) return json({ error: "Unable to load machinery names for the PDF report." }, 503);
        const assetMap = new Map((assets || []).map((asset: any) => [asset.id, asset]));
        for (const fault of faults) {
          const linked = fault.asset_id ? assetMap.get(fault.asset_id) : null;
          fault.asset_name = linked?.name || null;
          fault.asset_code = linked?.asset_code || null;
        }
      } else {
        for (const fault of faults) { fault.asset_name = null; fault.asset_code = null; }
      }
      const generatedAt = new Date();
      const bytes = await buildRepairMaintenancePdf(faults, filter, generatedAt, selectedAsset?.name || null);
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) return json({ error: "Generated PDF exceeds the 25 MB archive limit." }, 413);
      const stamp = generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const slug = (selectedAsset?.name || (unassigned ? "UNASSIGNED" : filter) || "ALL_MACHINERY").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60);
      const fileName = `RM_${slug}_${stamp}.pdf`;
      const storagePath = `${generatedAt.toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`;
      const { error: uploadError } = await db.storage.from(reportBucket).upload(storagePath, bytes, { contentType: "application/pdf", cacheControl: "0", upsert: false });
      if (uploadError) return json({ error: "Unable to store the generated R&M PDF securely." }, 503);
      const { data, error } = await db.from("repair_maintenance_pdf_exports").insert({
        machine_type: filter, asset_id: assetId, file_name: fileName, storage_path: storagePath,
        mime_type: "application/pdf", file_size_bytes: bytes.length, record_count: faults.length, created_by: actor,
      }).select("id,machine_type,asset_id,file_name,mime_type,file_size_bytes,record_count,created_by,created_at").single();
      if (error || !data) {
        await db.storage.from(reportBucket).remove([storagePath]);
        return json({ error: "The PDF was generated but could not be registered in PDF EXPORTS." }, 503);
      }
      await audit("rm-pdf-export-create", { reportId: data.id, machineType: filter, assetId, recordCount: faults.length, fileSizeBytes: bytes.length });
      return json({ report: data }, 201);
    }
    if (action === "export-list") {
      if (permissions.canExportRepairMaintenanceReports !== true) return json({ error: "You do not have permission to view R&M PDF exports." }, 403);
      if (permissions.canReadRepairMaintenanceMachinery !== true) return json({ error: "You do not have READ access to R&M Machinery." }, 403);
      if (body.machineType !== undefined && body.machineType !== null && body.machineType !== "" && !isOneOf(body.machineType, machineTypes)) return json(fail("Select a valid machinery filter."), 400);
      const offset = typeof body.offset === "number" && Number.isInteger(body.offset) ? body.offset : 0;
      if (offset < 0 || offset > 20000) return json(fail("PDF export page is invalid."), 400);
      const filter = typeof body.machineType === "string" && body.machineType ? body.machineType : null;
      const assetId = body.assetId ? cleanText(body.assetId, "Machine", 64) : null;
      let query = db.from("repair_maintenance_pdf_exports")
        .select("id,machine_type,asset_id,file_name,mime_type,file_size_bytes,record_count,created_by,created_at");
      if (assetId) query = query.eq("asset_id", assetId);
      else if (filter) query = query.eq("machine_type", filter);
      const { data, error } = await query.order("created_at", { ascending: false }).range(offset, offset + 49);
      if (error) return json({ error: "Unable to load PDF EXPORTS." }, 503);
      const reports: any[] = data || [];
      const reportAssetIds = [...new Set(reports.map((report: any) => report.asset_id).filter(Boolean))];
      if (reportAssetIds.length) {
        const { data: linkedAssets, error: assetError } = await db.from("repair_maintenance_assets").select("id,name,asset_code").in("id", reportAssetIds);
        if (assetError) return json({ error: "Unable to load machine names for PDF EXPORTS." }, 503);
        const names = new Map((linkedAssets || []).map((asset: any) => [asset.id, asset]));
        for (const report of reports) {
          const linked = report.asset_id ? names.get(report.asset_id) : null;
          (report as any).asset_name = linked?.name || null;
          (report as any).asset_code = linked?.asset_code || null;
        }
      }
      return json({ reports, hasMore: reports.length === 50, nextOffset: offset + reports.length });
    }
    if (action === "export-url"){
      if(permissions.canExportRepairMaintenanceReports!==true)return json({error:"You do not have permission to open R&M PDF exports."},403);
      if(permissions.canReadRepairMaintenanceMachinery!==true)return json({error:"You do not have READ access to R&M Machinery."},403);
      const id=cleanText(body.reportId,"PDF export ID",64),{data:report,error}=await db.from("repair_maintenance_pdf_exports").select("id,storage_path,file_name").eq("id",id).maybeSingle();if(error)return json({error:"Unable to load the selected PDF export."},503);if(!report)return json({error:"PDF export not found."},404);
      const {data,error:signedError}=await db.storage.from(reportBucket).createSignedUrl(report.storage_path,300);if(signedError||!data?.signedUrl)return json({error:"Unable to create a secure PDF link."},503);return json({signedUrl:data.signedUrl,fileName:report.file_name})
    }
    if (action === "export-delete"){
      if(!requireDelete())return json({error:"You do not have permission to delete R&M PDF exports."},403);
      if(permissions.canReadRepairMaintenanceMachinery!==true)return json({error:"You do not have READ access to R&M Machinery."},403);
      const id=cleanText(body.reportId,"PDF export ID",64),{data:report,error:loadError}=await db.from("repair_maintenance_pdf_exports").select("id,machine_type,file_name,storage_path").eq("id",id).maybeSingle();if(loadError)return json({error:"Unable to load the selected PDF export."},503);if(!report)return json({error:"PDF export not found."},404);
      const {error:storageError}=await db.storage.from(reportBucket).remove([report.storage_path]);if(storageError)return json({error:"Unable to remove the stored PDF. Archive record retained."},503);
      const {error:deleteError}=await db.from("repair_maintenance_pdf_exports").delete().eq("id",report.id);if(deleteError)return json({error:"PDF file removed but archive record could not be deleted. Contact an administrator."},503);
      await audit("rm-pdf-export-delete",{reportId:report.id,machineType:report.machine_type,fileName:report.file_name});return json({ok:true})
    }

    if (action === "get") {
      if (permissions.canReadRepairMaintenanceMachinery !== true) return json({ error: "You do not have READ access to R&M Machinery." }, 403);
      const fault = await loadFault(body.faultId);
      const [{ data: notes, error: notesError }, { data: attachments, error: filesError }] = await Promise.all([
        db.from("repair_maintenance_notes").select("id,note,created_by,created_at").eq("fault_id", fault.id).order("created_at", { ascending: true }),
        db.from("repair_maintenance_attachments").select("id,storage_path,filename,mime_type,size_bytes,kind,created_by,created_at").eq("fault_id", fault.id).order("created_at", { ascending: true }),
      ]);
      if (notesError || filesError) return json({ error: "Unable to load fault history or attachments." }, 503);
      const signed = await Promise.all((attachments || []).map(async (file: any) => {
        const { data, error } = await db.storage.from(bucket).createSignedUrl(file.storage_path, 300);
        if (error) throw new Error("Unable to create a secure evidence link.");
        return { id: file.id, filename: file.filename, mime_type: file.mime_type, size_bytes: file.size_bytes, kind: file.kind, created_by: file.created_by, created_at: file.created_at, signedUrl: data.signedUrl };
      }));
      return json({ fault, notes: notes || [], attachments: signed });
    }

    if (action === "create") {
      if (permissions.canCreateRepairMaintenance !== true) return json({ error: "You do not have INPUT access to create R&M faults." }, 403);
      if (!isOneOf(body.machineType, machineTypes) || !isOneOf(body.priority, RM_FAULT_PRIORITIES)) return json(fail("Machine or priority is invalid."), 400);
      const assetId = cleanText(body.assetId, "Machine", 64);
      const { data: asset, error: assetError } = await db.from("repair_maintenance_assets")
        .select("id,name,status").eq("id", assetId).eq("machine_type", body.machineType).maybeSingle();
      if (assetError) return json({ error: "Unable to verify the selected machine." }, 503);
      if (!asset || asset.status !== "ACTIVE") return json({ error: "Select an active registered machine before adding a fault." }, 400);
      const presetId = cleanText(body.presetId, "Machinery preset", 64);
      const { data: preset, error: presetError } = await db.from("repair_maintenance_machine_presets")
        .select("id,name,is_other").eq("id", presetId).eq("machine_type", body.machineType).maybeSingle();
      if (presetError || !preset) return json({ error: "Select a valid preset for this machinery." }, 400);
      const faultName = preset.is_other ? cleanText(body.otherArea, "Area / Part of Machinery", 120) : preset.name;
      const description = cleanText(body.description, "Description", 2000);
      const { data, error } = await db.from("repair_maintenance_faults").insert({ machine_type: body.machineType, asset_id: assetId, fault_name: faultName, description, priority: body.priority, status: "OPEN", created_by: actor, updated_by: actor }).select("*").single();
      if (error || !data) return json({ error: "Unable to save the new fault record." }, 503);
      await audit("rm-fault-create", { faultId: data.id, machineType: data.machine_type, assetId: data.asset_id, priority: data.priority });
      return json({ fault: data }, 201);
    }

    if (action === "update") {
      if (!requireEdit()) return json({ error: "You do not have permission to update R&M faults." }, 403);
      const fault = await loadFault(body.faultId);
      if (!isFaultUpdateValid(body.status, body.priority)) return json(fail("Status or priority is invalid."), 400);
      const { data, error } = await db.from("repair_maintenance_faults").update({ status: body.status, priority: body.priority, updated_by: actor, updated_at: new Date().toISOString() }).eq("id", fault.id).select("*").single();
      if (error || !data) return json({ error: "Unable to update the fault record." }, 503);
      await audit("rm-fault-update", { faultId: fault.id, oldStatus: fault.status, status: data.status, priority: data.priority });
      return json({ fault: data });
    }

    if (action === "note-add") {
      if (!requireEdit()) return json({ error: "You do not have permission to add R&M notes." }, 403);
      const fault = await loadFault(body.faultId), note = cleanText(body.note, "Note", 2000);
      const { data, error } = await db.from("repair_maintenance_notes").insert({ fault_id: fault.id, note, created_by: actor }).select("id,note,created_by,created_at").single();
      if (error || !data) return json({ error: "Unable to save the note." }, 503);
      await db.from("repair_maintenance_faults").update({ updated_by: actor, updated_at: new Date().toISOString() }).eq("id", fault.id);
      await audit("rm-fault-note", { faultId: fault.id, noteId: data.id });
      return json({ note: data }, 201);
    }

    if (action === "upload") {
      if (!requireEdit()) return json({ error: "You do not have permission to attach R&M evidence." }, 403);
      const fault = await loadFault(body.faultId);
      const filename = cleanText(body.filename, "Filename", 180);
      const mimeType = String(body.mimeType || "").toLowerCase();
      const kind = body.kind === "PHOTO" ? "PHOTO" : body.kind === "FILE" ? "FILE" : "";
      if (!kind || !mimeTypes.has(mimeType) || (kind === "PHOTO" && !mimeType.startsWith("image/"))) return json(fail("File type is not supported."), 400);
      const dataUrl = String(body.dataUrl || "");
      const match = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
      if (!match || match[1].toLowerCase() !== mimeType || match[2].length > 5_600_000) return json(fail("File data is invalid or exceeds the 4 MB limit."), 400);
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) return json(fail("File exceeds the 4 MB limit."), 400);
      const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "evidence";
      const storagePath = `${fault.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await db.storage.from(bucket).upload(storagePath, bytes, { contentType: mimeType, upsert: false });
      if (uploadError) return json({ error: "Unable to store the attachment securely." }, 503);
      const { data, error } = await db.from("repair_maintenance_attachments").insert({ fault_id: fault.id, storage_path: storagePath, filename, mime_type: mimeType, size_bytes: bytes.length, kind, created_by: actor }).select("id,filename,kind,created_at").single();
      if (error || !data) {
        await db.storage.from(bucket).remove([storagePath]);
        return json({ error: "Unable to register the attachment." }, 503);
      }
      await db.from("repair_maintenance_faults").update({ updated_by: actor, updated_at: new Date().toISOString() }).eq("id", fault.id);
      await audit("rm-fault-attachment", { faultId: fault.id, attachmentId: data.id, kind, bytes: bytes.length });
      return json({ attachment: data }, 201);
    }

    if (action === "delete") {
      if (!requireDelete()) return json({ error: "You do not have permission to delete R&M faults." }, 403);
      const fault = await loadFault(body.faultId);
      const { data: files, error: fileError } = await db.from("repair_maintenance_attachments").select("storage_path").eq("fault_id", fault.id);
      if (fileError) return json({ error: "Unable to check fault attachments before deletion." }, 503);
      if (files?.length) {
        const { error: storageError } = await db.storage.from(bucket).remove(files.map((f: any) => f.storage_path));
        if (storageError) return json({ error: "Unable to remove stored evidence. Fault was not deleted." }, 503);
      }
      const { error } = await db.from("repair_maintenance_faults").delete().eq("id", fault.id);
      if (error) return json({ error: "Unable to delete the fault record." }, 503);
      await audit("rm-fault-delete", { faultId: fault.id, machineType: fault.machine_type, faultName: fault.fault_name });
      return json({ ok: true });
    }

    return json({ error: "Unknown R&M action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "R&M request failed.";
    return json({ error: message }, 400);
  }
});
