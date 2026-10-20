#!/bin/bash
# Corre todas las pruebas del portal (Node + navegador). Sale con 1 si alguna falla.
cd "$(dirname "$0")"
export NODE_PATH=$(npm root -g)
fail=0
for t in t06-ficha-por-nombre t07-titulo-en-el-nombre t08-fecha-de-subida t08b-notas-guardadas t09-letras-sin-conexion t10a-envio-repetido t10b-cerrar-mientras-envia t11-sin-supabase t18-sesion-vencida t19-perfil-sin-red t20-link-de-invitacion t21-aprobar-doble-toque t22-medir-solo-la-actual t23-link-de-audio-vencido t24-canciones-sin-esperar t25-instalable-sin-conexion t50-limpieza tE1-subida tE2E3-pistas-de-shows; do
  echo "== $t"
  timeout 300 node "$t.js" || fail=1
done
echo; [ $fail = 0 ] && echo "TODAS PASAN" || echo "HAY FALLAS"
exit $fail
