import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const moduleSource = await readFile(new URL("../src/installer.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/installer.css", import.meta.url), "utf8");
const workspace = await readFile(new URL("../src/workspace.js", import.meta.url), "utf8");
const workspaceCss = await readFile(new URL("../src/workspace.css", import.meta.url), "utf8");
const backup = await readFile(new URL("../src/domain/backup.js", import.meta.url), "utf8");
assert.match(html, /id=["']installerRoot["']/);
assert.match(html, /src=["']\.\/src\/installer\.js["']/);
assert.match(html, /href=["']\.\/src\/installer\.css["']/);
assert.match(moduleSource, /loadInstalledConfig/);
assert.match(moduleSource, /activateInstall/);
assert.match(moduleSource, /data-action="install"/);
assert.match(moduleSource, /saveDraft/);
assert.match(moduleSource, /exportConfig/);
assert.match(css, /@media\(max-width:700px\)/);
console.log("Installer integration smoke checks: PASS");

assert.match(html, /href=["\']\.\/src\/workspace\.css["\']/);
assert.match(moduleSource, /mountWorkspace/);
assert.match(workspace, /SAVE &amp; LOCK FOR TODAY/);
assert.match(workspace, /calculateWeekMetrics/);
assert.match(workspace, /generateReport/);
assert.match(workspaceCss, /@media print/);

assert.match(workspace, /function renderPlantOverview/);
assert.match(workspace, /data-station-status/);
assert.match(workspace, /data-station-operator/);
assert.match(workspaceCss, /workspace-station-grid/);

assert.match(workspace, /function renderPlantOverview/);
assert.match(workspace, /setStationStatus/);
assert.match(workspace, /assignStationOperator/);

assert.match(workspace, /async function restoreBackup/);
assert.match(workspace, /validateWorkspaceBackup/);
assert.match(workspace, /data-backup-file/);
assert.match(moduleSource, /onRestoreConfiguration/);
assert.match(backup, /restoreWorkspaceBackup/);

assert.match(workspace, /data-shift-start/);
assert.match(workspace, /save-shift-times/);
assert.match(workspace, /clear-shift-times/);
