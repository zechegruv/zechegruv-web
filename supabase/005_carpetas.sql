-- ZECHE GRUV — Portal de artistas
-- Etapa 3: carpeta de OneDrive de cada artista.
-- El link de la carpeta se guarda aparte del perfil, en una tabla que solo
-- puede leer y editar el administrador: el artista nunca recibe el link
-- completo, solo ve en el portal las secciones que le corresponden.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

create table public.artist_private (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  onedrive_link text,
  updated_at timestamptz not null default now()
);

alter table public.artist_private enable row level security;
grant select, insert, update on public.artist_private to authenticated;
grant select on public.artist_private, public.profiles to service_role;

create policy "solo admin"
  on public.artist_private for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- El perfil deja de guardar la carpeta: se pasa lo que hubiera cargado y
-- se saca la columna (y su mención en el control de cambios del perfil).
insert into public.artist_private (profile_id, onedrive_link)
select id, onedrive_folder from public.profiles where onedrive_folder is not null;

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
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

alter table public.profiles drop column onedrive_folder;
