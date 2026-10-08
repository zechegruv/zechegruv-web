-- ZECHE GRUV — Portal de artistas
-- Cuenta de equipo "Distribución": para quien carga los lanzamientos en la
-- distribuidora. Ve y edita las fichas de distribución de todos los
-- artistas (y sus portadas), y nada más: ni carpetas, ni letras, ni
-- canciones, ni la lista de artistas, ni ZG PASS.
-- Se le da este rol desde el portal al invitarla (Tipo de cuenta).
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('artist', 'admin', 'distribution'));

-- ¿La cuenta que está consultando es del equipo de distribución?
create function public.is_distribution()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'distribution' and active
  );
$$;

-- Lanzamientos de todos los artistas: ver y editar (no crear ni borrar).
create policy "distribucion ve lanzamientos"
  on public.releases for select to authenticated
  using (public.is_distribution());

create policy "distribucion edita lanzamientos"
  on public.releases for update to authenticated
  using (public.is_distribution())
  with check (public.is_distribution());

-- Datos de los artistas que van en la ficha y en el Excel (nombre, mail,
-- Spotify, Apple ID). Solo lectura; los links de carpeta y de Notion están
-- en artist_private y no los ve.
create policy "distribucion ve perfiles"
  on public.profiles for select to authenticated
  using (public.is_distribution());

-- Portadas de los lanzamientos.
create policy "distribucion ve portadas"
  on storage.objects for select to authenticated
  using (bucket_id = 'covers' and public.is_distribution());
