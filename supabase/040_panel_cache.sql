-- Copia de lo último que armó el panel (mezclas y masters, ingresos) para
-- mostrarlo al instante mientras se lee Notion de nuevo
-- (netlify/functions/_lib/panel-cache.js). Solo la usan las funciones.
create table if not exists public.panel_cache (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.panel_cache enable row level security;
revoke all on public.panel_cache from anon, authenticated;
grant select, insert, update, delete on public.panel_cache to service_role;

notify pgrst, 'reload schema';
