-- ZECHE GRUV — Portal de artistas
-- Permisos de tabla para las cuentas con sesión iniciada. Quién ve o edita
-- qué fila lo siguen decidiendo las políticas de 001_perfiles.sql; los
-- visitantes sin sesión no tienen ningún permiso.
grant select, update on public.profiles to authenticated;
