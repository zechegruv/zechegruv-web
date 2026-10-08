# ZECHE GRUV — Portal de Artistas (Roadmap)

> Documento de planificación. No se implementó nada todavía — el sitio (`index.html`) sigue siendo 100% estático. Esto sirve para ir ordenando la idea hasta que estemos seguros de que cada pieza va a funcionar bien antes de tocar código.

**Fecha:** 2026-08-24

---

## 1. La idea, en una frase

Cada artista entra con usuario y contraseña a su propia página dentro del sitio, donde puede: ver y retirar los fondos generados por sus canciones, ver próximas sesiones de estudio, ver sus contratos, y (más adelante) ver los archivos de su carpeta de OneDrive sin salir de la página.

## 2. Por qué esto ya no es "una página más"

El sitio actual es un único archivo HTML estático: no tiene servidor, base de datos, ni forma de guardar contraseñas o saber quién sos cuando entrás. Eso funciona perfecto para mostrar releases y artistas, pero ninguna de estas cuatro cosas puede vivir en un HTML estático:

- **Login real** (usuario/contraseña por artista) necesita un sistema de autenticación en un servidor.
- **Ver y retirar dinero** necesita una base de datos que sepa cuánto generó cada canción, y un procesador de pagos real que mueva la plata (esto tiene implicancias legales/impositivas — no es algo para armar "a mano").
- **Contratos** necesitan almacenamiento privado por artista, no un archivo público en una carpeta.
- **Sesiones de estudio** necesitan algo que se pueda actualizar (una agenda), no texto fijo en el HTML.

En criollo: el sitio pasa de ser una landing page a ser una aplicación web con cuentas de usuario. Es totalmente viable, pero es otro proyecto — vale la pena separarlo del sitio público para no mezclar riesgos (un bug en la landing no debería poder tocar la plata de un artista).

## 3. Las cuatro piezas, una por una

### a) Login por artista
Lo más simple y probado: un proveedor de autenticación ya hecho (ej. Supabase Auth, Firebase Auth, Clerk) en vez de programarlo de cero. Cada artista tiene un usuario; vos les creás el acceso inicial. Esto ya te resuelve "usuario y contraseña únicos" sin tener que guardar contraseñas vos mismo (que es justamente lo que no conviene hacer a mano, por seguridad).

### b) Ver y retirar fondos
Esta es la pieza más delicada porque hay plata real de por medio. Se necesita:
- Una base de datos que lleve la cuenta de cuánto generó cada artista (¿de dónde sale ese número? ¿lo cargás vos a mano, o viene de un reporte de distribución/Spotify/DistroKid?).
- Un procesador de pagos para el retiro en sí — en Argentina lo más directo suele ser Mercado Pago (tienen APIs para pagos a terceros) o una transferencia bancaria gestionada manualmente al principio.
- Idealmente, antes de programar el botón de "retirar", conviene tener claro el proceso contable/legal (¿hay que facturar? ¿retenciones?). Esto te lo puede confirmar mejor un contador que yo — pasame la posta cuando la tengas y lo modelamos en la base de datos.

Sugerencia para arrancar sin riesgo: la primera versión puede mostrar el saldo (solo lectura) sin botón de retiro automático — el retiro se pide desde ahí pero lo procesás vos manualmente al principio. Automatizar el pago en sí puede ser una fase 2, una vez que el número de artistas activos lo justifique.

### c) Próximas sesiones
La más simple de las cuatro. Alcanza con un calendario compartido (Google Calendar, por ejemplo) con un evento por artista/sesión, y en la página de cada artista se muestra nada más lo que le corresponde a él. No hace falta programar un calendario propio.

### d) Contratos
Cada artista ve solo los suyos. Se puede resolver con almacenamiento privado por artista (una carpeta protegida, o incluso reusar la idea de OneDrive del punto siguiente pero para PDFs de contratos en vez de archivos de música) o con una plataforma de firma como DocuSign, que ya trae el historial de versiones y firmas.

## 4. Lo de OneDrive — esto sí es bastante directo

