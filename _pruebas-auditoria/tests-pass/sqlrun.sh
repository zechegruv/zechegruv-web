#!/bin/bash
# Crea una base nueva "zgtest" con las migraciones de ZG PASS (y 031 si existe).
# Uso: ./sqlrun.sh  → deja la base lista; después psql corre los casos.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
REPO="$DIR/../pass"
PGH=/var/lib/postgresql/zgpass-test
PSQL="psql -h $PGH -p 55432 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists zgtest" -c "create database zgtest" >/dev/null
$PSQL -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon; create role authenticated; create role service_role; end if; end \$\$;" >/dev/null
grep -v "^create role" "$DIR/sql-bootstrap.sql" | $PSQL -d zgtest >/dev/null
for f in 007_zg_pass 008_open_mic 012_lineup 016_shows_pistas 017_shows_carpetas 018_puerta_codigo; do
  $PSQL -d zgtest -f "$REPO/supabase/$f.sql" >/dev/null 2>&1 || { echo "falló $f"; $PSQL -d zgtest -f "$REPO/supabase/$f.sql"; exit 1; }
done
if [ -f "$REPO/supabase/031_pass.sql" ]; then
  $PSQL -d zgtest -f "$REPO/supabase/031_pass.sql" >/dev/null
  # 031 se tiene que poder correr dos veces sin romper.
  $PSQL -d zgtest -f "$REPO/supabase/031_pass.sql" >/dev/null
fi
