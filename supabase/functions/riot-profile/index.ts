import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const tiers = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const divisions: Record<string, number> = { IV: 1, III: 2, II: 3, I: 4 };

class RiotError extends Error {
  constructor(public status: number) { super(`Riot API returned ${status}`); }
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}
function publicProfile(row: Record<string, unknown>) {
  return {
    riotId: row.riot_id,
    profileIconUrl: row.profile_icon_url,
    rankTier: row.rank_tier,
    rankDisplay: row.rank_display,
    queue: row.ranked_queue,
    recentGames: row.recent_games || [],
    cachedAt: row.refreshed_at,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { gameName, tagLine } = await request.json();
    if (typeof gameName !== "string" || gameName.trim().length < 3 || typeof tagLine !== "string" || !/^[a-zA-Z0-9]{3,5}$/.test(tagLine.trim())) {
      return json({ error: "A valid GameName and Tag are required" }, 400);
    }

    const riotKey = Deno.env.get("RIOT_API_KEY");
    if (!riotKey) return json({ error: "RIOT_API_KEY has not been configured" }, 500);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const requestedId = `${gameName.trim()}#${tagLine.trim()}`;
    const normalized = requestedId.toLocaleLowerCase();

    const { data: cached } = await supabase.from("riot_profiles").select("*").eq("riot_id_normalized", normalized).maybeSingle();
    if (cached && Date.now() - new Date(cached.refreshed_at).getTime() < 30 * 60 * 1000) return json(publicProfile(cached));

    const riot = async (url: string) => {
      const response = await fetch(url, { headers: { "X-Riot-Token": riotKey } });
      if (!response.ok) throw new RiotError(response.status);
      return response.json();
    };
    const encodedName = encodeURIComponent(gameName.trim());
    const encodedTag = encodeURIComponent(tagLine.trim());
    const account = await riot(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`);
    const summoner = await riot(`https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`);
    const entries = await riot(`https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/${encodeURIComponent(summoner.id)}`);
    const ranked = entries.filter((entry: Record<string, unknown>) => entry.queueType === "RANKED_SOLO_5x5" || entry.queueType === "RANKED_FLEX_SR");
    const score = (entry: Record<string, unknown>) => tiers.indexOf(String(entry.tier)) * 10 + (divisions[String(entry.rank)] || 0);
    const highest = ranked.sort((a: Record<string, unknown>, b: Record<string, unknown>) => score(b) - score(a))[0];

    const matchIds = await riot(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=5`);
    const matches = await Promise.allSettled(matchIds.map((id: string) => riot(`https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(id)}`)));
    const recentGames = matches.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      const participant = result.value.info?.participants?.find((item: Record<string, unknown>) => item.puuid === account.puuid);
      return participant ? [Boolean(participant.win)] : [];
    });

    const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
    const canonicalId = `${account.gameName}#${account.tagLine}`;
    const row = {
      riot_id_normalized: normalized,
      riot_id: canonicalId,
      puuid: account.puuid,
      profile_icon_url: `https://ddragon.leagueoflegends.com/cdn/${versions[0]}/img/profileicon/${summoner.profileIconId}.png`,
      rank_tier: highest?.tier || null,
      rank_display: highest ? `${highest.tier} ${highest.rank}` : null,
      ranked_queue: highest?.queueType || null,
      recent_games: recentGames,
      refreshed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("riot_profiles").upsert(row, { onConflict: "riot_id_normalized" });
    if (error) console.error("Cache write failed", error);
    return json(publicProfile(row));
  } catch (error) {
    console.error(error);
    if (error instanceof RiotError) {
      if (error.status === 404) return json({ error: "Riot ID not found on EUW" }, 404);
      if (error.status === 401 || error.status === 403) return json({ error: "Riot API key is invalid or expired" }, 502);
      if (error.status === 429) return json({ error: "Riot API rate limit reached" }, 429);
    }
    return json({ error: "Unable to load Riot profile" }, 500);
  }
});
