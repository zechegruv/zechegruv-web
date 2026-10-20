# Estado al 20/10/2026 (tarde) — para retomar

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
- TODAS las pruebas juntas en verde (portal 20, panel 18 + node --check de 109 archivos, cierres 3, entradas/web 80).
- Migraciones 001–034 probadas en Postgres 16 desde cero; 029–034 corridas dos veces sin romper.

## Falta
1. Correr en Supabase (SQL Editor) 029 → 034 (Claude te lo pasa junto, listo para pegar).
2. Pasar `auditoria` a `main` (avanza sin conflictos) y hacer push.
3. Probar en el sitio publicado con el Chrome de Zeche, sin tocar datos reales: Inicio (Busco Más una sola fila), Estado del sistema, portal de artista de prueba (instalar, guardar un audio, modo avión), entradas de prueba, consola sin errores.
4. WhatsApp: crear la app y las 4 plantillas en Meta (docs/WHATSAPP.md). Hasta entonces, los avisos siguen solo por mail.
