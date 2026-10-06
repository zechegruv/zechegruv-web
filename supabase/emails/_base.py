# Genera las plantillas de mail del portal (invitación y recuperación) con
# el mismo diseño. Uso: python3 supabase/emails/_base.py
# El HTML resultante se pega en Supabase → Authentication → Emails.
import io, os

# El link lleva a la página del portal (mismo dominio que el sitio) con un
# código de un solo uso; el portal lo canjea. Que el link sea del propio
# dominio, y no de supabase.co, ayuda a que el mail no caiga en spam.
def link(kind):
    return "https://zechegruv.com/portal/?token_hash={{ .TokenHash }}&amp;type=" + kind

def mail(kind, title, intro, box, button, after):
    url = link(kind)
    return f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>ZECHE GRUV</title>
</head>
<body style="margin:0;padding:0;background:#241105;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#241105;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#4B2509;border:1px solid #6b4a2c;">
<tr><td style="padding:28px 32px 0;font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:3px;color:#FFF4DC;">
<img src="https://zechegruv.com/assets/favicon/apple-touch-icon.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;margin-right:10px;">ZECHE GRUV&reg;
</td></tr>
<tr><td style="padding:28px 32px 0;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#F5A623;">Portal de artistas</td></tr>
<tr><td style="padding:10px 32px 0;font-family:Helvetica,Arial,sans-serif;font-size:30px;line-height:1.05;font-weight:800;letter-spacing:-1px;color:#FFF4DC;">{title}</td></tr>
<tr><td style="padding:20px 32px 0;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#F0E0C0;">{intro}</td></tr>
{box}
<tr><td style="padding:26px 32px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#F07800;">
<a href="{url}" style="display:inline-block;padding:15px 22px;font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#FFF4DC;text-decoration:none;">{button} &rarr;</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:22px 32px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#C9A980;">{after}</td></tr>
<tr><td style="padding:14px 32px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#C9A980;">Si el botón no funciona, copiá y pegá este link en tu navegador:<br><a href="{url}" style="color:#F5A623;word-break:break-all;">{url}</a></td></tr>
<tr><td style="padding:30px 32px 30px;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#C9A980;border-top:0;">ZECHE GRUV&reg; &mdash; Buenos Aires &middot; <a href="https://zechegruv.com" style="color:#C9A980;">zechegruv.com</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>
'''

def row(label, value):
    return f'''<tr><td style="padding:0 0 4px;font-family:'Courier New',Courier,monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#C9A980;">{label}</td></tr>
<tr><td style="padding:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#FFF4DC;">{value}</td></tr>'''

def box(rows):
    return f'''<tr><td style="padding:22px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#241105;border:1px solid #6b4a2c;"><tr><td style="padding:18px 20px 4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
{rows}
</table>
</td></tr></table>
</td></tr>'''

here = os.path.dirname(os.path.abspath(__file__))

invite = mail(
    "invite",
    "Tu espacio ya<br>está listo.",
    "Hola{{ if .Data.display_name }}, <b>{{ .Data.display_name }}</b>{{ end }}. Te creamos tu cuenta en el portal de artistas de ZECHE GRUV. Ahí vas a encontrar todo lo de tu proyecto en un solo lugar: tus referencias y letras, los exports y masters de cada canción, tu membresía y el formulario para distribuir tu música.",
    box(row("Usuario", "{{ .Email }}") + "\n" + row("Contraseña", "La elegís vos en tu primer ingreso") + "\n" + row("Dirección del portal", '<a href="https://zechegruv.com/portal/" style="color:#F5A623;text-decoration:none;">zechegruv.com/portal</a>')),
    "Entrar por primera vez",
    "Este link es personal y sirve una sola vez: vence en 24 horas. Si se venció, entrá a zechegruv.com/portal, tocá “¿Olvidaste tu contraseña?” y te mandamos uno nuevo.",
)
io.open(os.path.join(here, "invitacion.html"), "w", encoding="utf-8").write(invite)

recovery = mail(
    "recovery",
    "Elegí una<br>contraseña nueva.",
    "Recibimos un pedido para cambiar la contraseña de tu cuenta en el portal de artistas de ZECHE GRUV. Tocá el botón y elegí una nueva.",
    box(row("Usuario", "{{ .Email }}")),
    "Cambiar mi contraseña",
    "El link sirve una sola vez y vence en 24 horas. Si no pediste este cambio, ignorá este mail: tu contraseña sigue siendo la misma.",
)
io.open(os.path.join(here, "recuperar.html"), "w", encoding="utf-8").write(recovery)
print("ok")
