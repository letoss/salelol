const config = window.SALELOL_CONFIG || {};
const enabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const headers = { apikey:config.supabaseAnonKey, Authorization:`Bearer ${config.supabaseAnonKey}`, "Content-Type":"application/json" };

function weekStart() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Amsterdam", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(+value.year, +value.month - 1, +value.day));
  const reset = date.getUTCDay() === 6 && +value.hour === 23 && +value.minute >= 59;
  date.setUTCDate(date.getUTCDate() + (reset ? 1 : -date.getUTCDay()));
  return date.toISOString().slice(0, 10);
}
function endpoint(table, query = "") { return `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}${query}`; }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers:{ ...headers, ...options.headers } });
  if (!response.ok) throw new Error((await response.text()) || `Supabase error ${response.status}`);
  return response.status === 204 ? null : response.json();
}
export const remoteStore = {
  enabled,
  async load() {
    if (!enabled) return null;
    const week = encodeURIComponent(weekStart());
    const players = await request(endpoint("players", `?game_date=eq.${week}&select=name,slots,locked_in,joined_at&order=joined_at.asc`));
    return { date:weekStart(), players:players.map(player => ({ name:player.name, slots:player.slots || [], lockedIn:Boolean(player.locked_in), joinedAt:new Date(player.joined_at).getTime() })) };
  },
  async join(name) {
    return request(endpoint("players", "?on_conflict=game_date,name"), { method:"POST", headers:{ Prefer:"resolution=ignore-duplicates,return=minimal" }, body:JSON.stringify({ game_date:weekStart(), name }) });
  },
  async saveSlots(name, slots) { return this.update(name, { slots }); },
  async setLocked(name, lockedIn) { return this.update(name, { locked_in:lockedIn }); },
  async update(name, body) {
    const week = encodeURIComponent(weekStart());
    return request(endpoint("players", `?game_date=eq.${week}&name=eq.${encodeURIComponent(name)}`), { method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify(body) });
  }
};
