// GET /.netlify/functions/pass-qr?k=<clave de la entrada>
// Imagen PNG del QR de una entrada, para el mail (los programas de mail no
// muestran QR dibujados con código, solo imágenes). No consulta la base:
// solo dibuja lo mismo que muestra la página de la entrada.
const zlib = require("zlib");
const qrcode = require("qrcode-generator");

const SCALE = 10;   // píxeles por módulo
const MARGIN = 4;   // módulos de borde libre, lo que pide el estándar
const LIGHT = [0xff, 0xf4, 0xdc];
const DARK = [0x24, 0x11, 0x05];

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

// PNG de dos colores (paleta) a partir de los módulos del QR.
function qrPng(text) {
  const qr = qrcode(0, "H");
  qr.addData(text, "Alphanumeric");
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + MARGIN * 2) * SCALE;
  const raw = Buffer.alloc((size + 1) * size);  // cada fila: 1 byte de filtro + los píxeles
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / SCALE) - MARGIN;
    for (let x = 0; x < size; x++) {
      const col = Math.floor(x / SCALE) - MARGIN;
      const dark = row >= 0 && row < n && col >= 0 && col < n && qr.isDark(row, col);
      raw[y * (size + 1) + 1 + x] = dark ? 1 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;  // bits por píxel
  header[9] = 3;  // color por paleta
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", Buffer.from([...LIGHT, ...DARK])),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

exports.handler = async (event) => {
  const token = String((event.queryStringParameters || {}).k || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(token)) return { statusCode: 404, body: "" };
  return {
    statusCode: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
    body: qrPng(`ZGP1.${token.toUpperCase()}`).toString("base64"),
    isBase64Encoded: true,
  };
};
