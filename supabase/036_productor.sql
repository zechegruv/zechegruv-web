-- ZECHE GRUV — Portal: cuenta de Productor (solo seguimiento).
-- Para un productor que trabaja con artistas del sello y quiere ver cómo
-- avanzan las canciones y bajar los archivos, sin tocar nada del trabajo
-- de Zeche:
--   · Ve SOLO los artistas que el administrador le asigna (tabla de abajo).
--   · De cada uno: la etapa de cada canción, la mezcla/master entregado para
--     escuchar, y las carpetas Referencias, Letras, Exports y Masters.
--   · No aprueba ni pide cambios, no deja notas, no sube archivos, no ve
--     Membresía, ni las notas del artista, ni fechas de entrega, ni sesiones,
--     ni datos personales (mail, nombre completo, teléfono) de los artistas.
--   · No recibe avisos (mail, WhatsApp ni notificaciones) ni entra en line
--     ups, recordatorios ni automatizaciones: todo eso filtra role = 'artist'.
-- Se le da este rol desde el portal al invitarlo (Tipo de cuenta → Productor)
-- y los artistas se le eligen desde su perfil en el panel.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('artist', 'admin', 'distribution', 'producer'));

-- Qué artistas sigue cada productor.
create table if not exists public.producer_artists (
  producer_id uuid not null references public.profiles (id) on delete cascade,
  artist_id   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (producer_id, artist_id)
);
alter table public.producer_artists enable row level security;

grant select, insert, delete on public.producer_artists to authenticated;
grant select on public.producer_artists to service_role;

-- El administrador arma y cambia las asignaciones.
drop policy if exists "admin maneja productores" on public.producer_artists;
create policy "admin maneja productores"
  on public.producer_artists for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- El productor ve solo sus propias filas (no las de otros productores).
drop policy if exists "productor ve sus artistas" on public.producer_artists;
create policy "productor ve sus artistas"
  on public.producer_artists for select to authenticated
  using (producer_id = (select auth.uid()));

-- Los artistas del productor que inició sesión, con lo justo para mostrarlos
-- (nombre artístico, foto, Spotify para la foto, formato). Sin mail, nombre
-- completo, Apple ID ni nada de artist_private. Solo artistas activos y solo
-- si la cuenta del productor está activa.
create or replace function public.producer_my_artists()
returns table (id uuid, display_name text, avatar_url text, spotify_artist_id text, format text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.display_name, a.avatar_url, a.spotify_artist_id, a.format
  from public.producer_artists pa
  join public.profiles me on me.id = pa.producer_id
  join public.profiles a on a.id = pa.artist_id
  where pa.producer_id = (select auth.uid())
    and me.role = 'producer' and me.active
    and a.role = 'artist' and a.active
  order by lower(coalesce(a.display_name, ''));
$$;
revoke all on function public.producer_my_artists() from public, anon;
grant execute on function public.producer_my_artists() to authenticated;

notify pgrst, 'reload schema';
