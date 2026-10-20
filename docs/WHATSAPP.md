# Avisos por WhatsApp a los artistas

Además del mail (nunca en lugar del mail), al artista le llega un WhatsApp cuando:

- su **mezcla** está lista para escuchar,
- su **master** está listo,
- están hechas las **modificaciones** que pidió (mezcla o master),
- y un **recordatorio** a los 3 y a los 7 días si todavía no lo escuchó.

Sale una sola vez por entrega o recordatorio. El número sale de su ficha en Notion (**Clientes Zeche Gruv → Teléfono**). Cada artista lo puede apagar desde su portal (**Mi perfil → Avisos por WhatsApp**). En el panel, la ficha de cada artista muestra en una línea si tiene teléfono y si los avisos están activos.

Mientras no esté conectado (pasos de abajo), no se manda nada y todo sigue funcionando igual que ahora.

---

## 1. Las 4 plantillas (crearlas en Meta)

WhatsApp solo deja escribirle primero a alguien con **plantillas aprobadas por Meta**. Crear estas cuatro, todas con:

- **Categoría:** Utilidad (UTILITY)
- **Idioma:** Español (ARG) — código `es_AR`
- **Variables:** `{{1}}` = primer nombre del artista, `{{2}}` = nombre de la canción. Meta pide un ejemplo de cada una: poné `Pazz` y `Seu amor`.
- **Botón:** "Visitar sitio web", URL **estática** `https://www.zechegruv.com/portal/` (sin parte variable: el link es siempre el mismo).

El nombre de cada plantilla tiene que ser exactamente el de abajo (si en Meta queda con otro nombre, ver la sección 4).

### `zg_mezcla_lista`
> Hola {{1}}, terminé la mezcla de «{{2}}». Ya la podés escuchar en el portal. Si te gusta cómo quedó, aprobala y pasamos al master. Si querés cambiar algo, dejá tu modificación en el segundo exacto y lo ajusto.

Botón: **Escuchar la mezcla**

### `zg_master_listo`
> Hola {{1}}, el master de «{{2}}» está listo. Escuchalo en el portal de punta a punta, en auriculares, en el celu y en el auto. Si lo aprobás, la canción queda terminada. Si algo no te cierra, dejá tu modificación y lo ajusto.

Botón: **Escuchar el master**

### `zg_modificaciones_listas`
> Hola {{1}}, ya están hechas las modificaciones que pediste en «{{2}}». Escuchá la versión nueva en el portal y decime si querés cambiar algo más o si la aprobás.

Botón: **Escuchar en el portal**

(Esta misma sirve para las modificaciones de la mezcla y del master; por eso no dice "pasamos al master".)

### `zg_recordatorio_escucha`
> Hola {{1}}, te recuerdo que la versión nueva de «{{2}}» te está esperando en el portal. Cuando puedas, escuchala y decime si la aprobás o si querés hacerle modificaciones.

Botón: **Escuchar en el portal**

La aprobación tarda de unos minutos a 24 h. Si Meta rechaza una, suele ser por el texto: se puede editar y volver a mandar.

---

## 2. Conectar WhatsApp (una sola vez)

1. **Cuenta de Meta Business.** Entrá a business.facebook.com con la cuenta de ZECHE GRUV (si no existe, se crea ahí).
2. **Crear la app.** En developers.facebook.com → *Mis apps* → *Crear app* → tipo *Empresa* → elegí la cuenta de ZECHE GRUV. Dentro de la app, *Agregar producto* → **WhatsApp**.
3. **El número.** En *WhatsApp → Configuración de la API* → *Agregar número de teléfono*. Tiene que ser un número que **no** esté usando la app común de WhatsApp (o hay que pasarlo a la API). Se verifica con un código por SMS o llamada. Elegí el nombre que se ve: *ZECHE GRUV*.
4. **Copiar el ID del número.** En esa misma pantalla, copiá el **Identificador del número de teléfono** (son solo números, no es el teléfono). Ese es `WHATSAPP_PHONE_ID`.
5. **Token permanente.** En business.facebook.com → *Configuración del negocio* → *Usuarios* → *Usuarios del sistema* → *Agregar* (rol Administrador). Después *Asignar activos*: la app (control total) y la cuenta de WhatsApp. Tocá *Generar token*, elegí la app, caducidad **Nunca**, y marcá los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Copiá el token (se ve una sola vez). Ese es `WHATSAPP_TOKEN`.
6. **Forma de pago.** En *WhatsApp Manager → Configuración de pagos*, cargá una tarjeta: Meta cobra cada aviso de plantilla (los de Utilidad son baratos).
7. **Crear las plantillas** de la sección 1 en *WhatsApp Manager → Plantillas de mensajes* y esperar que queden *Activas*.

## 3. Cargar las variables en Netlify

En Netlify → el sitio → *Site configuration* → *Environment variables* → *Add a variable*:

| Variable | Qué poner |
| --- | --- |
| `WHATSAPP_TOKEN` | El token permanente del paso 5 (marcala como secreta). |
| `WHATSAPP_PHONE_ID` | El identificador del número del paso 4. |
| `WHATSAPP_LANG` | Opcional. Solo si las plantillas no se crearon en Español (ARG): p. ej. `es` para "Español". Por defecto `es_AR`. |

Después: *Deploys* → *Trigger deploy* para que tome los cambios.

## 4. Si una plantilla quedó con otro nombre

Se puede cambiar sin tocar código, con estas variables (opcionales) en Netlify:

| Variable | Por defecto |
| --- | --- |
| `WHATSAPP_TPL_MEZCLA` | `zg_mezcla_lista` |
| `WHATSAPP_TPL_MASTER` | `zg_master_listo` |
| `WHATSAPP_TPL_CAMBIOS` | `zg_modificaciones_listas` |
| `WHATSAPP_TPL_RECORDATORIO` | `zg_recordatorio_escucha` |

## 5. Antes de usarlo

1. **Supabase:** pegá `supabase/033_whatsapp.sql` en *SQL Editor* → *Run* (suma el interruptor de cada artista; viene prendido para todos).
2. **Notion:** completá **Teléfono** en la ficha de cada artista en *Clientes Zeche Gruv*, con característica: `11 3328 7422`, `011 15 3328-7422` o `+54 9 11 3328-7422` sirven igual. Un número de otro país, con `+` y su código (`+58 …`, `+55 …`).
3. **Probar:** con tu propio número cargado en una ficha de prueba, tocá *Entregado* en una canción. Te tiene que llegar el mail y el WhatsApp.

Si el WhatsApp no llega, en Netlify → *Logs* → *Functions* aparece "WhatsApp rechazó el aviso" con el motivo (lo más común: la plantilla todavía no está aprobada o tiene otro nombre). El mail sale igual.
