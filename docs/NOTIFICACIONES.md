# Notificaciones del portal

Al artista le llega una notificación en el celu (con el portal instalado) o en la compu (Chrome, Edge o Safari), con el logo de ZECHE GRUV. Es **gratis**: no pasa por ningún proveedor pago ni se cobra por aviso. Siempre se suma al mail, nunca lo reemplaza.

## Qué le llega y cuándo

**Tu proyecto** (sale solo, en el mismo momento que el mail):

| Cuándo | Título |
| --- | --- |
| Entregás una mezcla | Tu mezcla de «Seu amor» está lista |
| Entregás un master | El master de «Seu amor» está listo |
| Entregás la versión con las modificaciones | Ya están las modificaciones de «Seu amor» |
| 3 y 7 días sin escucharla | «Seu amor» te está esperando |
| Reprogramás la entrega desde el Inicio | Nueva fecha para «Seu amor» |

**Eventos** (Shows & Open Mic publicados):

| A quién | Cuándo | Título |
| --- | --- | --- |
| Artistas del sello que **no** están en el line up | Una vez, entre las 12 y las 21 h, si el evento es en los próximos 14 días y el open mic está abierto | Open mic del sábado 31 |
| Artistas del sello que **tocan** | El día del show, desde las 10 h | Hoy tocás en Shows & Open Mic 3 |

- **Horario de silencio:** de 00 a 9 h no sale nada; lo de la noche llega a las 9.
- **Tope:** como mucho 2 avisos de eventos por semana a cada artista (el del día del show no cuenta).
- Cada aviso sale **una sola vez**.
- Al tocar la notificación se abre el portal en *Tus canciones* (o la página del evento).

## Quién toca: se actualiza solo con el line up

Cuando guardás el evento con su line up, cada nombre se busca entre los artistas del portal y los que coinciden quedan como «quién toca» (sin tildarlos en *Carpetas*). Reconoce mayúsculas, tildes, una letra de diferencia («Rose Bby» → Rouse Bby) y dúos («Bastian & Kaino» → Bastian). Si sacás un nombre del line up, ese artista deja de figurar. Al guardar, el panel te dice quiénes quedaron y quiénes no tienen cuenta en el portal (esos, si suben pistas, van como invitados en *Carpetas*).

## Lo que ve el artista

- En **Mi proyecto**, una tarjeta: «Enterate apenas esté tu mezcla», con dos interruptores (*Tu proyecto* / *Eventos*) y **Activar avisos**. El navegador pide el permiso recién al tocar ese botón. Con «Ahora no», no vuelve a aparecer por 30 días.
- En **Mi perfil → Notificaciones**: los dos tipos, si están activas en ese dispositivo, **Probar** y **Desactivar**.
- En iPhone llegan solo con el portal agregado a la pantalla de inicio (el aviso de instalar ya lo explica).
- Al cerrar sesión, ese dispositivo deja de recibir.

## Para activarlo (una sola vez)

1. **Supabase:** pegá `supabase/035_notificaciones.sql` en *SQL Editor* → *Run*.
2. **Netlify** → *Site configuration* → *Environment variables*: cargá las dos claves que te pasó Claude (son un par: van juntas).

| Variable | Qué es |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Clave pública (la usa el navegador para suscribirse). |
| `VAPID_PRIVATE_KEY` | Clave privada: **marcala como secreta**. Con ella los navegadores reconocen que el aviso viene de zechegruv.com. |

3. *Deploys* → *Trigger deploy*.

No cambies las claves una vez que los artistas activaron las notificaciones: con claves nuevas, cada uno tendría que volver a activarlas.

En el panel, **Estado del sistema → Notificaciones del portal** dice si están configuradas y cuántos artistas las tienen activas.
