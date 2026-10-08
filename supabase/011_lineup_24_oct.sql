-- ZG PASS · ZECHE GRUV Shows & Open Mic #2 (sábado 24/10, Teatro Sergio Souza)
-- Line up confirmado. Aparece en la página del evento, arriba del botón de compra.
-- Correr en Supabase > SQL Editor. Después, publicar el evento desde el portal
-- (pestaña ZG PASS > botón "Publicar") para abrir la venta.
update public.pass_events
set description = 'Line up: Pazz · Maki · Bastian & Kaino · Rouse Bby. '
               || 'Cuatro shows de artistas del sello en una sola noche, '
               || 'y un open mic para que tu canción también suene.'
where slug = 'shows-open-mic-2';

select name, starts_at, venue_name, status, description
from public.pass_events where slug = 'shows-open-mic-2';
