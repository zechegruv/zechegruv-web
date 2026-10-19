-- ZECHE GRUV — Sesiones reprogramadas cuando ya estaban vencidas.
-- El Inicio del panel muestra el día y la hora nuevos que elegiste, con el
-- cartel "Atrasada · era el <día original>", así sabés que vas atrasado
-- aunque ya esté agendada (netlify/functions/admin-tasks.js y
-- admin-reschedule.js). Se guarda la PRIMERA fecha que tenía: si la volvés a
-- mover, sigue diciendo desde cuándo estás atrasado.
-- Solo las functions (clave secreta) leen y escriben: el navegador no.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

create table if not exists public.task_reschedules (
  task_id      text primary key,          -- id de la tarea en Notion
  song_id      text,                      -- id de la canción en Notion
  stage        text,                      -- Mezcla | Master
  original_due timestamptz not null,      -- la fecha que tenía antes de vencerse
  current_due  timestamptz,               -- a dónde la moviste
  moved_at     timestamptz not null default now()
);

alter table public.task_reschedules enable row level security;
revoke all on public.task_reschedules from anon, authenticated;
grant select, insert, update, delete on public.task_reschedules to service_role;
