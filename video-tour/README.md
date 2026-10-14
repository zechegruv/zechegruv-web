# video-tour — Tour grabado del portal del artista

Graba recorridos del **portal del artista** de ZECHE GRUV con Playwright y Chromium, y audita cómo se ve en distintas pantallas. Esta carpeta no forma parte de la web: Netlify solo publica `ZECHE_GRUV_Web/`.

## Qué abre

Abre el **portal real**: los mismos archivos de `ZECHE_GRUV_Web/portal/` que se publican, con el mismo HTML, CSS, animaciones y fuentes. Funciona en **modo demo**:

- La sesión es de **"Artista Demo"**. Las canciones, letras, archivos y lanzamientos son inventados y están en `demo/datos-demo.js`. No aparece ningún artista real.
- Supabase, Notion, OneDrive y Mercado Pago **no se tocan**. Todo pedido a internet se corta (`lib/entorno.js`) y las funciones del portal (aprobar, subir, mandar mails) contestan "ok" sin salir de la computadora. Así el tour se puede repetir todas las veces que quieras: no paga nada, no envía formularios y no descarga ni sube archivos.
- Las fuentes del portal (Bricolage Grotesque, Geist, Manrope, DM Mono, con licencia OFL) están en `demo/fonts`. Así se ven igual que online, aunque no haya conexión.
- `demo/audio-demo.mp3` es un acorde sintetizado (generado acá, sin derechos de terceros). Solo sirve para que el reproductor de mezcla muestre la onda. Las grabaciones no llevan sonido.

## Uso

En el entorno de Claude, Playwright, Chromium, Xvfb y FFmpeg ya vienen instalados. Para correrlo en tu Mac, una sola vez:

```bash
cd video-tour
npm install
npx playwright install chromium
```

Después:

```bash
npm run tour            # graba escritorio (1920 × 1080) y reel (1080 × 1920), en alta calidad
npm run tour:desktop    # solo escritorio
npm run tour:reel       # solo celular a pantalla completa 9:16 (405 × 720 con densidad 2,667)
npm run editar          # arma los dos videos finales a partir de las últimas grabaciones
npm run auditoria       # auditoría responsive: auditoria/informe.md + capturas
```

La grabación en alta calidad (`lib/grabador.js`) abre Chromium en una pantalla virtual del tamaño exacto del video y la graba con FFmpeg a 30 fps. Necesita Linux con Xvfb, como el entorno de Claude. En la Mac usá el modo simple, que es más liviano: `ZG_GRABADOR=playwright node tour.js desktop`.

## Videos finales

- `ZECHE-GRUV-Tour-Desktop-1920x1080.mp4`: horizontal 16:9.
- `ZECHE-GRUV-Tour-Mobile-1080x1920.mp4`: vertical 9:16 a pantalla completa, para Reels.

`edicion/editar.js` corta la grabación real, la acelera un poco donde hace falta y le suma un acercamiento lento, color cálido, grano y viñeta. También agrega la placa "¿Cómo va tu canción?", las etiquetas de cada parte y el cierre "Tu canción, paso a paso." (`edicion/titulos.html`, con las fuentes y el sol del sello).

El guion de cortes y etiquetas está al principio de `editar.js`, en `GUION`. Los cortes se ubican con los pasos que anota `tour.js`, así que si volvés a grabar, el guion se acomoda solo. Las piezas intermedias quedan en `edicion/render/`.

Los videos no traen música, porque no había ningún archivo autorizado. Llevan una pista en silencio para sumar un tema desde la biblioteca de Instagram al subir el reel.

## Dónde queda cada cosa

- `grabaciones/desktop/` y `grabaciones/reel/`: cada grabación en `.mp4`, más un `.json` con cada paso y el segundo en que pasa.
- `grabaciones/mobile/`: la prueba a 390 × 844 hecha con el modo simple.
- `edicion/render/`: placas, cortes, etiquetas y `*-guion.json` de cada video.
- `auditoria/`: `INFORME-RESPONSIVE.md` (diagnóstico y correcciones), `informe.md`, `datos.json` y capturas.

## El recorrido (`tour.js`)

Mi proyecto → Canciones (en el celular se llega **deslizando**) → abrir la mezcla "Brisa de abril" → reproducir, saltar a un momento y mostrar "Dejar una nota" → cerrar **sin enviar** → Archivos → Letras → abrir una letra → Exports → Masters → Distribución → Mi perfil → vuelta a Mi proyecto.

Encima de la grabación se dibuja un puntero claro (en el celular, un círculo donde se toca). Esa capa existe solo en la grabación y no cambia la web.
