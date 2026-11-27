import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("compiled Central Bank bootstrap binds DEV to the immutable ROOTS bootstrap UUID", async () => {
  const source = await readFile(new URL("../yardhub/runtime/functions/central-bank.js", import.meta.url), "utf8");
  assert.match(source, /downtime_roots_bootstrap/);
  assert.match(source, /userId:bootstrapIdentity\.user_id/);
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
