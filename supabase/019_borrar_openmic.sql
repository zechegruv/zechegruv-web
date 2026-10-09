-- ZECHE GRUV — ZG PASS · Borrar inscripciones al open mic desde el portal
-- (pruebas o errores). El servidor borra la canción de la carpeta Open Mic
-- y la inscripción; la entrada sigue valiendo.
-- Pegar en Supabase → SQL Editor → Run. Se puede correr más de una vez.
grant delete on public.pass_openmic to service_role;
