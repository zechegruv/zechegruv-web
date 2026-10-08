// ZG PASS — el mail con las entradas de una compra. Tablas y estilos en
// línea, como piden los programas de mail; misma estética que los mails
// del portal (supabase/emails/).
const TZ = "America/Argentina/Buenos_Aires";
const MONO = "font-family:'Courier New',Courier,monospace;";
const SANS = "font-family:Helvetica,Arial,sans-serif;";

const esc = (text) => String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
// "Sáb 24 oct 2026", igual que en la entrada.
const fmtDate = (iso) => capital(new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)).replace(/[.,]/g, ""));
const fmtTime = (iso) => `${new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))} h`;
const fmtMoney = (value) => `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(value)}`;

// Colores y logo según el tipo de experiencia, como en la entrada de la web.
const KINDS = {
  show: { time: "Hora", bg: "#241105", line: "#5a4632", dim: "#C9A980", accent2: "#B98AC9", logo: "pass-shows.png", alt: "ZECHE GRUV Shows &amp; Open Mic", kicker: "Show + Open mic", note: "Mostrá este QR en la puerta. Cada entrada sirve para un solo ingreso." },
  camp: { time: "Ingreso", bg: "#232c16", line: "#5c6344", dim: "#B9BE94", accent2: "#A9B77A", logo: "pass-camp.png", alt: "ZECHE GRUV Camp", kicker: "Campamento creativo", note: "Mostrá este QR al llegar. Cada entrada sirve para un solo ingreso." },
};

const button = (href, text, primary) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px;"><tr><td style="background:${primary ? "#F07800" : "#241105"};border:1px solid ${primary ? "#F07800" : "#6b4a2c"};">
<a href="${href}" style="display:inline-block;padding:15px 22px;${MONO}font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#FFF4DC;text-decoration:none;">${text}</a>
</td></tr></table>`;

// order: { number, total, access_token, buyer_first_name } · ev: evento ·
// tickets: [{ code, token, holder_name, type }] · base: dirección del sitio
function ticketEmail({ order, ev, tickets, base, openmicOpen }) {
  const many = tickets.length > 1;
  const orderUrl = `${base}/pass/orden/?t=${order.access_token}`;
  const kind = KINDS[ev.kind] || KINDS.show;
  const lineup = (ev.lineup || []).filter(Boolean);
  const cell = (text, sub) => `<div style="${MONO}font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${kind.dim};padding:0 0 4px;">${text}</div><div style="${SANS}font-size:16px;font-weight:700;color:#FFF4DC;line-height:1.2;">${sub}</div>`;
  // Cada entrada, con el mismo armado que la entrada digital de la web.
  const cards = tickets.map((t, i) => `
