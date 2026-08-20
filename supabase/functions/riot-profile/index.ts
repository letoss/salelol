import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const adminClient=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function rateLimit(request:Request,scope:string,limit:number,windowSeconds:number){const address=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";const identifier=await hash(`${scope}:${address}`);const {data,error}=await adminClient().rpc("consume_api_rate_limit",{rate_scope:scope,rate_identifier:identifier,rate_limit:limit,window_seconds:windowSeconds});if(error)throw error;return Boolean(data);}
async function validInvitation(code:unknown){const expected=Deno.env.get("LOBBY_INVITE_TOKEN")||"";return Boolean(expected&&typeof code==="string"&&await hash(code.trim())===await hash(expected));}
function currentWeekStart(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(Date.UTC(+value.year,+value.month-1,+value.day));const reset=date.getUTCDay()===0&&+value.hour===23&&+value.minute>=59;const daysSinceMonday=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()+(reset?1:-daysSinceMonday));return date.toISOString().slice(0,10);}
const tiers = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
const divisions: Record<string, number> = { IV: 1, III: 2, II: 3, I: 4 };
const MATCH_RETENTION_DAYS = 30;

class RiotError extends Error {
  constructor(
    public status: number,
    public stage: string,
    public riotMessage: string,
  ) {
    super(`Riot API returned ${status} during ${stage}`);
  }
}
function publicProfile(row: Record<string, unknown>) {
  return {
    riotId: row.riot_id,
    profileIconUrl: row.profile_icon_url,
    rankTier: row.rank_tier,
    rankDisplay: row.rank_display,
    queue: row.ranked_queue,
    recentGames: row.recent_games || [],
    recentMatchSummaries: row.recent_match_summaries || [],
    cachedAt: row.refreshed_at,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let keyFormatValid = false;
  try {
    const { gameName, tagLine, invitationCode, cascade = true, history = true } = await request.json();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const canForce = request.headers.get("authorization") === `Bearer ${serviceRoleKey}`;
    if (!canForce) {
      if (!await rateLimit(request, "riot-profile", 10, 60)) return json({ error:"Too many profile lookups" }, 429);
      if (!await validInvitation(invitationCode)) return json({ error:"Invalid invitation" }, 403);
    }
    if (typeof gameName !== "string" || gameName.trim().length < 3 || typeof tagLine !== "string" || !/^[a-zA-Z0-9]{3,5}$/.test(tagLine.trim())) {
      return json({ error: "A valid GameName and Tag are required" }, 400);
    }

    const riotKey = Deno.env.get("RIOT_API_KEY")?.trim();
    if (!riotKey) return json({ error: "RIOT_API_KEY has not been configured" }, 500);
    keyFormatValid = riotKey.startsWith("RGAPI-") && riotKey.length > 20;
    const supabase = adminClient();
    const requestedId = `${gameName.trim()}#${tagLine.trim()}`;
    const normalized = requestedId.toLocaleLowerCase();

    const riot = async (stage: string, url: string) => {
      const response = await fetch(url, { headers: { "X-Riot-Token": riotKey } });
      if (!response.ok) {
        const riotMessage = (await response.text()).slice(0, 500);
        throw new RiotError(response.status, stage, riotMessage);
      }
      return response.json();
    };
    const encodedName = encodeURIComponent(gameName.trim());
    const encodedTag = encodeURIComponent(tagLine.trim());
    const account = await riot("account", `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`);
    const summoner = await riot("summoner", `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`);
    const entries = await riot("league", `https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`);
    const ranked = entries.filter((entry: Record<string, unknown>) => entry.queueType === "RANKED_SOLO_5x5" || entry.queueType === "RANKED_FLEX_SR");
    const score = (entry: Record<string, unknown>) => tiers.indexOf(String(entry.tier)) * 10 + (divisions[String(entry.rank)] || 0);
    const highest = ranked.sort((a: Record<string, unknown>, b: Record<string, unknown>) => score(b) - score(a))[0];

    const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
    const dataDragonVersion = versions[0];
    const canonicalId = `${account.gameName}#${account.tagLine}`;
    const retentionCutoff = new Date(Date.now() - MATCH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const historyQuery = history === false ? "start=0&count=10" : `startTime=${Math.floor(retentionCutoff.getTime()/1000)}&start=0&count=95`;
    const matchIds = await riot("match-list", `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?${historyQuery}`);
    const matches: PromiseSettledResult<Record<string, any>>[] = [];
    for (let offset = 0; offset < matchIds.length; offset += 10) {
      const batch = await Promise.allSettled(matchIds.slice(offset, offset + 10).map((id: string) => riot("match-detail", `https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(id)}`)));
      matches.push(...batch);
      if (offset + 10 < matchIds.length) await new Promise((resolve) => setTimeout(resolve, 550));
    }
    const recentMatchSummaries = matches.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      const info = result.value.info;
      const participants = Array.isArray(info?.participants) ? info.participants : [];
      const participant = participants.find((item: Record<string, unknown>) => item.puuid === account.puuid);
      if (!participant) return [];
      const teamId = Number(participant.teamId);
      const killsForTeam = (id: number) => participants
        .filter((item: Record<string, unknown>) => Number(item.teamId) === id)
        .reduce((total: number, item: Record<string, unknown>) => total + Number(item.kills || 0), 0);
      const opponent = participants.find((item: Record<string, unknown>) => Number(item.teamId) !== teamId);
      return [{
        matchId: String(result.value.metadata?.matchId || ""),
        gameCreation: Number(info?.gameCreation || 0),
        teamId,
        win: Boolean(participant.win),
        championName: String(participant.championName || ""),
        kills: Number(participant.kills || 0),
        deaths: Number(participant.deaths || 0),
        assists: Number(participant.assists || 0),
        teamKills: killsForTeam(teamId),
        opponentKills: opponent ? killsForTeam(Number(opponent.teamId)) : 0,
      }];
    }).filter((match) => match.matchId).slice(0, 10);
    const recentGames = recentMatchSummaries.map((match) => match.win);

    const row = {
      riot_id_normalized: normalized,
      riot_id: canonicalId,
      puuid: account.puuid,
      profile_icon_url: `https://ddragon.leagueoflegends.com/cdn/${dataDragonVersion}/img/profileicon/${summoner.profileIconId}.png`,
      rank_tier: highest?.tier || null,
      rank_display: highest ? `${highest.tier} ${highest.rank}` : null,
      ranked_queue: highest?.queueType || null,
      recent_games: recentGames,
      recent_match_summaries: recentMatchSummaries,
      refreshed_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("riot_profiles").upsert(row, { onConflict: "riot_id_normalized" });
    if (error) console.error("Cache write failed", error);

    if (cascade !== false) {
      const latestResult = matches.find((result) => result.status === "fulfilled");
      const latestParticipants = latestResult?.status === "fulfilled" && Array.isArray(latestResult.value.info?.participants)
        ? latestResult.value.info.participants
        : [];
      const me = latestParticipants.find((participant: Record<string, unknown>) => participant.puuid === account.puuid);
      const teammatePuuids = new Set(latestParticipants
        .filter((participant: Record<string, unknown>) => participant.puuid !== account.puuid && participant.teamId === me?.teamId)
        .map((participant: Record<string, unknown>) => String(participant.puuid)));

      if (teammatePuuids.size) {
        const { data: registeredPlayers } = await supabase.from("players").select("name").eq("game_date", currentWeekStart());
        const registeredIds = [...new Set((registeredPlayers || []).map((player) => String(player.name).toLocaleLowerCase()))];
        if (registeredIds.length) {
          const { data: registeredProfiles } = await supabase.from("riot_profiles").select("riot_id,puuid").in("riot_id_normalized", registeredIds);
          const teammates = (registeredProfiles || []).filter((profile) => teammatePuuids.has(String(profile.puuid)));
          const projectUrl = Deno.env.get("SUPABASE_URL")!;
          await Promise.allSettled(teammates.map(async (profile) => {
            const riotId = String(profile.riot_id);
            const separator = riotId.lastIndexOf("#");
            if (separator < 1) return;
            const response = await fetch(`${projectUrl}/functions/v1/riot-profile`, {
              method: "POST",
              headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, "Content-Type": "application/json" },
              body: JSON.stringify({ gameName: riotId.slice(0, separator), tagLine: riotId.slice(separator + 1), cascade: false, history: false }),
            });
            if (!response.ok) console.error("Teammate refresh failed", riotId, response.status, await response.text());
          }));
        }
      }
    }

    const { data: registeredProfiles, error: profilesError } = await supabase.from("riot_profiles").select("riot_id,puuid");
    if (profilesError) console.error("Registered profiles lookup failed", profilesError);
    const registeredByPuuid = new Map((registeredProfiles || []).map((profile) => [profile.puuid, profile.riot_id]));
    registeredByPuuid.set(account.puuid, canonicalId);
    const sharedMatches = matches.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      const match = result.value;
      const participants = Array.isArray(match.info?.participants) ? match.info.participants : [];
      const sharedPlayerCount = participants.filter((participant: Record<string, unknown>) => registeredByPuuid.has(String(participant.puuid))).length;
      if (sharedPlayerCount < 2) return [];
      const teams = [100, 200].map((teamId) => {
        const players = participants.filter((participant: Record<string, unknown>) => participant.teamId === teamId).map((participant: Record<string, unknown>) => {
          const knownRiotId = registeredByPuuid.get(String(participant.puuid));
          const riotId = knownRiotId || [participant.riotIdGameName, participant.riotIdTagline].filter(Boolean).join("#") || participant.summonerName || "Desconocido";
          return {
            riotId,
            championName: participant.championName,
            championIconUrl: `https://ddragon.leagueoflegends.com/cdn/${dataDragonVersion}/img/champion/${encodeURIComponent(String(participant.championName))}.png`,
            kills: participant.kills || 0,
            deaths: participant.deaths || 0,
            assists: participant.assists || 0,
            win: Boolean(participant.win),
            isOurBoy: Boolean(knownRiotId),
          };
        });
        return { teamId, win:Boolean(players[0]?.win), kills:players.reduce((sum:number, player) => sum + Number(player.kills || 0), 0), players };
      });
      return [{
        match_id: match.metadata?.matchId,
        game_start: new Date(match.info?.gameStartTimestamp || Date.now()).toISOString(),
        duration_seconds: match.info?.gameDuration || 0,
        queue_id: match.info?.queueId || null,
        teams,
        shared_player_count: sharedPlayerCount,
        refreshed_at: new Date().toISOString(),
      }];
    });
    if (sharedMatches.length) {
      const { error:matchesError } = await supabase.from("shared_matches").upsert(sharedMatches, { onConflict:"match_id" });
      if (matchesError) console.error("Shared match cache write failed", matchesError);
    }
    const { error:cleanupError } = await supabase.from("shared_matches").delete().lt("game_start", retentionCutoff.toISOString());
    if (cleanupError) console.error("Shared match retention cleanup failed", cleanupError);
    return json(publicProfile(row));
  } catch (error) {
    console.error(error);
    if (error instanceof RiotError) {
      const diagnostic = {
        stage: error.stage,
        riotStatus: error.status,
        riotMessage: error.riotMessage || null,
        keyFormatValid,
      };
      if (error.status === 404) return json({ error: "Riot resource not found", ...diagnostic }, 404);
      if (error.status === 401 || error.status === 403) return json({ error: "Riot request was rejected", ...diagnostic }, 502);
      if (error.status === 429) return json({ error: "Riot API rate limit reached" }, 429);
    }
    return json({ error: "Unable to load Riot profile" }, 500);
  }
});
