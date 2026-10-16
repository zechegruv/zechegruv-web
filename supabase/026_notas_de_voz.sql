-- ZECHE GRUV — Portal de artistas: notas de voz en la mezcla y el master.
-- Mientras escucha, el artista puede grabar lo que quiere (tararear una
-- melodía, explicar un sonido) en el segundo exacto, en vez de escribirlo.
-- Archivos privados, hasta 5 MB y 1 minuto. Cada artista sube y escucha
-- solo las suyas; el administrador, todas. No hay borrado ni reemplazo.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas-voz', 'notas-voz', false, 5242880, array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do nothing;

drop policy if exists "subir nota de voz propia" on storage.objects;
create policy "subir nota de voz propia"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'notas-voz' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));

drop policy if exists "escuchar nota de voz propia o todas si es admin" on storage.objects;
create policy "escuchar nota de voz propia o todas si es admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'notas-voz' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));
