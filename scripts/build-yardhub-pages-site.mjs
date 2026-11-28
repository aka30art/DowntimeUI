import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist");
const runtime = resolve(root, "yardhub/runtime");
const infrastructure = resolve(root, "src/infrastructure");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// Publish the preserved YARDHUB runtime as the actual Pages root.
// The generic DOWNTIMEUI installer is deliberately not copied into the site.
await cp(runtime, output, { recursive: true });
await mkdir(resolve(output, "src"), { recursive: true });
await cp(infrastructure, resolve(output, "src/infrastructure"), { recursive: true });

// The runtime normally lives at /yardhub/runtime and imports ../../src.
// Once promoted to the Pages root, those imports resolve from ./src instead.
for (const file of ["github-bootstrap.js", "github-edge-runtime.js"]) {
  const path = resolve(output, file);
  const source = await readFile(path, "utf8");
  const rewritten = source.replaceAll("../../src/infrastructure/", "./src/infrastructure/");
  if (rewritten === source || !rewritten.includes("./src/infrastructure/")) {
    throw new Error("Expected GitHub infrastructure imports were not rewritten in " + file);
  }
  await writeFile(path, rewritten, "utf8");
}

await writeFile(resolve(output, ".nojekyll"), "", "utf8");

const entry = await readFile(resolve(output, "index.html"), "utf8");
for (const marker of [
  'id="authGate"',
  'id="yardHub"',
  'id="yardhub-github-connect-overlay"',
  'github-bootstrap.js'
]) {
  if (!entry.includes(marker)) throw new Error("Published YARDHUB entry is missing required marker: " + marker);
}
if (entry.includes("src/installer.js") || entry.includes("installerRoot")) {
  throw new Error("The generic installer must not be included in the published YARDHUB entry.");
}

process.stdout.write("Built pure YARDHUB Pages site at dist/ (original application UI + GitHub-native data infrastructure; no generic installer).\\n");
