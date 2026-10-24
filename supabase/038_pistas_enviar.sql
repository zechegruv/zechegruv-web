-- ZECHE GRUV — ZG PASS · Pistas: borrador, orden del setlist y "Enviar"
-- Quien toca en un show sube sus pistas como borrador, puede quitar archivos
-- y ordenarlas (el orden es el del setlist), guardar y, al final, "Enviar
-- pistas": recién ahí le llega a Zeche el mail con el setlist.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

alter table public.pass_show_files
  add column if not exists position int;               -- lugar en el setlist (vacío: al final, por hora de subida)

alter table public.pass_show_artists
  add column if not exists submitted_at timestamptz;   -- cuándo tocó "Enviar pistas" (vacío: borrador)

alter table public.pass_show_guests
  add column if not exists submitted_at timestamptz;

-- El servidor ahora también ordena y quita archivos de la lista.
grant select, insert, update, delete on public.pass_show_files to service_role;
grant select, insert, update, delete on public.pass_show_artists to service_role;
grant select, insert, update on public.pass_show_guests to service_role;
