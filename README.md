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

For the lock-in status, run `db_migrations/add-lock-status.sql` once in the Supabase SQL Editor.

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
