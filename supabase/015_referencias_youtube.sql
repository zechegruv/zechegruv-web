-- ZECHE GRUV — Portal de artistas
-- Links de YouTube en Referencias: además de los archivos de OneDrive, cada
-- artista puede pegar links de videos que le sirven de referencia. El portal
-- muestra la portada del video, su título y el canal, y opcionalmente a qué
-- canción (subcarpeta de Referencias) corresponde.
-- Cada artista ve, agrega y quita solo los suyos; el administrador, todos.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

create table public.reference_links (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  url text not null check (url ~ '^https://'),
  title text not null default '',
  channel text not null default '',
  song text check (song is null or length(song) between 1 and 200),
  created_at timestamptz not null default now()
);

create index reference_links_artist_idx on public.reference_links (artist_id, created_at desc);
-- El mismo video no se repite dentro de la misma canción.
create unique index reference_links_unique on public.reference_links (artist_id, video_id, coalesce(song, ''));

alter table public.reference_links enable row level security;
grant select, insert, delete on public.reference_links to authenticated;

create policy "ver links propios o todos si es admin"
  on public.reference_links for select to authenticated
  using (artist_id = (select auth.uid()) or public.is_admin());

create policy "agregar link propio o de cualquiera si es admin"
  on public.reference_links for insert to authenticated
  with check (artist_id = (select auth.uid()) or public.is_admin());

create policy "quitar link propio o todos si es admin"
  on public.reference_links for delete to authenticated
  using (artist_id = (select auth.uid()) or public.is_admin());
