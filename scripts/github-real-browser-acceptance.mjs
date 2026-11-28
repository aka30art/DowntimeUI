import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const repository = String(process.env.YARDHUB_DATA_REPOSITORY || "").trim();
const token = String(process.env.YARDHUB_DATA_TOKEN || "").trim();
const branch = String(process.env.YARDHUB_DATA_BRANCH || "").trim();
if (!repository || !token) throw new Error("Real browser acceptance requires YARDHUB_DATA_REPOSITORY and YARDHUB_DATA_TOKEN.");
const [owner, repo, ...extra] = repository.split("/");
if (!owner || !repo || extra.length) throw new Error("YARDHUB_DATA_REPOSITORY must be owner/repo.");
if ((owner + "/" + repo).toLowerCase() === "aka30art/downtime" ||
    (owner + "/" + repo).toLowerCase() === "aka30art/downtimeui") {
  throw new Error("Protected DOWNTIME and application-source repositories are forbidden test targets.");
}

const root = path.resolve(".");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.resolve(root, "." + pathname);
    if (!file.startsWith(root + path.sep) && file !== root) throw new Error("Path outside workspace");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const contexts = [];
const probeId = "yardhub-browser-acceptance-" + globalThis.crypto.randomUUID();
const secondId = probeId + "-second";
const staleId = probeId + "-stale";
let committed = false;
let pageA, pageB;

