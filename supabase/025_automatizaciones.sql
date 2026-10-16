-- ZECHE GRUV — Portal: automatizaciones (mezcla agendada sola, regla de
-- 15 días, recordatorios al artista y checklist de notas).
-- - song_stage_log: en qué etapa estaba cada canción la última vez que se
--   miró, y cuándo pasó a Mix (voces finales → regla de 15 días).
-- - portal_reminders: qué mails automáticos ya se mandaron (para no
--   repetirlos nunca).
-- - song_approvals.resolved: qué notas del artista ya tildaste en el
--   checklist de la mezcla.
-- Solo las functions (clave secreta) leen y escriben: el navegador no.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

create table if not exists public.song_stage_log (
  song_id    text primary key,          -- id de la canción en Notion
  stage      text not null,
  changed_at timestamptz not null default now(),
  vocals_at  timestamptz                -- cuándo pasó a Mix (voces finales)
);

create table if not exists public.portal_reminders (
  key        text primary key,          -- qué aviso, para no repetirlo
  kind       text not null,
  profile_id uuid references public.profiles(id) on delete cascade,
  song_id    text,
  sent_at    timestamptz not null default now()
);

alter table public.song_approvals
  add column if not exists resolved jsonb not null default '[]'::jsonb;

alter table public.song_stage_log enable row level security;
alter table public.portal_reminders enable row level security;
revoke all on public.song_stage_log, public.portal_reminders from anon, authenticated;
grant select, insert, update, delete on public.song_stage_log, public.portal_reminders to service_role;
grant select, insert, update on public.song_approvals to service_role;

notify pgrst, 'reload schema';