Mostrar el contenido de una carpeta de OneDrive *dentro* de la página (sin abrir OneDrive ni redirigir) es técnicamente accesible: Microsoft tiene una API (Graph API) que permite listar y mostrar los archivos de una carpeta compartida embebidos en cualquier sitio, en modo solo lectura si es lo que querés. No hace falta que el artista tenga cuenta de Microsoft para verla.

Lo que se necesita de tu lado cuando lo retomemos:
- Que cada carpeta de artista esté compartida (o dentro de una estructura común) en tu OneDrive.
- Registrar una app en Microsoft Azure (gratis) para poder pedir permiso de lectura a esas carpetas — es un trámite de una sola vez, no por artista.
- El link de la carpeta de cada artista, para mapear "artista → carpeta".

Como bien decís, esto se organiza por perfil (27 artistas hoy, van a ser más), así que tiene sentido dejarlo para cuando el login ya esté funcionando — ahí cada carpeta se cuelga del perfil que ya existe, en vez de armar los dos sistemas en paralelo.

## 5. Orden sugerido (para cuando lo retomemos)

1. **Login** — cuentas creadas para cada artista, cada uno entra y ve una página propia (aunque esté vacía al principio).
2. **Sesiones + contratos** — las dos piezas de menor riesgo, dan valor rápido y sirven para probar que el login/permisos funcionan bien (cada artista ve solo lo suyo).
3. **OneDrive embebido** — una vez que el login está sólido, se cuelga carpeta por carpeta.
4. **Fondos** — se deja para el final porque es la pieza con más responsabilidad (plata real), y para entonces ya vamos a haber probado que el sistema de cuentas es confiable con las otras tres piezas.

## 6. Decisiones que vamos a necesitar más adelante

- ~~¿Dónde vive el sitio hoy (hosting)?~~ **Definido: Netlify.** Ver sección 7.
- **Fuente de los fondos por canción: definido.** Cada artista tiene su propio perfil dentro de la distribuidora (Mafuldistribution, sobre la plataforma zil.gl: `https://mafuldistribution.zil.gl/`), ahí es donde se ve lo que generó cada canción. Falta confirmar si esa plataforma ofrece alguna forma de exportar/consultar esos datos automáticamente (API, CSV, webhook) o si al principio va a ser carga manual de tu parte hacia la base de datos del portal — esto lo reviso apenas quieras avanzar con esa pieza (lo ideal sería que me des acceso de lectura a un perfil de prueba, o que me digas qué opciones de exportación ves vos dentro del panel).
- Definir el proceso de retiro con tu contador antes de tocar código de pagos.
- Links de las carpetas de OneDrive por artista (cuando lleguemos a esa fase).
- Quién carga los contratos y con qué frecuencia (para saber si conviene subida manual tuya o que cada artista pueda subir el propio).

## 7. Hosting: Netlify

Elegido. Dos formas de ponerlo en marcha, para cuando quieras dar el paso:

- **Arrastrar y soltar (la más simple):** entrás a app.netlify.com, te creás una cuenta gratis, y arrastrás la carpeta del sitio (`ZECHE_GRUV_Web 2`) a la página de Netlify. Queda online en un minuto, con una URL tipo `zeche-gruv.netlify.app` (se puede después apuntar tu propio dominio si comprás uno). Cada vez que haya cambios, se vuelve a arrastrar la carpeta actualizada.
- **Conectado a un repositorio (mejor a mediano plazo, sobre todo pensando en el portal de artistas):** el sitio vive en GitHub y Netlify lo publica solo cada vez que se actualiza el repositorio. Es un poco más de trabajo inicial pero es el camino natural para cuando el sitio deje de ser un solo HTML y empecemos a sumarle el login/backend del portal.

No hace falta decidir esto ahora — para el sitio actual (estático) alcanza con la opción de arrastrar y soltar. Si querés, en la próxima sesión te ayudo a dejarlo publicado.

---
*Este documento se actualiza cada vez que avancemos una pieza del portal. Por ahora el sitio público (`index.html`) no tiene ningún cambio relacionado a esto.*
