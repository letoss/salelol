import { createClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

export async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function rateLimit(request: Request, scope: string, limit: number, windowSeconds: number) {
  const identifier = await hash(`${scope}:${clientAddress(request)}`);
  const { data, error } = await adminClient().rpc("consume_api_rate_limit", {
    rate_scope: scope, rate_identifier: identifier, rate_limit: limit, window_seconds: windowSeconds,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function validInvitation(code: unknown) {
  const expected = Deno.env.get("LOBBY_INVITE_TOKEN") || "";
  if (!expected || typeof code !== "string") return false;
  return await hash(code.trim()) === await hash(expected);
}

export function currentWeekStart() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Amsterdam", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(+value.year, +value.month - 1, +value.day));
  const reset = date.getUTCDay() === 0 && +value.hour === 23 && +value.minute >= 59;
  date.setUTCDate(date.getUTCDate() + (reset ? 1 : -((date.getUTCDay() + 6) % 7)));
  return date.toISOString().slice(0, 10);
}
