-- ZECHE GRUV — Panel de administrador: Estado del sistema.
-- automation_runs: cada vez que corre una automatización programada
-- (auto-entregas cada 15 minutos, zil-sync cada hora) queda anotado cuándo
-- empezó, cuándo terminó, si salió bien, un resumen corto de lo que hizo
-- (entregas, avisos, etapas, recordatorios…) y el error, si hubo.
-- Con esto el panel muestra "hace cuánto corrió" y avisa si la programada
-- dejó de correr. Si todavía no corriste este archivo, las automatizaciones
-- siguen funcionando igual: solo no se anota.
-- Se guarda un mes: al anotar una corrida nueva se borran solas las de más
-- de 30 días (no hace falta limpiar nada a mano).
-- Solo las functions (clave secreta) leen y escriben: el navegador no.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

create table if not exists public.automation_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,                    -- "auto-entregas", "zil-sync"
  started_at  timestamptz not null default now(),
  finished_at timestamptz,                      -- vacío mientras corre (o si se cortó)
  ok          boolean,                          -- vacío mientras corre
  summary     jsonb not null default '{}'::jsonb,
  error       text
);

-- La última corrida de cada automatización, al toque.
create index if not exists automation_runs_job_started_idx
  on public.automation_runs (job, started_at desc);

-- Limpieza: al anotar una corrida, se borran las de más de 30 días.
create or replace function public.zg_automation_runs_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.automation_runs where started_at < now() - interval '30 days';
  return null;
end;
$$;

drop trigger if exists automation_runs_cleanup on public.automation_runs;
create trigger automation_runs_cleanup
  after insert on public.automation_runs
  for each statement
  execute function public.zg_automation_runs_cleanup();

alter table public.automation_runs enable row level security;
revoke all on public.automation_runs from public, anon, authenticated;
grant select, insert, update, delete on public.automation_runs to service_role;
revoke all on function public.zg_automation_runs_cleanup() from public, anon, authenticated;

notify pgrst, 'reload schema';
