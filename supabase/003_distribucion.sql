-- ZECHE GRUV — Portal de artistas
-- Etapa 2: formulario de distribución (una fila por lanzamiento; las
-- canciones y sus créditos van adentro, en "tracks").
-- Pegar completo en Supabase → SQL Editor → Run. Se corre una sola vez.

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- draft: borrador del artista · submitted: enviado a ZECHE GRUV ·
  -- loaded: cargado para distribución · published: publicado
  status text not null default 'draft' check (status in ('draft', 'submitted', 'loaded', 'published')),
  title text,
  release_type text check (release_type in ('single', 'ep', 'album')),
  release_date date,
  genre text,
  subgenre text,
  language text,
  territory text,
  upc text,
  cover_link text,
  pitch boolean not null default false,
  notes text,
  tracks jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.releases enable row level security;
grant select, insert, update, delete on public.releases to authenticated;

-- Cada artista ve solo sus lanzamientos; el administrador, todos.
create policy "ver lanzamientos propios o todos si es admin"
  on public.releases for select to authenticated
  using (artist_id = (select auth.uid()) or public.is_admin());

-- El artista crea borradores a su nombre.
create policy "crear borrador propio"
  on public.releases for insert to authenticated
  with check (public.is_admin() or (artist_id = (select auth.uid()) and status = 'draft'));

-- El artista solo edita mientras es borrador, y lo único que puede hacer
-- con el estado es enviarlo. Una vez enviado queda bloqueado para él.
create policy "editar borrador propio o todo si es admin"
  on public.releases for update to authenticated
  using (public.is_admin() or (artist_id = (select auth.uid()) and status = 'draft'))
  with check (public.is_admin() or (artist_id = (select auth.uid()) and status in ('draft', 'submitted')));

-- Solo el administrador borra.
create policy "borrar solo admin"
  on public.releases for delete to authenticated
  using (public.is_admin());

create function public.releases_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  if (select auth.uid()) is not null and not public.is_admin() then
    new.artist_id := old.artist_id;
  end if;
  if new.status = 'submitted' and old.status = 'draft' then
    new.submitted_at := now();
  elsif new.status = 'draft' then
    new.submitted_at := null;
  else
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end;
$$;

create trigger releases_guard
  before update on public.releases
  for each row execute function public.releases_guard();
