-- ZECHE GRUV — Portal: cuenta Productor/Artista.
-- Un artista del sello que además es productor: tiene su portal de artista
-- de siempre (sus canciones, su carpeta de OneDrive, aprobar mezcla y
-- master, avisos) y un interruptor arriba para pasar a la Vista de
-- productor, donde ve los artistas que el administrador le asigne (los
-- mismos permisos de solo seguimiento que la cuenta Productor, ver
-- 036_productor.sql). Va después de 036.
-- Se prende desde el perfil del artista en el panel (pestaña Admin) o al
-- invitarlo (Tipo de cuenta → Productor/Artista). Solo el administrador.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.profiles
  add column if not exists also_producer boolean not null default false;

-- Solo el administrador lo puede cambiar.
create or replace function public.profiles_producer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    new.also_producer := old.also_producer;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_producer_guard on public.profiles;
create trigger profiles_producer_guard
  before update on public.profiles
  for each row execute function public.profiles_producer_guard();

-- Sus artistas en la Vista de productor: ahora también para un artista con
-- also_producer (y nunca él mismo: lo suyo lo ve en su portal de artista).
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
    and (me.role = 'producer' or (me.role = 'artist' and me.also_producer))
    and me.active
    and a.role = 'artist' and a.active
    and a.id <> me.id
  order by lower(coalesce(a.display_name, ''));
$$;
revoke all on function public.producer_my_artists() from public, anon;
grant execute on function public.producer_my_artists() to authenticated;

notify pgrst, 'reload schema';
