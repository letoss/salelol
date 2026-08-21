# Sale LoL?

Invitación interactiva para organizar partidas de League of Legends.

## Ejecutar localmente

Abrí `index.html` o serví la carpeta con `python -m http.server 8000`.

## Configurar la lobby compartida

1. Creá un proyecto de Supabase.
2. Ejecutá `supabase.sql` desde **SQL Editor**.
3. Copiá el Project URL y la publishable key (o legacy `anon` key) desde **Project Settings > API**.
4. Pegá esos dos valores en `config.js`. Nunca uses la secret key ni `service_role`.

La página sincroniza la lobby cada cinco segundos. Sin configuración, usa `localStorage` como respaldo local.

The lobby stores a full Monday-to-Sunday schedule and rolls into the next week every Sunday at 23:59 in `Europe/Amsterdam`. Existing installations should run `db_migrations/switch-to-monday-week.sql` once in the Supabase SQL Editor; it keeps the current Monday-Saturday availability, discards the previous Sunday, and leaves the upcoming Sunday empty.

Riot profiles are cached through the `riot-profile` Edge Function. Run `db_migrations/add-riot-profiles.sql`, add `RIOT_API_KEY` as a Supabase secret, and deploy `supabase/functions/riot-profile/index.ts`.

## Secure the public lobby

Run `db_migrations/secure-public-api.sql`, then configure a shared invitation code and deploy the protected write endpoints:

```bash
supabase secrets set LOBBY_INVITE_TOKEN="choose-a-long-random-code"
supabase functions deploy lobby-join
supabase functions deploy lobby-update
supabase functions deploy riot-profile
```

The browser publishable key remains public and read-only. Each player receives a device-specific ownership token, and up to ten devices can be authorized by rejoining with the shared invitation code. Every Edge Function is self-contained so its `index.ts` can be pasted directly into the Dashboard editor.
For Recent Games and the removal of the old lock-in state, run `db_migrations/add-shared-matches-remove-locking.sql`, then deploy both `riot-profile` and `clash-schedule`. The Riot profile refresh discovers matches containing at least two registered players and stores full team champion/KDA summaries.

To upgrade Recent Games to a rolling month, run `db_migrations/retain-one-month-shared-matches.sql` and redeploy `riot-profile`. The migration adds indexed 30-day retention, a cleanup trigger, and a daily Supabase cron cleanup. The desktop UI shows a compact match navigator on the left and one selected match on the right; the latest match is selected by default. “Mancos de la semana” is calculated from every stored shared match in the current Monday-to-Sunday week.

Clash notifications use Riot's EUW `clash-v1` schedule and the existing `RIOT_API_KEY` secret.

Live-game notifications use Riot Spectator-V5. Run `db_migrations/add-live-game-cache.sql` and deploy `supabase/functions/live-games/index.ts` as the `live-games` Edge Function. It reuses `RIOT_API_KEY` and `LOBBY_INVITE_TOKEN`, caches checks for 75 seconds, and exposes only the registered players currently in a game.

## Windows live-stats companion

The Tauri application under `desktop/` reads the local Riot Live Client Data API and publishes only the active player's own KDA and CS. SaleLoL continues to show every registered player detected by Spectator-V5; a `LIVE` badge and live KDA appear only when that player is running the companion.

### Supabase deployment

1. Run `db_migrations/add-desktop-live-stats.sql` in **Supabase Dashboard > SQL Editor**.
   If the live-stats table already exists, run `db_migrations/add-live-game-results.sql` instead.
2. Create and deploy a new Edge Function named `live-stats-update` using `supabase/functions/live-stats-update/index.ts`.
3. Redeploy `live-games` using the updated `supabase/functions/live-games/index.ts`.
4. Reuse the existing `LOBBY_INVITE_TOKEN`; no additional secret is required.

The companion receives a device ownership token from `lobby-join`. It never contains the Riot API key or Supabase service-role key. Live rows cannot be read or written directly by anonymous clients, and records older than 35 seconds are ignored.

### Build the Windows installer

Install the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```bash
cd desktop
npm install
npm run build
```

The NSIS installer is created under `desktop/src-tauri/target/release/bundle/nsis/`. The **Build Windows companion** GitHub Action can also be run manually and uploads the installer as an artifact.

### Report the companion to Riot

Before sharing the installer beyond development testing:

1. Open the SaleLoL product in the [Riot Developer Portal](https://developer.riotgames.com/) or register it if it is not registered yet.
2. In the product description/application notes, disclose the native Windows companion and the exact local endpoint: `GET /liveclientdata/allgamedata` on `https://127.0.0.1:2999`.
3. Explain that the typed Riot ID must match `activePlayer.riotId`, only that player's visible KDA/CS is transmitted, participation is opt-in, and data expires after 35 seconds.
4. State that the data is shown only to the private SaleLoL lobby, provides no recommendations or hidden enemy information, and is never sold or shared with another service.
5. Include the SaleLoL URL, screenshots of this login/status flow, a Windows test build, privacy/retention details, and Riot's required product disclaimer.
6. Ask Riot to acknowledge this updated use case before enabling broad distribution. Keep the product notes current whenever the collected fields or endpoints change.

Riot documents the Game Client APIs as local-only native APIs and asks developers to disclose which client endpoints they use. The companion deliberately validates the local active player instead of collecting the other nine participants.
