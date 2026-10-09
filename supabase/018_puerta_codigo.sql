-- ZECHE GRUV — ZG PASS · Código de 4 números para el acceso de puerta
-- La primera vez que se abre el link de puerta en un celular se pide el
-- código; después queda guardado en ese celular. Con 10 intentos fallidos
-- el acceso se bloquea (se crea uno nuevo desde el portal).
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.
alter table public.pass_door_access
  add column if not exists pin text not null default lpad(floor(random() * 10000)::int::text, 4, '0'),
  add column if not exists failed_attempts integer not null default 0;
