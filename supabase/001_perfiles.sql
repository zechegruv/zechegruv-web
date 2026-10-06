-- ZECHE GRUV — Portal de artistas
-- Etapa 1: perfiles, rol de administrador y fotos de perfil.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

-- ---------- Perfiles ----------
-- Un perfil por cuenta. El artista solo puede cambiar su nombre visible y
-- su foto; el resto de los datos los carga el administrador.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'artist' check (role in ('artist', 'admin')),
  email text,
  display_name text,          -- nombre artístico que se ve en el portal
  full_name text,             -- nombre completo
  spotify_artist_id text,     -- de ahí sale la foto por defecto
  apple_id text,
  avatar_url text,            -- foto propia; si está vacía se usa la de Spotify
  format text check (format in ('single', 'ep', 'album')),
  onedrive_folder text,       -- carpeta del artista en OneDrive
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ¿La cuenta que está consultando es administradora?
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Cada artista ve y edita solo su perfil; el administrador, todos.
create policy "ver perfil propio o todos si es admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy "editar perfil propio o todos si es admin"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- Nadie crea ni borra perfiles desde el portal: se crean solos al dar de
-- alta la cuenta (ver más abajo) y solo se borran desde Supabase.

-- Un artista solo puede cambiar display_name y avatar_url: cualquier otro
-- campo que intente tocar vuelve a su valor anterior.
create function public.profiles_guard()
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
    new.onedrive_folder := old.onedrive_folder;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Al dar de alta una cuenta se crea su perfil.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Fotos de perfil ----------
-- Imágenes livianas (hasta 2 MB). Cada cuenta sube solo a su propia
-- carpeta; no hay permiso de borrado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

create policy "subir foto de perfil propia"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "reemplazar foto de perfil propia"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
