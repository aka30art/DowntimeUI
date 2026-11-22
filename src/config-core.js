/* DOWNTIMEUI universal tenant configuration core — no company-specific defaults */
export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  installed: false,
  identity: { companyName: "", logoDataUrl: "", locale: "en-GB", timezone: "" },
  site: { siteName: "", hierarchy: ["Area", "Station"], areas: [], stations: [] },
  downtime: { reasons: [] },
  schedule: { workDays: [], shifts: [], breaks: [] },
  staff: [],
  roles: [],
  dailyTasks: []
});
export function cloneDefaultConfig(){ return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") return ["Configuration must be an object."];
  if (!config.identity || !config.identity.companyName?.trim()) errors.push("Company name is required.");
  if (!config.site || !config.site.siteName?.trim()) errors.push("Site or plant name is required.");
  if (!Array.isArray(config.site?.areas)) errors.push("Areas must be a list.");
  if (!Array.isArray(config.site?.stations)) errors.push("Stations must be a list.");
  if (!Array.isArray(config.downtime?.reasons)) errors.push("Downtime reasons must be a list.");
  if (!Array.isArray(config.schedule?.workDays)) errors.push("Operating days must be a list.");
  if (!Array.isArray(config.schedule?.shifts)) errors.push("Shift definitions must be a list.");
  if (!Array.isArray(config.schedule?.breaks)) errors.push("Break definitions must be a list.");
  return errors;
}
export function createTenantConfig({ companyName, siteName, timezone, locale="en-GB" }) {
  const config = cloneDefaultConfig();
  config.identity.companyName = String(companyName || "").trim();
  config.identity.locale = locale;
  config.identity.timezone = String(timezone || "").trim();
  config.site.siteName = String(siteName || "").trim();
  return config;
}
export function activateInstall(config) {
  const errors = validateConfig(config);
  if (errors.length) return { ok:false, errors, config };
  return { ok:true, errors:[], config:{ ...config, installed:true, installedAt:new Date().toISOString() } };
}
