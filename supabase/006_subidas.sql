-- ZECHE GRUV — Portal de artistas
-- Link de edición de la carpeta de OneDrive de cada artista: lo usa el
-- portal para subir archivos a Referencias y Letras. Igual que el de solo
-- lectura, lo ve únicamente el administrador.
alter table public.artist_private add column onedrive_edit_link text;
