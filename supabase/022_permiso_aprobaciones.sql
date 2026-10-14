-- ZECHE GRUV — Portal de artistas
-- Permiso que le faltaba a song_approvals (020). Sin esto, las functions
-- (portal-review, portal-songs, portal-reviews) no pueden guardar ni leer
-- las aprobaciones y notas: el artista veía "No pudimos guardarlo".
-- Igual que las demás tablas del portal (005, 016, 017): solo la clave
-- secreta, nunca el navegador.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

grant select, insert on public.song_approvals to service_role;

-- Que la API vea las columnas nuevas de 021 (version, marks) sin esperar.
notify pgrst, 'reload schema';
