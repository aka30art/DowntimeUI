import test from "node:test";
import assert from "node:assert/strict";
import { createGitHubStorageClient } from "../src/infrastructure/github-storage-client.js";

function makeStore() {
  const objects = new Map();
  return {
    async uploadObject(input) {
      if (objects.has(input.bucket + "/" + input.path) && !input.upsert) throw new Error("Object exists.");
      const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
      objects.set(input.bucket + "/" + input.path, { bytes: new Uint8Array(bytes), mimeType: input.mimeType });
      return { path: input.path, sha: "blob-test" };
    },
    async downloadObject({ bucket, path }) {
      const item = objects.get(bucket + "/" + path);
      if (!item) { const error = new Error("Missing"); error.status = 404; throw error; }
      return { bytes: new Uint8Array(item.bytes), mimeType: item.mimeType };
    },
    async deleteObject({ bucket, path }) {
      const key = bucket + "/" + path;
      const deleted = objects.delete(key);
      return { deleted, bucket, path };
    }
  };
}

test("GitHub storage adapter uploads and downloads a PDF Blob", async () => {
  const client = createGitHubStorageClient({ store: makeStore() });
  const pdf = new Blob([new Uint8Array([37, 80, 68, 70, 45, 49])], { type: "application/pdf" });
  const uploaded = await client.from("downtime-pdfs").upload("week/report.pdf", pdf, { contentType: "application/pdf" });
  assert.equal(uploaded.error, null);
  assert.equal(uploaded.data.path, "week/report.pdf");
  const downloaded = await client.from("downtime-pdfs").download("week/report.pdf");
  assert.equal(downloaded.error, null);
  assert.equal(downloaded.data.type, "application/pdf");
  assert.deepEqual([...new Uint8Array(await downloaded.data.arrayBuffer())], [37, 80, 68, 70, 45, 49]);
});

test("GitHub storage adapter creates one-time, size-bound upload tickets", async () => {
  let timestamp = 1000;
  const client = createGitHubStorageClient({ store: makeStore(), now: () => new Date(timestamp) });
  const ticket = client.createUploadTicket({
    bucket: "downtime-evidence", path: "2026-11-27/evidence.jpg",
    mimeType: "image/jpeg", size: 4
  });
  const storage = client.from("downtime-evidence");
  const uploaded = await storage.uploadToSignedUrl(ticket.path, ticket.token, new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }), { contentType: "image/jpeg" });
  assert.equal(uploaded.error, null);
  const replay = await storage.uploadToSignedUrl(ticket.path, ticket.token, new Blob([new Uint8Array([1, 2, 3, 4])]), { contentType: "image/jpeg" });
  assert.match(replay.error.message, /invalid or expired/);
});

test("GitHub storage adapter rejects expired tickets, mismatched size and unsafe paths", async () => {
  let timestamp = 1000;
  const client = createGitHubStorageClient({ store: makeStore(), now: () => new Date(timestamp), ticketLifetimeMs: 100 });
  const ticket = client.createUploadTicket({ bucket: "downtime-evidence", path: "record/photo.jpg", mimeType: "image/jpeg", size: 3 });
  timestamp += 101;
  const expired = await client.from("downtime-evidence").uploadToSignedUrl(ticket.path, ticket.token, new Blob([new Uint8Array([1, 2, 3])]), { contentType: "image/jpeg" });
  assert.match(expired.error.message, /invalid or expired/);
  assert.throws(() => client.createUploadTicket({ bucket: "downtime-evidence", path: "../photo.jpg" }), /path/);
  const mismatch = client.createUploadTicket({ bucket: "downtime-evidence", path: "record/photo2.jpg", mimeType: "image/jpeg", size: 4 });
  const result = await client.from("downtime-evidence").uploadToSignedUrl(mismatch.path, mismatch.token, new Blob([new Uint8Array([1, 2, 3])]), { contentType: "image/jpeg" });
  assert.match(result.error.message, /size/);
});

test("GitHub storage adapter removes only requested objects", async () => {
  const client = createGitHubStorageClient({ store: makeStore() });
  const storage = client.from("downtime-pdfs");
  await storage.upload("one.pdf", new Blob(["one"], { type: "application/pdf" }));
  await storage.upload("two.pdf", new Blob(["two"], { type: "application/pdf" }));
  const removed = await storage.remove(["one.pdf"]);
  assert.equal(removed.error, null);
  assert.equal(removed.data[0].deleted, true);
  assert.equal((await storage.download("two.pdf")).error, null);
  assert.equal((await storage.download("one.pdf")).error.status, 404);
});
