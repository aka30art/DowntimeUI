import { createClient } from "npm:@supabase/supabase-js@2";

const expectedAccessCodeHash = "db8d92654226fd14a4a1f59e3fd563dd751fa8a6765a5a764c8762333a2b66bd";
const allowedOrigin = "https://aka30art.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    if (origin && origin !== allowedOrigin) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== allowedOrigin) return json({ error: "Origin not allowed" }, 403);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { access_code?: unknown };
  try { body = await request.json(); }
  catch { return json({ error: "Invalid request body" }, 400); }

  const accessCode = typeof body.access_code === "string" ? body.access_code : "";
  if (!accessCode || accessCode.length > 128) return json({ error: "Access denied" }, 401);
  const suppliedHash = await sha256Hex(accessCode);
  if (!constantTimeEqual(suppliedHash, expectedAccessCodeHash)) return json({ error: "Access denied" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json({ error: "Spectator service is not configured" }, 500);

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.from("downtime_shared_state")
    .select("payload, updated_at").eq("id", 1).maybeSingle();
  if (error) {
    console.error("Spectator read failed:", error.message);
    return json({ error: "Unable to read shared tracker state" }, 500);
  }
  return json({ payload: data?.payload ?? { weeks: {}, areas: [], reasons: [], archive: [] }, updated_at: data?.updated_at ?? null });
});
