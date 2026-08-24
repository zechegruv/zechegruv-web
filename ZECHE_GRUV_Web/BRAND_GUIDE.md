# ZECHE GRUV — Guía de Identidad Visual

> Documento vivo. Se actualiza cada vez que se define algo nuevo sobre la estética del sello, para mantener una sola línea visual entre la web, el estudio y el merchandising.

**Última actualización:** 2026-08-23 (actualizado con catálogo, roster y redes)

---

## 1. Sello

- **Nombre:** ZECHE GRUV
- **Tipo:** Independent Record Label
- **Base:** Buenos Aires, Argentina
- **Territorio sonoro:** electronic music, club culture y todo lo que se mueve entre esos dos mundos
- **Tono de marca:** directo, nocturno, un poco crudo/analógico (grano de textura, cursor custom, marquee), confiado sin ser corporativo. Copy en inglés, breve, en minúscula conceptual salvo títulos.
- **Tagline / actitud:** "MAKE NOISE." — llamado a la acción para demos y colaboraciones.
- **Dirección:** Yaco Santana (músico, compositor y productor).
- **Bio oficial (Spotify):** "Zeche Gruv es un sello discográfico independiente dirigido por Yaco Santana, músico, compositor y productor musical. Brindamos servicios musicales para artistas de todo el mundo hace más de 10 años y más de 200 artistas nos eligieron para acompañar su trayectoria artística. Como principal objetivo, ZG busca mantener el sonido orgánico como la base de cualquier proyecto, desarrollando la producción del audio hasta alcanzar el objetivo del/a artista. Brindando un sonido profesional y composiciones de altísimo nivel creativo. Contamos con un equipo súper completo: productores, sesionistas de múltiples instrumentos, ingenieros de mezcla y mastering, servicio de distribución para todas las plataformas digitales, sector de diseño y edición de imagen para arte de tapa, grabación y producción audiovisual."
- **Redes / plataformas:**
  - Instagram: https://www.instagram.com/zechegruv/
  - Spotify (perfil oficial del sello): https://open.spotify.com/intl-es/artist/0yIGrWjWqKnM7qJ0uyImij
  - Playlist "Producciones Zeche Gruv": https://open.spotify.com/playlist/1FbK9IaTCJMCtTLQSg7ayI

## 2. Logo

- Archivo base: `assets/logo.png`
- Sol/estrella estilizado en tonos naranja-dorado sobre fondo marrón (`#4B2509`), con el wordmark "ZECHE GRUV" en tipografía custom con curvas orgánicas (estilo groovy/70s) y el subtítulo "RECORD LABEL" en versalitas espaciadas.
- El logo ya trae su propio fondo marrón — por eso en el sitio se usa con `mix-blend-mode: normal` (no hay que quitarle fondo para que funcione sobre `--brown`).

## 3. Paleta de colores

| Rol | Hex | Uso |
|---|---|---|
| Marrón (logo) | `#4B2509` | Fondo principal del sitio |
| Marrón oscuro | `#241105` | Fondos secundarios (marquee, sección "The Label", cards) |
| Marrón medio | `#69350B` | Gradientes, covers |
| Naranja | `#F07800` | Acento primario, hovers, botones activos |
| Naranja suave | `#F5A623` | Acento secundario, links, glow, cursor |
| Beige | `#F0E0C0` | Texto secundario, líneas |
| Crema | `#FFF4DC` | Texto principal sobre fondo marrón |
| Muted (derivado) | `#C9A980` | Footer, texto terciario |

Esta paleta está sacada directamente del logo — cualquier pieza nueva (merch, flyers, señalética de estudio) debería partir de estos mismos valores para no desviarse.

## 4. Tipografía

- **Display / cuerpo:** Manrope (400/500/600/700/800) — vía Google Fonts
- **Mono / detalle (labels, nav, meta info, eyebrows):** DM Mono (400/500) — todo en mayúsculas, tracking amplio (`letter-spacing` entre .13em y .18em)
- Los títulos grandes usan `letter-spacing` negativo (entre -.03em y -.085em) para efecto condensado/impactante, tamaños con `clamp()` responsive.

## 5. Lenguaje visual / estilo

