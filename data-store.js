const config = window.SALELOL_CONFIG || {};
const enabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const headers = { apikey:config.supabaseAnonKey, Authorization:`Bearer ${config.supabaseAnonKey}`, "Content-Type":"application/json" };

function weekStart() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Amsterdam", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(+value.year, +value.month - 1, +value.day));
  const reset = date.getUTCDay() === 0 && +value.hour === 23 && +value.minute >= 59;
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() + (reset ? 1 : -daysSinceMonday));
  return date.toISOString().slice(0, 10);
}
function endpoint(table, query = "") { return `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}${query}`; }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers:{ ...headers, ...options.headers } });
  if (!response.ok) { const error=new Error((await response.text())||`Supabase error ${response.status}`);error.status=response.status;throw error; }
  return response.status === 204 ? null : response.json();
}
export const remoteStore = {
  enabled,
  async load() {
    if (!enabled) return null;
    const week = encodeURIComponent(weekStart());
    const players = await request(endpoint("players", `?game_date=eq.${week}&select=name,slots,joined_at&order=joined_at.asc`));
    let profiles = [];
    try { profiles = await request(endpoint("riot_profiles", "?select=riot_id,profile_icon_url,rank_tier,rank_display,recent_games,recent_match_summaries")); }
    catch (error) {
      console.warn("Recent match summaries are not configured yet; loading basic profiles", error);
      try { profiles = await request(endpoint("riot_profiles", "?select=riot_id,profile_icon_url,rank_tier,rank_display,recent_games")); }
      catch (fallbackError) { console.warn("Riot profiles are not configured yet", fallbackError); }
    }
    const byId = new Map(profiles.map(profile => [profile.riot_id.toLowerCase(), profile]));
    return { date:weekStart(), players:players.map(player => {
      const profile = byId.get(player.name.toLowerCase());
      return {
        name:player.name, slots:player.slots || [],
        joinedAt:new Date(player.joined_at).getTime(), profileIconUrl:profile?.profile_icon_url,
        rankTier:profile?.rank_tier, rankDisplay:profile?.rank_display,
        recentGames:profile?.recent_games || [],
        recentMatchSummaries:profile?.recent_match_summaries || []
      };
    }), sharedGames:await this.loadSharedGames() };
  },
  async loadSharedGames() {
    if (!enabled) return [];
    const cutoff = encodeURIComponent(new Date(Date.now()-30*24*60*60*1000).toISOString());
    try { return await request(endpoint("shared_matches", `?select=match_id,game_start,duration_seconds,queue_id,teams,shared_player_count&game_start=gte.${cutoff}&order=game_start.desc`)); }
    catch (error) { console.warn("Shared matches are not configured yet", error); return []; }
  },
  async invoke(functionName, body) {
    if (!enabled) return null;
    return request(`${config.supabaseUrl.replace(/\/$/, "")}/functions/v1/${functionName}`, { method:"POST", body:JSON.stringify(body) });
  },
  async join(name, invitationCode, ownerToken) {
    return this.invoke("lobby-join", { name, invitationCode, ownerToken });
  },
  async saveSlots(name, slots, ownerToken) { return this.invoke("lobby-update", { name, slots, ownerToken }); },
  async fetchRiotProfile(gameName, tagLine, invitationCode) { return this.invoke("riot-profile", { gameName, tagLine, invitationCode }); },
  async fetchClashSchedule(invitationCode) { return this.invoke("clash-schedule", { invitationCode }); }
};
