-- ZECHE GRUV — Portal de artistas
-- Artistas activos e inactivos. Un artista inactivo no puede entrar al
-- portal (su cuenta queda bloqueada en Supabase), pero no se borra nada:
-- su perfil, sus letras, sus lanzamientos y sus carpetas quedan guardados
-- para cuando vuelva a trabajar con ZECHE GRUV. Lo cambia solo el
-- administrador, desde la ficha del artista (portal-artist-access.js).
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

alter table public.profiles add column active boolean not null default true;

-- El artista no puede cambiarse el estado a sí mismo.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if (select auth.uid()) is not null and not public.is_admin() then
    new.id := old.id;
    new.role := old.role;
    new.email := old.email;
    new.full_name := old.full_name;
    new.spotify_artist_id := old.spotify_artist_id;
    new.apple_id := old.apple_id;
    new.format := old.format;
    new.active := old.active;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
