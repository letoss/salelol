const config = window.SALELOL_CONFIG || {};
const enabled = Boolean(config.supabaseUrl && config.supabaseAnonKey);
const headers = {
  apikey: config.supabaseAnonKey,
  Authorization: `Bearer ${config.supabaseAnonKey}`,
  "Content-Type": "application/json"
};

function today() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Europe/Amsterdam", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function endpoint(table, query = "") {
  return `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}${query}`;
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error((await response.text()) || `Supabase error ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export const remoteStore = {
  enabled,
  async load() {
    if (!enabled) return null;
    const date = encodeURIComponent(today());
    const players = await request(endpoint("players", `?game_date=eq.${date}&select=name,slots,locked_in,joined_at&order=joined_at.asc`));
    return {
      date: today(),
      players: players.map(p => ({ name:p.name, slots:p.slots || [], lockedIn:Boolean(p.locked_in), joinedAt:new Date(p.joined_at).getTime() })),
      matches: []
    };
  },
  async join(name) {
    return request(endpoint("players", "?on_conflict=game_date,name"), {
      method:"POST", headers:{ Prefer:"resolution=ignore-duplicates,return=minimal" },
      body:JSON.stringify({ game_date:today(), name })
    });
  },
  async saveSlots(name, slots) {
    const date = encodeURIComponent(today());
    const player = encodeURIComponent(name);
    return request(endpoint("players", `?game_date=eq.${date}&name=eq.${player}`), {
      method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ slots })
    });
  },
  async setLocked(name, lockedIn) {
    const date = encodeURIComponent(today());
    const player = encodeURIComponent(name);
    return request(endpoint("players", `?game_date=eq.${date}&name=eq.${player}`), {
      method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ locked_in:lockedIn })
    });
  },
  async addMatch(match) {
    return request(endpoint("matches"), {
      method:"POST", headers:{ Prefer:"return=minimal" },
      body:JSON.stringify({ id:match.id, game_date:today(), match_time:match.time, creator:match.creator })
    });
  },
  async deleteMatch(id) {
    return request(endpoint("matches", `?id=eq.${encodeURIComponent(id)}&game_date=eq.${encodeURIComponent(today())}`), {
      method:"DELETE", headers:{ Prefer:"return=minimal" }
    });
  }
};