- Estética oscura, cálida, tipo "sun-drenched underground" — marrón/naranja en vez del negro/neón típico de sellos electrónicos.
- Textura de grano (`.grain`, SVG noise) superpuesta a todo el sitio, muy sutil (opacity .035).
- Cursor custom circular que crece al pasar sobre links.
- Marquee horizontal infinito con el nombre del sello y ubicación.
- Grids asimétricos, rotaciones sutiles en covers (-2deg), animaciones con `cubic-bezier(.16,1,.3,1)` (easing tipo "editorial/premium").
- Numeración de secciones tipo catálogo: "01 / Latest Release", "02 / Catalogue", "03 / The Label", "04 / Demos & Collaborations".
- Catálogo con codename de release: formato `ZG — 001 / 2026`.

## 6. Estructura del sitio (base)

1. Nav fija (logo mark + Releases / The Label / Contact)
2. Hero con logo grande centrado, ubicación, descripción corta, scroll cue
3. Marquee de marca
4. Latest Release (cover + info + botones a Spotify/Apple Music/YouTube)
5. Catalogue (grid de releases anteriores)
6. The Label (statement + texto lateral)
7. Contact / Demos ("MAKE NOISE.")
8. Footer

## 7. Catálogo (releases)

**Latest Release (hero):** OKEY.

| Release | Artistas | Spotify | Cover |
|---|---|---|---|
| OKEY (latest) | Rouse bby, YEIKO, ZECHE GRUV | `open.spotify.com/album/7bc1Ig8bncv4p3vZjjZqjE` | `assets/covers/okey.jpg` |
| TODO TERRENO | Rouse bby, Maida, YEIKO, ZECHE GRUV | `open.spotify.com/album/6eU3XioAFeGQsepCbhuDwN` | `assets/covers/todo-terreno.png` |
| TACÚ (comp.) | Jugo Solar, Ekiss, Lil Mow, Kires, Mayro, Zekah, Manu, CRZN, Baller Fk, MATZ, Lowkey Santo, Question, Yaco Santana, Mindz, Valhen | `open.spotify.com/album/6YmySpzsNXMuxekqcmdlGJ` | `assets/covers/tacu.png` |
| YANINA | Axia Bebe, ZECHE GRUV | `open.spotify.com/track/2xAFzhjYAyvYHiBfkz80HY` | `assets/covers/yanina.jpg` |

Estética de covers: predominan fotos oscuras/contrastadas con tipografía grande superpuesta (neón verde en TODO TERRENO, rojo sobre grano en OKEY, blanco sobre foto grupal en TACÚ) — más urbana/nocturna que la paleta marrón-naranja del sitio. El sitio las integra en marcos con el mismo lenguaje de tarjetas (bordes, hover, rotación sutil) para que convivan sin perder la línea del sello.

## 8. Roster de artistas (27)

Kires, Rouse bby, Pazz, Midel, Mc Nito, Kamacho, Kizuato, BR1, Casteyano, Majo Chicar, Pastelita, Sorriso, Tobi Matarasso, Mc Anrry, Axia Bebe, Lusan, Borja Trece, Bhae, Anita Pau, Layla Mar, Maki, Yaco Santana, Bianca Biondi, Jugo Solar, BallerFk, Ekiss, Lowkey Santo.

IDs de Spotify, fotos de perfil y links completos están en el array `ARTISTS` dentro de `index.html` (sección Artists) — es la fuente de verdad para agregar/sacar artistas del roster.

## 9. Feature técnico: preview de audio al pasar el mouse

El sitio usa la Spotify IFrame API oficial (`open.spotify.com/embed/iframe-api/v1`) para reproducir un preview real de Spotify cuando el mouse pasa sobre: el nombre de un artista (roster o créditos de un release) o la tapa/título de un release. Aparece una barra angosta abajo de la pantalla con el reproductor de Spotify (se puede cerrar con la X). No requiere API key ni backend — es 100% client-side.

## 10. Pendiente / a definir con el usuario

- Fotos/links de Maida y YEIKO (créditos en TODO TERRENO/OKEY) para sumarlos al roster con preview.
- Aplicación de esta identidad a merch y señalética de estudio (fase futura).
- Definir si se agrega más música al catálogo a medida que salgan nuevos lanzamientos.

---
*Cada vez que se converse sobre la estética del sello, agregar acá los nuevos acuerdos (colores, tipografías, tono, referencias) para no perder la línea entre web, estudio y merch.*