<tr><td align="center" style="padding:18px 16px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:380px;background:${kind.bg};border:1px solid ${kind.line};border-radius:22px;">
<tr><td style="padding:20px 22px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><img src="${base}/assets/mail/zg-pass.png" width="98" height="22" alt="ZG PASS" style="display:block;border:0;"><div style="${MONO}font-size:8px;letter-spacing:2px;color:${kind.dim};padding-top:6px;">ZECHE GRUV &middot; RECORD LABEL</div></td>
<td valign="middle" align="right"><span style="display:inline-block;${MONO}font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${kind.accent2};border:1px solid ${kind.accent2};border-radius:999px;padding:7px 11px;">${esc(t.type)}</span></td>
</tr></table>
</td></tr>
<tr><td align="center" style="padding:18px 22px 0;"><img src="${base}/assets/mail/${kind.logo}" height="170" alt="${kind.alt}" style="display:block;height:170px;width:auto;border:0;"></td></tr>
<tr><td style="padding:18px 22px 0;${MONO}font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${kind.accent2};">${kind.kicker}</td></tr>
<tr><td style="padding:8px 22px 0;${SANS}font-size:27px;line-height:1.04;font-weight:800;letter-spacing:-1px;color:#FFF4DC;">${esc(ev.name)}</td></tr>
<tr><td style="padding:20px 22px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="56%" valign="top">${cell("Fecha", fmtDate(ev.starts_at))}</td>
<td valign="top">${cell(kind.time, fmtTime(ev.starts_at))}</td>
</tr></table>
</td></tr>
<tr><td style="padding:16px 22px 0;">${cell("Lugar", `${esc(ev.venue_name || "")}${ev.venue_address ? `<br><span style="font-weight:400;font-size:13px;color:#F0E0C0;">${esc(ev.venue_address)}</span>` : ""}`)}</td></tr>
${lineup.length ? `<tr><td style="padding:16px 22px 0;">${cell("Line up", `<span style="text-transform:uppercase;font-weight:800;font-size:16px;">${lineup.map(esc).join(' <span style="color:#F5A623;">&middot;</span> ')}</span>`)}</td></tr>` : ""}
<tr><td style="padding:22px 22px 0;"><div style="border-top:2px dashed ${kind.line};font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td align="center" style="padding:18px 22px 0;${MONO}font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${kind.dim};">Titular</td></tr>
<tr><td align="center" style="padding:4px 22px 0;${SANS}font-size:19px;font-weight:800;color:#FFF4DC;">${esc(t.holder_name)}</td></tr>
<tr><td align="center" style="padding:16px 22px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#FFF4DC;border:1px solid #F5A623;border-radius:18px;padding:6px;">
<img src="${base}/.netlify/functions/pass-qr?k=${t.token}" width="210" height="210" alt="Código QR de tu entrada ${esc(t.code)}" style="display:block;width:210px;height:210px;border:0;border-radius:12px;">
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:14px 22px 0;${MONO}font-size:15px;letter-spacing:3px;color:#F5A623;">${esc(t.code)}</td></tr>
<tr><td style="padding:16px 22px 0;"><div style="border-top:1px solid ${kind.line};padding-top:14px;${SANS}font-size:12px;line-height:1.5;color:#F0E0C0;">${ev.important_info ? esc(ev.important_info).replace(/\n/g, "<br>") : kind.note}</div></td></tr>
<tr><td style="padding:14px 22px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="${MONO}font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${kind.dim};">Entrada ${i + 1} de ${tickets.length}</td>
<td align="right" style="${MONO}font-size:9px;letter-spacing:2px;text-transform:uppercase;color:${kind.dim};">zechegruv.com</td>
</tr></table>
</td></tr>
</table>
</td></tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>ZG PASS</title>
</head>
<body style="margin:0;padding:0;background:#241105;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#241105;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#4B2509;border:1px solid #6b4a2c;">
<tr><td style="padding:28px 32px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="34" height="34" style="width:34px;height:34px;background-image:url('https://www.zechegruv.com/assets/mail/sol.png');background-repeat:no-repeat;background-position:center;background-size:34px 34px;font-size:0;line-height:0;">&nbsp;</td>
<td style="padding-left:10px;${MONO}font-size:12px;letter-spacing:3px;color:#FFF4DC;">ZECHE GRUV&reg;</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0;${MONO}font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#F5A623;">ZG PASS</td></tr>
<tr><td style="padding:10px 32px 0;${SANS}font-size:30px;line-height:1.05;font-weight:800;letter-spacing:-1px;color:#FFF4DC;">¡Ya tenés tu lugar, ${esc(order.buyer_first_name)}!</td></tr>
<tr><td style="padding:20px 32px 0;${SANS}font-size:15px;line-height:1.6;color:#F0E0C0;">Tu compra está confirmada. ${many ? "Estas son tus entradas:" : "Esta es tu entrada:"}</td></tr>
${cards}
<tr><td style="padding:26px 32px 0;">
${button(orderUrl, many ? "Ver mis entradas &rarr;" : "Ver mi entrada &rarr;", true)}
${button(`${orderUrl}&amp;pdf=1`, "Descargar PDF", false)}
</td></tr>
<tr><td style="padding:18px 32px 0;${MONO}font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#F5A623;">Para entrar</td></tr>
<tr><td style="padding:8px 32px 0;${SANS}font-size:14px;line-height:1.6;color:#F0E0C0;">Mostrá el QR desde el celular o impreso. Cada QR sirve para un solo ingreso: no lo publiques en redes.</td></tr>
${openmicOpen ? `<tr><td style="padding:24px 32px 0;${MONO}font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#F5A623;">¿Vas a cantar en el open mic?</td></tr>
<tr><td style="padding:8px 32px 0;${SANS}font-size:14px;line-height:1.6;color:#F0E0C0;">Anotate y subí tu canción desde la página de ZECHE GRUV.</td></tr>
<tr><td style="padding:14px 32px 0;">${button(`${base}/pass/openmic/?t=${order.access_token}`, "Anotarme al open mic &rarr;", false)}</td></tr>` : ""}
<tr><td style="padding:22px 32px 0;${SANS}font-size:13px;line-height:1.6;color:#C9A980;">Orden ${esc(order.number)} &middot; ${tickets.length} ${many ? "entradas" : "entrada"} &middot; Total ${fmtMoney(order.total)}</td></tr>
<tr><td style="padding:14px 32px 0;${SANS}font-size:13px;line-height:1.6;color:#C9A980;">¿Alguna duda? Respondé este mail. Nos vemos ahí.</td></tr>
<tr><td style="padding:14px 32px 0;${SANS}font-size:12px;line-height:1.6;color:#C9A980;">Si los botones no funcionan, copiá y pegá este link en tu navegador:<br><a href="${orderUrl}" style="color:#F5A623;word-break:break-all;">${orderUrl}</a></td></tr>
<tr><td style="padding:30px 32px 30px;${MONO}font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#C9A980;">ZECHE GRUV&reg; &mdash; Buenos Aires &middot; <a href="https://www.zechegruv.com" style="color:#C9A980;">zechegruv.com</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject: `${many ? "Tus entradas" : "Tu entrada"} para ${ev.name}`, html };
}

module.exports = { ticketEmail };
