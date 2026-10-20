# Estado al 20/10/2026 11:05 — para retomar

Decile a Claude: "seguí con zechegruv-web: leé _pruebas-auditoria/ESTADO.md en la rama auditoria".

## Hecho (en esta rama, sin publicar)
- Auditoría completa (50 puntos + extras) con pruebas: ver LEEME.md.
- Inicio: la entrega vieja que quedaba atrás de su sesión (caso «Busco Más» de Lihuen) ahora pasa al día de la sesión y se ve una sola fila con «Atrasada · era el …».
- Página de "Estado del sistema" en el panel (SQL 034).
- Avisos por WhatsApp: lo que estaba hecho al guardar (SQL 033, docs/WHATSAPP.md). Faltaba terminar y verificar.

## Falta
1. Portal instalable + escuchar sin conexión: el trabajo estaba en curso; sus commits quedaron aparte en .git/pwa.mbox (aplicar con `git am` sobre esta rama y resolver el choque en portal/index.html / portal.js). Si no está, rehacerlo.
2. Terminar y verificar WhatsApp (pruebas, captura del interruptor en Perfil).
3. Correr TODAS las pruebas juntas sobre la rama.
4. Correr en Supabase (SQL Editor), en orden: 029 (si no se corrió), 030, 031, 032, 033, 034.
5. Pasar `auditoria` a `main` y hacer push (desde la compu de Zeche: GitHub Desktop o `git push`).
6. Probar en el sitio publicado con el Chrome de Zeche, sin tocar datos reales: Inicio (Busco Más una sola fila), Estado del sistema, portal de artista de prueba, entradas de prueba, consola sin errores.
7. Al terminar: resumen corto y cómo probar desde el celu; WhatsApp necesita que Zeche cree la app en Meta (docs/WHATSAPP.md).
