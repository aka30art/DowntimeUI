import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("YARDHUB startup and real-repository acceptance do not invoke the retired two-system authority model", async () => {
  const paths = [
    "../yardhub/runtime/github-bootstrap.js",
    "../yardhub/runtime/github-edge-runtime.js",
    "../scripts/github-real-repository-acceptance.mjs"
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /ensureAuthority|readAuthority|beginPrimarySwitch|freezePrimarySwitch|completePrimarySwitch|cancelPrimarySwitch|DOWNTIMEUI-GITHUB/, path + " must stay on the standalone YARDHUB path");
  }
});

test("compiled Central Bank bootstrap binds DEV to the immutable ROOTS bootstrap UUID", async () => {
  const source = await readFile(new URL("../yardhub/runtime/functions/central-bank.js", import.meta.url), "utf8");
  assert.match(source, /downtime_roots_bootstrap/);
  assert.match(source, /userId\s*:\s*bootstrapIdentity\.user_id/);
  assert.match(source, /Immutable DEV bootstrap identity is unavailable/);
  assert.doesNotMatch(
    source,
    /bank\.users=\[\{username,displayName:username,tier:"OWNER"/
  );
});

test("compiled YARDHUB Edge bundles do not contain a live Supabase JavaScript client import", async () => {
  const names = [
    "central-bank", "central-config-admin", "gatelog-api", "photo-evidence",
    "repair-maintenance-api", "spectator-read", "yard-hub-settings-api"
  ];
  for (const name of names) {
    const source = await readFile(new URL("../yardhub/runtime/functions/" + name + ".js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']https:\/\/esm\.sh\/@supabase\/supabase-js/);
    assert.doesNotMatch(source, /import\s*\(\s*["']https:\/\/esm\.sh\/@supabase\/supabase-js/);
  }
});


test("active YARDHUB runtime assets cannot call the original Supabase project or use its publishable key", async () => {
  const paths = [
    "index.html",
    "central-bank-admin.html",
    "central-bank-client.js",
    "repair-maintenance.html",
    "repair-maintenance-app.js",
    "repair-maintenance-launch.js",
    "plant-overview-preview.html",
    "gatelog-app.js",
    "gatelog-day-management.js",
    "gatelog-settings.js",
    "yard-hub-settings.js"
  ];
  for (const path of paths) {
    const source = await readFile(new URL("../yardhub/runtime/" + path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /ygwfipksbbprqynvbklk\.supabase\.co/i, path + " must not reference the original Supabase project");
    assert.doesNotMatch(source, /sb_publishable_[A-Za-z0-9_-]+/, path + " must not contain the original publishable key");
    assert.doesNotMatch(source, /YARDHUB-INITIAL-SETUP/, path + " must not contain the retired fixed DEV bootstrap secret");
  }
});

test("Plant Overview iframe sends Central Bank requests through the connected parent GitHub runtime", async () => {
  const source = await readFile(new URL("../yardhub/runtime/plant-overview-preview.html", import.meta.url), "utf8");
  assert.match(source, /__YARDHUB_GITHUB_CONNECTED__\s*===\s*true/);
  assert.match(source, /parentGitHubFetch\(CENTRAL_API/);
  assert.doesNotMatch(source, /fetch\(CENTRAL_API/);
});
