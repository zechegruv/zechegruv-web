-- ZECHE GRUV — Portal de artistas
-- Cuaderno de letras: cada artista escribe sus letras dentro del portal,
-- con el título de la canción y la letra separada por partes (Intro, Verso,
-- Estribillo, Puente…). Las partes van en "sections", en orden:
--   [{ "kind": "verso", "text": "…" }, { "kind": "estribillo", "text": "…" }]
-- Cada artista ve, escribe y borra solo las suyas; el administrador, todas.
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

create table public.lyrics (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null default '',
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lyrics_artist_idx on public.lyrics (artist_id, updated_at desc);

alter table public.lyrics enable row level security;
grant select, insert, update, delete on public.lyrics to authenticated;

create policy "ver letras propias o todas si es admin"
  on public.lyrics for select to authenticated
  using (artist_id = (select auth.uid()) or public.is_admin());

create policy "crear letra propia o de cualquiera si es admin"
  on public.lyrics for insert to authenticated
  with check (artist_id = (select auth.uid()) or public.is_admin());

create policy "editar letra propia o todas si es admin"
  on public.lyrics for update to authenticated
  using (artist_id = (select auth.uid()) or public.is_admin())
  with check (artist_id = (select auth.uid()) or public.is_admin());

create policy "borrar letra propia o todas si es admin"
  on public.lyrics for delete to authenticated
  using (artist_id = (select auth.uid()) or public.is_admin());

-- La fecha de edición la pone la base, y la letra no cambia de dueño.
create function public.lyrics_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  new.artist_id := old.artist_id;
  return new;
end;
$$;

create trigger lyrics_guard
  before update on public.lyrics
  for each row execute function public.lyrics_guard();
