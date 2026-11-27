async function toBytes(file) {
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  if (typeof Blob !== "undefined" && file instanceof Blob) return new Uint8Array(await file.arrayBuffer());
  throw new TypeError("Storage upload requires a Blob, ArrayBuffer or Uint8Array.");
}

function makeTicketId() {
  return globalThis.crypto?.randomUUID?.() || ("ticket-" + Date.now() + "-" + Math.random().toString(36).slice(2));
}

export function createGitHubStorageClient({ store, now = () => new Date(), ticketLifetimeMs = 5 * 60 * 1000 } = {}) {
  if (!store || typeof store.uploadObject !== "function" || typeof store.downloadObject !== "function" || typeof store.deleteObject !== "function") {
    throw new TypeError("A GitHub data store with binary object methods is required.");
  }
  const tickets = new Map();

  function from(bucket) {
    const bucketName = String(bucket || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucketName)) throw new TypeError("Invalid GitHub storage bucket.");
    return Object.freeze({
      async upload(path, file, options = {}) {
        try {
          const data = await toBytes(file);
          const result = await store.uploadObject({
            bucket: bucketName, path, data,
            mimeType: options.contentType || file?.type || "application/octet-stream",
            upsert: options.upsert === true
          });
          return { data: { path: result.path, fullPath: bucketName + "/" + result.path, id: result.sha }, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },

      async createSignedUploadUrl(path, options = {}) {
        try {
          const ticket = createUploadTicket({
            bucket: bucketName, path,
            mimeType: options.contentType || "application/octet-stream",
            size: Number.isInteger(options.size) ? options.size : null
          });
          return { data: { path: ticket.path, token: ticket.token, signedUrl: ticket.token }, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },

      async uploadToSignedUrl(path, token, file, options = {}) {
        try {
          const ticket = tickets.get(String(token || ""));
          if (!ticket || ticket.bucket !== bucketName || ticket.path !== path || ticket.expiresAt <= now().getTime()) {
            throw new Error("Upload ticket is invalid or expired.");
          }
          tickets.delete(String(token));
          const data = await toBytes(file);
          if (ticket.size !== null && data.byteLength !== ticket.size) throw new Error("Uploaded file size does not match the prepared upload.");
          if (ticket.mimeType && options.contentType && ticket.mimeType !== options.contentType) throw new Error("Uploaded file type does not match the prepared upload.");
          const result = await store.uploadObject({
            bucket: bucketName, path, data,
            mimeType: options.contentType || ticket.mimeType || file?.type || "application/octet-stream",
            upsert: false
          });
          return { data: { path: result.path, fullPath: bucketName + "/" + result.path, id: result.sha }, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },

      async download(path) {
        try {
          const result = await store.downloadObject({ bucket: bucketName, path });
          const data = new Blob([result.bytes], { type: result.mimeType });
          return { data, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },

      async remove(paths) {
        try {
          const list = Array.isArray(paths) ? paths : [paths];
          const results = [];
          for (const path of list) results.push(await store.deleteObject({ bucket: bucketName, path }));
          return { data: results, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },

      async createSignedUrl(path) {
        try {
          const result = await store.downloadObject({ bucket: bucketName, path });
          const blob = new Blob([result.bytes], { type: result.mimeType });
          return { data: { signedUrl: URL.createObjectURL(blob), path }, error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
    });
  }

  return Object.freeze({
    from,
    createUploadTicket({ bucket, path, mimeType = "application/octet-stream", size = null } = {}) {
      const bucketName = String(bucket || "").trim();
      if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucketName)) throw new TypeError("Invalid GitHub storage bucket.");
      if (typeof path !== "string" || !path || path.split("/").some(segment => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment))) {
        throw new TypeError("Invalid GitHub storage object path.");
      }
      if (size !== null && (!Number.isInteger(size) || size < 1 || size > 10 * 1024 * 1024)) throw new TypeError("Invalid upload size.");
      const token = makeTicketId();
      tickets.set(token, {
        bucket: bucketName, path, mimeType, size,
        expiresAt: now().getTime() + ticketLifetimeMs
      });
      return { path, token, expiresAt: new Date(now().getTime() + ticketLifetimeMs).toISOString() };
    },
    clearExpiredTickets() {
      const timestamp = now().getTime();
      for (const [token, ticket] of tickets) if (ticket.expiresAt <= timestamp) tickets.delete(token);
      return tickets.size;
    }
  });
}
