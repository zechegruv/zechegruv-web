# Estado al 20/10/2026 (15 h) — para retomar

Decile a Claude: "seguí con zechegruv-web: leé _pruebas-auditoria/ESTADO.md en la rama auditoria".

## Hecho (en esta rama, sin publicar)
- Auditoría completa (50 puntos + extras) con pruebas: ver LEEME.md.
- Inicio: la entrega vieja que quedaba atrás de su sesión (caso «Busco Más» de Lihuen) pasa al día de la sesión y se ve una sola fila con «Atrasada · era el …».
- «Estado del sistema» en el panel (SQL 034).
- Portal instalable en el celu (manifest + aviso en Mi proyecto) y sin conexión:
  - el service worker guarda solo la cáscara (código, estilos, íconos); nunca audios ni datos;
  - cada audio de Referencias/Exports/Masters tiene «Guardar en el celu» (con avance; «Actualizar» si hay versión nueva en OneDrive);
  - «Guardados en este celu» en Mi proyecto y en la pantalla «No pudimos conectarnos»;
  - se borra al cerrar sesión o si entra otra cuenta.
- WhatsApp verificado: plantillas, una sola vez, apagado por el artista, sin número, Meta caído (el mail sale igual), recordatorios, portal-whatsapp. Interruptor en Mi perfil probado en el navegador.
- WhatsApp queda programado pero apagado (Zeche no quiere suscripciones): al artista no se le muestra el interruptor mientras no esté conectado.
- Notificaciones del portal (gratis, Web Push): Tu proyecto (mezcla, master, modificaciones, recordatorio, nueva fecha) y Eventos (invitación al open mic a quien no toca; aviso el día del show a quien toca; máx. 2/semana). Silencio de 00 a 9 h. Ver docs/NOTIFICACIONES.md.
- Quién toca se actualiza solo con el line up al guardar el evento.
- TODAS las pruebas juntas en verde (portal 20, panel 18 + node --check de 109 archivos, cierres 3, entradas/web 80).
- Migraciones 001–034 probadas en Postgres 16 desde cero; 029–034 corridas dos veces sin romper.

## Falta
1. ~~SQL 029 → 034~~ (corrido el 20/10). Correr `supabase/035_notificaciones.sql`.
2. Cargar en Netlify VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (Claude se las pasó a Zeche en el chat).
3. `main` ya tiene todo (avanzado en la compu): falta el push desde GitHub Desktop.
4. Probar en el sitio publicado con el Chrome de Zeche, sin tocar datos reales: Inicio (Busco Más una sola fila), Estado del sistema, portal de artista de prueba (instalar, guardar un audio, modo avión, activar notificaciones y «Probar»), entradas de prueba, consola sin errores.
5. WhatsApp: solo si algún día se decide pagarlo (docs/WHATSAPP.md).
