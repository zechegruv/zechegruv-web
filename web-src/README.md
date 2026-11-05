# web-src — el inicio de zechegruv.com

El inicio (español, inglés y portugués) se arma desde acá. No se edita
`ZECHE_GRUV_Web/index.html` a mano: se cambia lo de acá y se vuelve a armar.

- `src/home.dc.html` — el diseño (Propuesta 2): marcado y estilos.
- `src/logic.js` — lo que se mueve: packs y precios, catálogo, formulario,
  franja de entradas, demo del portal. Los precios están en `PRICE`.
- `src/page.html`, `src/head.json` — lo de afuera de la página (títulos,
  descripción para Google, Analytics) en cada idioma.
- `i18n/en.json`, `i18n/pt.json` — traducciones (texto en español →
  traducción). `i18n/_textos.json` se genera solo con todos los textos.

Armar (en la Terminal, dentro de esta carpeta):

    npm install      # la primera vez
    node compile.mjs

Genera `ZECHE_GRUV_Web/index.html`, `en/index.html`, `pt/index.html` y
`assets/web/home.css` + `home.js`. Esos archivos son los que se suben.
