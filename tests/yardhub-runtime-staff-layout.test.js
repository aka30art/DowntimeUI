import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runtime = await readFile(new URL("../yardhub/runtime/index.html", import.meta.url), "utf8");
const reference = await readFile(new URL("../yardhub/reference/index.html", import.meta.url), "utf8");

test("YARDHUB runtime STAFF workspace uses the shared YARD HUB administration header and return route", () => {
  assert.match(runtime, /<div id="settingsPanelStaff" class="settings-panel" hidden>[\s\S]*?<header class="yard-hub-settings-heading">[\s\S]*?<button id="staffBackToYardHub" type="button" class="yard-hub-back">/);
  assert.match(runtime, /\$\('backToYardHub'\)\?\.addEventListener\('click',returnToYardHub\);\$\('staffBackToYardHub'\)\?\.addEventListener\('click',returnToYardHub\)/);
  assert.match(runtime, /id="staffManagementBackBtn" type="button" class="yard-hub-secondary">‹ BACK TO STAFF MANAGEMENT/);
});

test("YARDHUB runtime STAFF toolbar and directory use the same responsive row system as USERS", () => {
  assert.match(runtime, /\.staff-directory-actions\{display:flex;align-items:center;justify-content:flex-start;gap:8px;flex-wrap:wrap;width:100%\}/);
  assert.match(runtime, /id="staffRosterList" class="yard-hub-users-list yard-hub-staff-list"/);
  assert.match(runtime, /function renderOperatorRosterAdmin\(\)\{[\s\S]*?row\.className='yard-hub-user-row yard-hub-staff-row'/);
  assert.match(runtime, /identity\.className='yard-hub-user-identity yard-hub-staff-identity'/);
  assert.match(runtime, /meta\.className='yard-hub-user-meta yard-hub-staff-meta'/);
  assert.match(runtime, /actions\.className='yard-hub-user-actions yard-hub-staff-actions'/);
});

test("immutable YARDHUB reference remains pinned to the original STAFF layout baseline", () => {
  assert.match(reference, /id="settingsPanelStaff" class="settings-panel" hidden>[\s\S]*?class="staff-roster-grid"/);
  assert.doesNotMatch(reference, /id="staffBackToYardHub"/);
  assert.match(runtime, /id="staffBackToYardHub"/);
});

console.log("PASS: YARDHUB runtime STAFF layout, responsive toolbar, dedicated return route and immutable reference baseline");
