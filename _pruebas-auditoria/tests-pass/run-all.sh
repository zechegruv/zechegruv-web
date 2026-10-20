#!/bin/bash
# Corre todas las pruebas de ZG PASS / web (SQL real, functions, estáticas y navegador).
# Necesita el Postgres de prueba levantado (ver sqlrun.sh / README del informe).
cd "$(dirname "$0")"
PG=/var/lib/postgresql/zgpass-test
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PG status >/dev/null || /usr/lib/postgresql/16/bin/pg_ctl -D $PG -o '-p 55432 -k $PG' -l $PG/log -w start >/dev/null"
fail=0
echo "== node --check de los .js tocados =="
for f in $(git -C ../pass diff --name-only 222d379 HEAD -- '*.js'); do node --check "../pass/$f" || fail=1; done
python3 -I -B -m py_compile ../pass/ZECHE_GRUV_Web/scripts/generate_artist_pages.py 2>&1 && rm -rf ../pass/ZECHE_GRUV_Web/scripts/__pycache__
echo "== SQL (Postgres 16 real) =="; node sql.test.js 2>&1 | grep -v NOTICE || fail=1
echo "== Netlify Functions =="; node fn.test.js 2>/dev/null || fail=1
echo "== Estáticas =="; node static.test.js || fail=1
echo "== Navegador (Chromium 375 px) =="; NODE_PATH=$(npm root -g) node web.test.js || fail=1
echo; [ $fail = 0 ] && echo "TODO EN VERDE" || echo "HAY FALLAS"
exit $fail
