#!/bin/sh
# Corre todas las pruebas del panel (cada una en su propio proceso) y el node --check de lo tocado.
cd "$(dirname "$0")"
fails=0
for t in t*.js; do node "$t" > "/tmp/zg-$t.out" 2>&1 || { fails=$((fails+1)); cat "/tmp/zg-$t.out"; }; tail -1 "/tmp/zg-$t.out"; done
for f in $(git -C ../panel diff --name-only 222d379 HEAD | grep '\.js$'); do node --check "../panel/$f" || { echo "SINTAXIS MAL: $f"; fails=$((fails+1)); }; done
echo "node --check: $(git -C ../panel diff --name-only 222d379 HEAD | grep -c '\.js$') archivos"
[ $fails -eq 0 ] && echo "TODO VERDE" || echo "FALLAS: $fails"
exit $fails
