import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../yardhub/runtime/yard-hub-structure.js", import.meta.url), "utf8");

assert.match(source, /'staff-management':'launchStaffManagementBtn'/,
  "Staff Management must remain a native application tile");
assert.match(source, /if\(\(entry\.kind\|\|'custom'\)==='custom'\|\|\(!nativeTargets\[entry\.kind\]&&submenus\.length\)\)\{/,
  "Published submenus must not intercept native application module launches");
assert.match(source, /function onGridClick\(event\)[\s\S]*?if\(\(entry\.kind\|\|'custom'\)==='custom'\|\|\(!nativeTargets\[entry\.kind\]&&submenus\.length\)\)/,
  "Only custom/non-native structure workspaces may replace the tile's native click action");

console.log("YARDHUB native module navigation tests passed.");
