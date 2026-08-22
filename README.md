# SaleLoL

Private League of Legends lobby for coordinating availability, detecting shared matches, showing live companion stats, and generating post-game reports with heatmaps and group awards.

The frontend is a static GitHub Pages site. Supabase provides PostgreSQL, read-only browser access and Edge Functions. Riot's APIs provide profiles, ranks, match history, Clash, live-game detection and post-game timelines. The optional Windows companion reads Riot's local Live Client Data API for the signed-in player.

## What you need

- A [GitHub account](https://github.com/signup) and a copy of this repository.
- A [Supabase account](https://supabase.com/dashboard/sign-up) and project.
- A Riot account and access to the [Riot Developer Portal](https://developer.riotgames.com/).
- Node.js 22 and the Supabase CLI only if you prefer deploying from a terminal. Everything on the Supabase side can also be configured through its dashboard.

## 1. Get a Riot API key

1. Sign in at the [Riot Developer Portal](https://developer.riotgames.com/) with your Riot account.
2. Open **Dashboard** and copy the generated development API key.
3. For a lasting private installation, select **Register Product** and request a personal key with an accurate description of SaleLoL, its private audience, the Windows companion and the APIs it uses.
4. Use a production key instead if the site will be offered publicly.

Development keys expire every 24 hours and must be regenerated. Never put `RIOT_API_KEY` in `config.js`, GitHub, the companion binary or any browser-delivered file. It belongs only in Supabase Edge Function secrets. Riot documents the key types and registration process in its [Developer Portal guide](https://developer.riotgames.com/docs/portal) and explicitly prohibits embedding keys in distributed code in the [League developer documentation](https://developer.riotgames.com/docs/lol).

## 2. Create and configure Supabase

### Create the project

1. Open the [Supabase Dashboard](https://supabase.com/dashboard).
2. Select **New project**, choose an organization, project name, database password and region, and wait for provisioning to finish.
3. Open **Project Settings → API** and copy the Project URL and publishable key (or legacy `anon` key).
4. Update `config.js`:

```js
window.SALELOL_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_PUBLISHABLE_KEY"
};
```

The publishable key is intentionally used by the browser and has read-only access through RLS. Never use the secret or `service_role` key in `config.js`.

### Create the database

1. In Supabase, open **SQL Editor → New query**.
2. Copy all of `db_migrations/000_initial.sql` into the editor.
3. Select **Run** once.

This migration creates every table, index, function, trigger, RLS policy, grant and Realtime publication required by a fresh SaleLoL installation. Existing databases that ran the former incremental migrations do not need to run it.

### Add Edge Function secrets

Open **Edge Functions → Secrets** and create:

| Secret | Required | Purpose |
|---|---:|---|
| `RIOT_API_KEY` | Yes | Riot Web API authentication |
| `LOBBY_INVITE_TOKEN` | Yes | Shared private invitation code entered by users |
| `RIOT_REFRESH_SECRET` | Recommended | Protects manual bulk profile refreshes |

Choose long random values for the application secrets. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to hosted Edge Functions; do not add them to the frontend.

CLI equivalent:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set RIOT_API_KEY="RGAPI-..."
supabase secrets set LOBBY_INVITE_TOKEN="YOUR_LONG_RANDOM_INVITE_CODE"
supabase secrets set RIOT_REFRESH_SECRET="YOUR_LONG_RANDOM_REFRESH_SECRET"
```

### Create the Edge Functions

Deploy every directory under `supabase/functions` using the directory name as the function name:

| Function | Responsibility |
|---|---|
| `lobby-join` | Validates the invitation and creates/authorizes a player |
| `lobby-update` | Updates availability using the player's ownership token |
| `riot-profile` | Loads Riot identity, rank and shared match history |
| `refresh-riot-profiles` | Manually refreshes all cached Riot profiles |
| `clash-schedule` | Loads the upcoming EUW Clash schedule |
| `live-games` | Detects active games and serves live/report data |
| `live-stats-update` | Receives the companion player's live stats |
| `post-game-report` | Builds the final report from Match-V5 and Timeline |

Dashboard method, repeated for each function:

1. Open **Edge Functions → Deploy a new function → Via Editor**.
2. Enter the exact function name from the table.
3. Replace the editor contents with the matching `supabase/functions/NAME/index.ts` file.
4. Disable legacy JWT verification. SaleLoL performs invitation, ownership and rate-limit checks while the browser sends the publishable key.
5. Select **Deploy function**.

CLI equivalent:

```bash
supabase functions deploy lobby-join --no-verify-jwt
supabase functions deploy lobby-update --no-verify-jwt
supabase functions deploy riot-profile --no-verify-jwt
supabase functions deploy refresh-riot-profiles --no-verify-jwt
supabase functions deploy clash-schedule --no-verify-jwt
supabase functions deploy live-games --no-verify-jwt
supabase functions deploy live-stats-update --no-verify-jwt
supabase functions deploy post-game-report --no-verify-jwt
```

## 3. Publish with GitHub Pages

1. Create a GitHub repository or fork this one.
2. Commit the updated `config.js` and push the files to `main`.
3. Open **Settings → Pages** in the repository.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select **main**, folder **/(root)**, and save.
6. Wait for deployment and select **Visit site**.

The default project URL is `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY_NAME/`. GitHub documents this in [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## 4. First run

1. Open the GitHub Pages URL.
2. Enter a Riot ID in `GameName#Tag` format.
3. Enter the value configured as `LOBBY_INVITE_TOKEN`.
4. Join and confirm that the Riot profile, rank and recent matches load.
5. Repeat with another registered player to enable shared-match reports and group awards.

The latest companion-triggered match is stored even when only one registered SaleLoL player participated. Group awards become available when multiple registered players were in the same match. The Live tab keeps the finished report visible until a newer game starts.

## Windows companion

The Tauri project under `desktop/` reads `https://127.0.0.1:2999/liveclientdata/allgamedata`, verifies the active Riot ID and publishes only that player's visible live stats. At GameEnd it asks Supabase to build the final report. Riot API keys and Supabase service credentials are never stored in the companion.

Any push to `main` that changes `desktop/**` triggers **Build Windows companion**. You can also run it from **Actions → Build Windows companion → Run workflow** and download the `salelol-companion-windows` artifact.

To build locally, install the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) and run:

```bash
cd desktop
npm ci
npm run build
```

The NSIS installer is created under `desktop/src-tauri/target/release/bundle/nsis/`. Before distributing it, keep the SaleLoL product description in Riot's Developer Portal updated with the native client, local endpoint, collected fields and retention.

## Local frontend development

No frontend build is required:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`. Without valid Supabase values in `config.js`, the basic UI falls back to browser `localStorage`.

## Operations

Preview lobby users without a Riot profile:

```sql
select * from public.cleanup_invalid_players();
```

Delete them:

```sql
select * from public.cleanup_invalid_players(false);
```

Shared matches are retained for 30 days and cleaned after shared-match writes and Riot profile refreshes.

## Security

- The browser receives only a Supabase publishable key with column-level read grants and RLS.
- All writes go through Edge Functions.
- Player updates require an ownership token and support multiple authorized devices.
- Invitation and request rate limits are enforced server-side.
- `RIOT_API_KEY`, `service_role` and refresh secrets must never be committed or delivered to browsers.
- SaleLoL does not provide in-game recommendations or hidden enemy information.
