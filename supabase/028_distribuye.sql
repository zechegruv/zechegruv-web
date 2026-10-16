-- ZECHE GRUV — Portal: qué artistas distribuyen con ZECHE GRUV.
-- Si "distribuye" está apagado, el artista no ve la sección Distribución,
-- al aprobarse un master no se crea la tarea de Distribución ni se avisa al
-- equipo, y no se le puede mandar nada a ZIL. Se cambia desde el perfil
-- del artista en el panel (solo el administrador).
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.profiles
  add column if not exists distributes boolean not null default true;

-- Solo el administrador lo puede cambiar.
create or replace function public.profiles_distributes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    new.distributes := old.distributes;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_distributes_guard on public.profiles;
create trigger profiles_distributes_guard
  before update on public.profiles
  for each row execute function public.profiles_distributes_guard();

-- Eny, por ahora, no distribuye con ZECHE GRUV.
update public.profiles set distributes = false
where role = 'artist' and (display_name ilike 'eny' or full_name ilike 'eny');

notify pgrst, 'reload schema';
