# Pruebas de la auditoría (19–20/10/2026)

Pruebas automáticas de los arreglos de la auditoría. Todas usan **datos
inventados**: simulan Notion, Supabase, Google Calendar, OneDrive, Resend y
Mercado Pago en memoria, sin tocar nada real. No se publican en la web
(Netlify publica solo `ZECHE_GRUV_Web`) y se pueden borrar cuando quieras
(consultá antes).

Cómo correrlas (desde esta carpeta, con Node 18 o más):

- Panel y sincronización: `sh tests-panel/correr-todas.sh`
- Portal del artista: `bash tests-portal/run-all.sh` (las del navegador necesitan Playwright + Chromium)
- Cierres entre frentes: `node tests-final/t-final.js`
- Entradas y web: `bash tests-pass/run-all.sh` (necesita un Postgres 16 de prueba; ver el script)

`panel`, `portal` y `pass` son accesos directos a la carpeta del proyecto
(las pruebas los usan para encontrar el código). `tests-*/rojo-*`, `red-*`,
`out/*-rojo.txt` guardan cómo fallaba cada prueba antes del arreglo, y los
`verde`/`green` cómo pasa después.