try {
  for (let i = 0; i < 2; i += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    contexts.push(context);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.__acceptanceErrors = pageErrors;
    await page.goto("http://127.0.0.1:" + address.port + "/yardhub/runtime/index.html", { waitUntil: "networkidle" });
    await page.locator("#yardhub-github-connect-overlay").waitFor({ state: "visible" });
    await page.locator('#yardhub-github-connect-form [name="owner"]').fill(owner);
    await page.locator('#yardhub-github-connect-form [name="repo"]').fill(repo);
    await page.locator('#yardhub-github-connect-form [name="branch"]').fill(branch);
    await page.locator('#yardhub-github-connect-form [name="token"]').fill(token);
    await page.locator('#yardhub-github-connect-form [type="submit"]').click();
    try {
      await page.locator("#yardhub-github-connect-overlay").waitFor({ state: "hidden", timeout: 60000 });
    } catch {
      const connectionStatus = await page.locator("[data-yardhub-github-status]").textContent().catch(() => "");
      const authStatus = await page.locator("#authMsg").textContent().catch(() => "");
      throw new Error("Real browser profile " + (i + 1) + " could not connect to the private repository. Status: " + connectionStatus + "; auth: " + authStatus + "; browser errors: " + pageErrors.join(" | "));
    }
    await page.waitForFunction(() => window.YARDHUB_GITHUB_CONNECTED === true && !!window.YARDHUB_GITHUB_STORE, null, { timeout: 60000 });
    const status = await page.locator("[data-yardhub-github-status]").textContent();
    assert.match(status || "", /Connected to private GitHub data repository/i, "Each independent browser profile must establish a live private-repository connection.");
    if (i === 0) pageA = page;
    else pageB = page;
  }

  const baselineB = await pageB.evaluate(async () => {
    const result = await window.YARDHUB_GITHUB_STORE.readDatabase();
    return { revision: result.revision, offline: result.offline, tableCount: Object.keys(result.tables).length };
  });
  assert.equal(baselineB.offline, false, "Browser profile B must read the live repository, not its offline cache.");
  assert.equal(baselineB.tableCount, 39, "Browser profile B must receive all 39 YARDHUB tables.");

  const firstCommit = await pageA.evaluate(async id => {
    const store = window.YARDHUB_GITHUB_STORE;
    let lastError = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = await store.readDatabase();
      try {
        const result = await store.transactDatabase({
          expectedRevision: current.revision,
          actorId: "REAL-BROWSER-ACCEPTANCE",
          operationId: id + "-write-a-" + attempt,
          mutate(tables) {
            tables.downtime_reports ||= [];
            if (!tables.downtime_reports.some(row => row.id === id)) {
              tables.downtime_reports.push({ id, title: "Temporary two-browser refresh probe", created_at: new Date().toISOString() });
            }
          }
        });
        return { revision: result.revision };
      } catch (error) {
        lastError = error;
        if (error?.status !== 409 || attempt === 11) {
          throw new Error("Browser A probe commit failed after " + (attempt + 1) + " attempts; last conflict: " + (error?.message || String(error)));
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(500 * (2 ** attempt), 4000)));
      }
    }
    throw lastError || new Error("Browser A could not commit its probe record.");
  }, probeId);
  committed = true;

  await pageB.evaluate(() => {
    window.__yardhubRefreshEvent = null;
    window.addEventListener("yardhub:shared-data-refreshed", event => {
      window.__yardhubRefreshEvent = event.detail || {};
    }, { once: true });
  });
  const refreshed = await pageB.evaluate(async () => {
    const result = await window.YARDHUB_GITHUB_REFRESH();
    return { revision: result.revision, offline: result.offline };
  });
  assert.equal(refreshed.offline, false, "Manual browser refresh must retrieve live GitHub state.");
  assert.ok(refreshed.revision >= baselineB.revision, "Manual refresh must not return an older database revision.");
  const visibleOnB = await pageB.evaluate(async id => {
    const result = await window.YARDHUB_GITHUB_STORE.readDatabase();
    return result.tables.downtime_reports.some(row => row.id === id);
  }, probeId);
  assert.equal(visibleOnB, true, "A real independent browser profile must see browser A's committed record after manual refresh.");
  for (const page of [pageA, pageB]) {
    assert.deepEqual(page.__acceptanceErrors, [], "YARDHUB browser runtime errors: " + page.__acceptanceErrors.join(" | "));
  }

  const staleBaseline = await pageB.evaluate(async () => {
    const result = await window.YARDHUB_GITHUB_STORE.readDatabase();
    return result.revision;
  });
  await pageA.evaluate(async id => {
    const store = window.YARDHUB_GITHUB_STORE;
    const current = await store.readDatabase();
    await store.transactDatabase({
      expectedRevision: current.revision,
      actorId: "REAL-BROWSER-ACCEPTANCE",
      operationId: id + "-write-a-second",
      mutate(tables) { tables.downtime_reports.push({ id, title: "Temporary concurrent conflict probe" }); }
    });
  }, secondId);
  let staleStatus = null;
  try {
    await pageB.evaluate(async ({ id, expectedRevision }) => {
      await window.YARDHUB_GITHUB_STORE.transactDatabase({
        expectedRevision,
        actorId: "REAL-BROWSER-ACCEPTANCE",
        operationId: id + "-stale-write-b",
        mutate(tables) { tables.downtime_reports.push({ id, title: "Must never commit" }); }
      });
    }, { id: staleId, expectedRevision: staleBaseline });
  } catch (error) {
    staleStatus = await pageB.evaluate(() => {
      const match = String(window.__lastYardhubError || "").match(/409/);
      return match ? 409 : null;
    }).catch(() => null);
    if (!staleStatus && /409|revision changed|conflict/i.test(String(error))) staleStatus = 409;
  }
  assert.equal(staleStatus, 409, "A stale write from the independent browser profile must be rejected with a conflict.");
  const staleRecordPresent = await pageA.evaluate(async id => {
    const result = await window.YARDHUB_GITHUB_STORE.readDatabase();
    return result.tables.downtime_reports.some(row => row.id === id);
  }, staleId);
  assert.equal(staleRecordPresent, false, "The stale browser write must not appear in central GitHub data.");

  console.log("PASS: two independent Chromium browser profiles connected to the real private YARDHUB repository; browser A commit became visible to browser B after manual refresh; stale browser B write was rejected.");
} finally {
  if (committed && pageA) {
    try {
      await pageA.evaluate(async ids => {
        const store = window.YARDHUB_GITHUB_STORE;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const latest = await store.readDatabase();
          try {
            await store.transactDatabase({
              expectedRevision: latest.revision,
              actorId: "REAL-BROWSER-ACCEPTANCE-CLEANUP",
              operationId: ids[0] + "-cleanup-" + attempt,
              mutate(tables) {
                tables.downtime_reports = (tables.downtime_reports || []).filter(row => !ids.includes(row.id));
              }
            });
            return true;
          } catch (error) {
            if (error?.status !== 409 || attempt === 2) throw error;
          }
        }
        return false;
      }, [probeId, secondId, staleId]);
    } catch (error) {
      console.error("CRITICAL: browser acceptance cleanup failed. Temporary test record IDs:", probeId, secondId, "Error:", error?.message || String(error));
      throw error;
    }
  }
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
