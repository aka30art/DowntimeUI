import fs from "node:fs";
import assert from "node:assert/strict";

const source=fs.readFileSync(new URL("../yardhub/runtime/yard-hub-settings.js",import.meta.url),"utf8");
const start=source.indexOf("  async function openSettings(){");
const end=source.indexOf("\n  async function openStaffUserManagement()",start);
assert.ok(start>=0&&end>start,"Staff Management launcher must exist");
const launcher=source.slice(start,end);
assert.ok(launcher.indexOf("await loadState();")>launcher.indexOf("await configureButton();"),
  "Authoritative GitHub-backed settings state must load before access is evaluated");
assert.ok(!launcher.includes("!access?.canManageSettings"),
  "Legacy canManageSettings probe must not block Staff Management in GitHub mode");
assert.ok(launcher.includes("state?.canViewStaffUsers===true"),"Staff VIEW permission must grant module access");
assert.ok(launcher.includes("state?.canManageStaffUsers===true"),"Staff MANAGE permission must grant module access");
assert.ok(launcher.includes("isProtectedRoot()"),"Protected ROOTS identities must retain access");
console.log("YARDHUB Staff Management GitHub access tests passed");
