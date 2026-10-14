-- ZECHE GRUV — Panel de administrador: conexión con Google Calendar
-- Guarda la llave de larga duración que da Google al tocar "Conectar Google
-- Calendar" en el Inicio del panel. Solo la lee el servidor (Netlify, con la
-- clave secreta): sin políticas, nadie la ve desde el navegador.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

create table if not exists public.app_tokens (
  provider      text primary key,
  refresh_token text not null,
  account       text,
  updated_at    timestamptz not null default now()
);

alter table public.app_tokens enable row level security;
revoke all on public.app_tokens from anon, authenticated;
grant select, insert, update, delete on public.app_tokens to service_role;

notify pgrst, 'reload schema';
