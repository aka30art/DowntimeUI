import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), "dist");
const exists = async path => access(resolve(dist, path)).then(() => true, () => false);

test("GitHub Pages root is the original YARDHUB application, not the generic installer", async () => {
  const entry = await readFile(resolve(dist, "index.html"), "utf8");
  assert.match(entry, /id="authGate"/);
  assert.match(entry, /id="yardHub"/);
  assert.match(entry, /id="launchDowntimeBtn"/);
  assert.match(entry, /id="yardhub-github-connect-overlay"/);
  assert.match(entry, /github-bootstrap\.js/);
  assert.doesNotMatch(entry, /installerRoot|src\/installer\.js|DOWNTIMEUI — Universal Operations/);
});

test("Published site includes GitHub infrastructure but excludes the generic installer bundle", async () => {
  assert.equal(await exists("src/infrastructure/github-data-store.js"), true);
  assert.equal(await exists("src/infrastructure/github-connection.js"), true);
  assert.equal(await exists("src/infrastructure/github-rpc-handlers.js"), true);
  assert.equal(await exists("src/installer.js"), false);
  assert.equal(await exists("src/installer.css"), false);
  assert.equal(await exists("src/workspace.js"), false);
  assert.equal(await exists("yardhub/runtime/index.html"), false);
});

test("Promoted YARDHUB entry has root-relative GitHub infrastructure imports", async () => {
  const bootstrap = await readFile(resolve(dist, "github-bootstrap.js"), "utf8");
  const edge = await readFile(resolve(dist, "github-edge-runtime.js"), "utf8");
  assert.match(bootstrap, /from ["']\.\/src\/infrastructure\/github-data-store\.js["']/);
  assert.match(edge, /from ["']\.\/src\/infrastructure\/github-rpc-handlers\.js["']/);
  assert.doesNotMatch(bootstrap, /\.\.\/\.\.\/src\/infrastructure/);
  assert.doesNotMatch(edge, /\.\.\/\.\.\/src\/infrastructure/);
});
