import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

function currentWeekStart() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(+value.year, +value.month - 1, +value.day));
  const reset = date.getUTCDay() === 0 && +value.hour === 23 && +value.minute >= 59;
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() + (reset ? 1 : -daysSinceMonday));
  return date.toISOString().slice(0, 10);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const projectUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const refreshSecret = Deno.env.get("RIOT_REFRESH_SECRET")?.trim();
  const body = await request.json().catch(() => ({}));
  const hasServiceRole = request.headers.get("authorization") === `Bearer ${serviceRoleKey}`;
  const hasRefreshSecret = Boolean(refreshSecret && body.refreshSecret === refreshSecret);
  if (!hasServiceRole && !hasRefreshSecret) {
    return json({ error: "Invalid refresh secret" }, 403);
  }

  const supabase = createClient(projectUrl, serviceRoleKey);
  const { data: players, error } = await supabase
    .from("players")
    .select("name")
    .eq("game_date", currentWeekStart());

  if (error) return json({ error: error.message }, 500);

  const names = [...new Set((players || []).map((player) => String(player.name)))];
  const results: Array<Record<string, unknown>> = [];

  for (const riotId of names) {
    const separator = riotId.lastIndexOf("#");
    if (separator < 1) {
      results.push({ riotId, refreshed: false, error: "Invalid Riot ID format" });
      continue;
    }

    const response = await fetch(`${projectUrl}/functions/v1/riot-profile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        gameName: riotId.slice(0, separator),
        tagLine: riotId.slice(separator + 1),
        force: true,
        cascade: false,
      }),
    });

    const body = await response.json().catch(() => ({}));
    results.push(response.ok
      ? { riotId, refreshed: true, cachedAt: body.cachedAt }
      : { riotId, refreshed: false, status: response.status, error: body.error || "Refresh failed" });

    // Keep the fan-out gentle for Riot and Supabase per-trace limits.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  return json({
    week: currentWeekStart(),
    processed: results.length,
    refreshed: results.filter((result) => result.refreshed).length,
    failed: results.filter((result) => !result.refreshed).length,
    results,
  });
});
