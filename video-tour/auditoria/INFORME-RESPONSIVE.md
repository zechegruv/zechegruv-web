
---

## Estado después de las correcciones (14/10/2026)

Aprobadas y aplicadas. Están en `ZECHE_GRUV_Web/portal/pulido.css`, `pulido.js` y una línea de `revision.js`; no cambia la lógica del portal.

| Punto | Qué se hizo | Resultado de la nueva auditoría |
|---|---|---|
| 1. Error en la onda | El radio nunca baja de 0 | ✅ Sin errores de JavaScript en ninguna pantalla |
| 2. Atajos de nota cortados | En compu y tablet bajan de línea; en el celu, degradé en el borde | ✅ Se ven todos |
| 3. Letra chica | Etiquetas a 11 px como mínimo (12 en el celu) y ayudas a 13 px | ✅ Ya no quedan textos de 8–10 px en el portal del artista |
| 4. Toques chicos | "Volver", logo, guías, casillas y botones de orden con área de 40–44 px | ✅ Quedan solo falsos positivos: etiquetas de campos (el toque es el campo) y textos para lectores de pantalla |
| 5. Pestañas cortadas | Degradé suave del lado donde hay más pestañas (`data-fade`) | ✅ |
| 6. Login viejo | Piel nueva: Bricolage y Geist, pastillas, tarjeta naranja y entrada animada | ✅ |

Las capturas de `capturas/`, `informe.md` y `datos.json` ya son de **después** de las correcciones.
