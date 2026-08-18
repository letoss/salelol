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

If the database was configured before match deletion was added, run `add-delete-policy.sql` once in the Supabase SQL Editor.

For the lock-in status, run `add-lock-status.sql` once in the Supabase SQL Editor.

The lobby resets automatically at midnight in `Europe/Amsterdam`. Existing installations should run `switch-to-amsterdam-daily-reset.sql` once in the Supabase SQL Editor.
