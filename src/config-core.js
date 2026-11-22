/* Universal tenant config. No company-specific defaults or credentials. */
export const CONFIG_SCHEMA_VERSION = 3;
export const TENANT_STORAGE_KEY = "downtimeui:tenant:v1";
export const DRAFT_STORAGE_KEY = "downtimeui:setup:draft:v1";
export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION, installed: false, installedAt: null, installationId: null,
  identity: { companyName: "", logoUrl: "", locale: "en-GB", timezone: "" },
  site: { siteName: "", hierarchy: ["Area", "Station"], areas: [], stations: [] },
  downtime: { reasons: [], presets: [] }, schedule: { workDays: [], shifts: [], breaks: [] },
  staff: [], roles: [], dailyTasks: [],
  setup: { currentStep: 0, completedSteps: [], updatedAt: null }
});
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAYS = new Set(["mon","tue","wed","thu","fri","sat","sun"]);
export function createId(prefix = "item") {
  const id = globalThis.crypto?.randomUUID?.() || (Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,10));
  return prefix + "_" + id;
}
export function cloneDefaultConfig() { return clone(DEFAULT_CONFIG); }
export function createTenantConfig(input = {}) {
  const c = cloneDefaultConfig();
  c.identity.companyName = String(input.companyName || "").trim();
  c.identity.locale = String(input.locale || "en-GB");
  c.identity.timezone = String(input.timezone || "").trim();
  c.site.siteName = String(input.siteName || "").trim();
  return c;
}
function uniqueNamed(items, label, errors) {
  const names = new Set(), ids = new Set();
  items.forEach((item, index) => {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!name) errors.push(label + " " + (index + 1) + " needs a name.");
    const key = name.toLocaleLowerCase();
    if (name && names.has(key)) errors.push(label + " names must be unique: " + name + ".");
    if (name) names.add(key);
    if (typeof item?.id !== "string" || !item.id) errors.push(label + " " + (index + 1) + " needs an ID.");
    else if (ids.has(item.id)) errors.push(label + " IDs must be unique.");
    else ids.add(item.id);
  });
}
function validTimezone(zone) {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(0); return true; }
  catch { return false; }
}
export function validateConfig(c) {
  const e = [];
  if (!isObject(c)) return ["Configuration must be an object."];
  if (c.schemaVersion !== CONFIG_SCHEMA_VERSION) e.push("Configuration schema must be version " + CONFIG_SCHEMA_VERSION + ".");
  if (!isObject(c.identity)) e.push("Company identity settings are missing.");
  else {
    if (typeof c.identity.companyName !== "string" || !c.identity.companyName.trim()) e.push("Company name is required.");
    if (typeof c.identity.locale !== "string" || !c.identity.locale.trim()) e.push("Language and regional format are required.");
    if (!validTimezone(c.identity.timezone)) e.push("Enter a valid IANA time zone (for example, Europe/London).");
    if (c.identity.logoUrl && !/^https:\/\/|^data:image\//i.test(c.identity.logoUrl)) e.push("Logo URL must use HTTPS or an image data URL.");
  }
  if (!isObject(c.site)) e.push("Site configuration is missing.");
  else {
    if (typeof c.site.siteName !== "string" || !c.site.siteName.trim()) e.push("Site or plant name is required.");
    if (!Array.isArray(c.site.hierarchy) || c.site.hierarchy.length < 2 || c.site.hierarchy.some(x => typeof x !== "string" || !x.trim())) e.push("Define at least two hierarchy labels.");
    if (!Array.isArray(c.site.areas)) e.push("Areas must be a list.");
    else uniqueNamed(c.site.areas, "Area", e);
    if (!Array.isArray(c.site.stations)) e.push("Stations must be a list.");
    else {
      uniqueNamed(c.site.stations, "Station", e);
      const areaIds = new Set((c.site.areas || []).map(x => x.id));
      c.site.stations.forEach((station, i) => { if (station?.areaId && !areaIds.has(station.areaId)) e.push("Station " + (i + 1) + " refers to an area that does not exist."); });
    }
  }
  if (!isObject(c.downtime) || !Array.isArray(c.downtime.reasons) || !Array.isArray(c.downtime.presets)) {
    e.push("Downtime reasons and presets must be lists.");
  } else {
    uniqueNamed(c.downtime.reasons, "Downtime reason", e);
    uniqueNamed(c.downtime.presets, "Downtime preset", e);
    const reasonIds=new Set(c.downtime.reasons.map(x=>x.id));
    const areaIds=new Set((c.site?.areas||[]).map(x=>x.id));
    const stations=c.site?.stations||[];
    const stationIds=new Set(stations.map(x=>x.id));
    c.downtime.presets.forEach((preset,i)=>{
      if(preset.areaId&&!areaIds.has(preset.areaId))e.push("Downtime preset "+(i+1)+" refers to an area that does not exist.");
      if(preset.stationId&&!stationIds.has(preset.stationId))e.push("Downtime preset "+(i+1)+" refers to a station that does not exist.");
      if(preset.stationId&&preset.areaId){
        const station=stations.find(x=>x.id===preset.stationId);
        if(station&&station.areaId&&station.areaId!==preset.areaId)e.push("Downtime preset "+(i+1)+" station is outside its selected area.");
      }
      if(preset.reasonId&&!reasonIds.has(preset.reasonId))e.push("Downtime preset "+(i+1)+" refers to a reason that does not exist.");
      if(preset.defaultDurationMinutes!==undefined&&preset.defaultDurationMinutes!==null&&
         (!Number.isInteger(preset.defaultDurationMinutes)||preset.defaultDurationMinutes<1||preset.defaultDurationMinutes>1440))
        e.push("Downtime preset "+(i+1)+" default duration must be between 1 and 1440 minutes.");
    });
  }
  if (!isObject(c.schedule)) e.push("Schedule settings are missing.");
  else {
    const s = c.schedule;
    if (!Array.isArray(s.workDays) || s.workDays.some(x => !DAYS.has(x)) || new Set(s.workDays).size !== s.workDays.length) e.push("Select valid, non-duplicated operating days.");
    if (!Array.isArray(s.shifts)) e.push("Shift definitions must be a list.");
    else {
      uniqueNamed(s.shifts, "Shift", e);
      s.shifts.forEach((x, i) => {
        if (!TIME.test(x?.start || "") || !TIME.test(x?.end || "")) e.push("Shift " + (i + 1) + " needs valid HH:MM start and end times.");
        else if (x.start === x.end) e.push("Shift " + (i + 1) + " start and end times cannot be identical.");
      });
      if (s.shifts.length && !s.workDays?.length) e.push("Choose operating days when shifts are configured.");
    }
    if (!Array.isArray(s.breaks)) e.push("Break definitions must be a list.");
    else {
      uniqueNamed(s.breaks, "Break", e);
      s.breaks.forEach((x, i) => {
        if (!TIME.test(x?.start || "") || !TIME.test(x?.end || "")) e.push("Break " + (i + 1) + " needs valid HH:MM start and end times.");
        else if (x.start === x.end) e.push("Break " + (i + 1) + " start and end times cannot be identical.");
      });
    }
  }
  if (!Array.isArray(c.staff)) e.push("Staff must be a list."); else {
    uniqueNamed(c.staff, "Staff member", e);
    c.staff.forEach((member, i) => {
      if (member.photoDataUrl !== undefined && member.photoDataUrl !== "") {
        if (typeof member.photoDataUrl !== "string" ||
            member.photoDataUrl.length > 180000 ||
            !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(member.photoDataUrl)) {
          e.push("Staff member " + (i + 1) + " photo must be a compressed JPEG under the supported size limit.");
        }
      }
    });
  }
  if (!Array.isArray(c.roles)) e.push("Access roles must be a list.");
  else {
    uniqueNamed(c.roles, "Role", e);
    c.roles.forEach((x, i) => { if (!isObject(x.permissions) || Object.values(x.permissions).some(v => typeof v !== "boolean")) e.push("Role " + (i + 1) + " permissions must be explicit true/false values."); });
  }
  if (Array.isArray(c.staff) && Array.isArray(c.roles)) {
    const roleIds = new Set(c.roles.map(role => role?.id).filter(id => typeof id === "string"));
    c.staff.forEach((member, i) => {
      if (member?.roleId && !roleIds.has(member.roleId)) e.push("Staff member " + (i + 1) + " refers to an access role that does not exist.");
    });
  }
  if (!Array.isArray(c.dailyTasks)) e.push("Daily task templates must be a list."); else uniqueNamed(c.dailyTasks, "Daily task", e);
  if (!isObject(c.setup) || !Array.isArray(c.setup.completedSteps) || !Number.isInteger(c.setup.currentStep)) e.push("Setup progress data is invalid.");
  return [...new Set(e)];
}
export function activateInstall(c, now = new Date()) {
  if (c?.installed === true) {
    const errors = validateConfig(c);
    return { ok: errors.length === 0, alreadyInstalled: true, errors, config: c };
  }
  const errors = validateConfig(c);
  if (errors.length) return { ok: false, alreadyInstalled: false, errors, config: c };
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const installed = { ...clone(c), installed: true, installedAt: timestamp, installationId: c.installationId || createId("installation"),
    setup: { ...c.setup, currentStep: 8, completedSteps: [...new Set([...c.setup.completedSteps, 8])], updatedAt: timestamp } };
  return { ok: true, alreadyInstalled: false, errors: [], config: installed };
}
export function upgradeConfig(input) {
  if (!isObject(input)) throw new TypeError("Cannot upgrade a non-object configuration.");
  if (input.schemaVersion > CONFIG_SCHEMA_VERSION) throw new Error("This configuration was created by a newer DOWNTIMEUI version.");
  if (input.schemaVersion === CONFIG_SCHEMA_VERSION) return clone(input);
  const d = cloneDefaultConfig(), c = { ...d, ...clone(input), schemaVersion: CONFIG_SCHEMA_VERSION };
  c.identity = { ...d.identity, ...(input.identity || {}) };
  c.site = { ...d.site, ...(input.site || {}) };
  c.downtime = { ...d.downtime, ...(input.downtime || {}), reasons: input.downtime?.reasons || [], presets: input.downtime?.presets || [] };
  c.schedule = { ...d.schedule, ...(input.schedule || {}) };
  c.staff = input.staff || []; c.roles = input.roles || []; c.dailyTasks = input.dailyTasks || [];
  c.setup = { ...d.setup, ...(input.setup || {}) };
  return c;
}
function runStorage(fn) { try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, value: null, error: error?.message || "Browser storage is unavailable." }; } }
export function saveDraft(c, storage = globalThis.localStorage) {
  if (!storage) return { ok: false, error: "Local browser storage is unavailable." };
  return runStorage(() => { storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...clone(c), installed: false, setup: { ...c.setup, updatedAt: new Date().toISOString() } })); return true; });
}
export function loadDraft(storage = globalThis.localStorage) {
  if (!storage) return { ok: false, value: null, error: "Local browser storage is unavailable." };
  return runStorage(() => { const raw = storage.getItem(DRAFT_STORAGE_KEY); return raw ? upgradeConfig(JSON.parse(raw)) : null; });
}
export function saveInstalledConfig(c, storage = globalThis.localStorage) {
  if (!storage) return { ok: false, error: "Local browser storage is unavailable." };
  if (!c?.installed) return { ok: false, error: "Only an installed configuration can be saved as the active workspace." };
  const errors = validateConfig(c);
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return runStorage(() => { storage.setItem(TENANT_STORAGE_KEY, JSON.stringify(c)); storage.removeItem(DRAFT_STORAGE_KEY); return true; });
}
export function loadInstalledConfig(storage = globalThis.localStorage) {
  if (!storage) return { ok: false, value: null, error: "Local browser storage is unavailable." };
  return runStorage(() => {
    const raw = storage.getItem(TENANT_STORAGE_KEY);
    if (!raw) return null;
    const c = upgradeConfig(JSON.parse(raw));
    if (!c.installed) return null;
    const errors = validateConfig(c);
    if (errors.length) throw new Error("Saved workspace is invalid: " + errors.join(" "));
    return c;
  });
}
