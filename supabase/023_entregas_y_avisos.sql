-- ZECHE GRUV — Portal de artistas
-- Botones "Entregado" y "Aprobado" del administrador y avisos del Inicio.
-- - action 'entregada': Zeche marca a mano que entregó la mezcla o el master
--   (por ejemplo, si lo mandó por WhatsApp y no está en la carpeta).
-- - source: quién lo hizo ('artist' desde su portal, 'admin' con los botones).
-- - dismissed_at: el aviso se borró del Inicio (botón ✕). No se pierde nada:
--   solo deja de aparecer.
-- El estado a mano también queda en Notion (Canciones → "Entrega"), así se
-- puede marcar desde Notion o pidiéndoselo a Claude.
-- Pegar completo en Supabase → SQL Editor → Run. Se puede correr más de una vez
-- (necesita 020, 021 y 022 corridos antes).

alter table public.song_approvals
  add column if not exists source text not null default 'artist',
  add column if not exists dismissed_at timestamptz;

alter table public.song_approvals drop constraint if exists song_approvals_action_check;
alter table public.song_approvals
  add constraint song_approvals_action_check check (action in ('aprobada', 'cambios', 'entregada'));

alter table public.song_approvals drop constraint if exists song_approvals_source_check;
alter table public.song_approvals
  add constraint song_approvals_source_check check (source in ('artist', 'admin'));

create index if not exists song_approvals_song on public.song_approvals (song_id, created_at desc);

grant select, insert, update on public.song_approvals to service_role;

notify pgrst, 'reload schema';
