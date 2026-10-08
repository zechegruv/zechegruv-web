#!/usr/bin/env python3
"""
Genera artistas/<slug>.html para cada artista del roster.

Fuente de datos: assets/data/artists.js (nombre/id/imagen — la misma
que usa la home) + assets/data/artist-bios.json (texto de biografía por
slug, opcional). Un artista sin entrada en artist-bios.json recibe el
placeholder "Biografía próximamente" en su página.

Se corre a mano cada vez que cambia el roster o se suman biografías:

    python3 scripts/generate_artist_pages.py

No depende de Node — este equipo no lo tiene instalado.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTISTS_JS = ROOT / "assets" / "data" / "artists.js"
BIOS_JSON = ROOT / "assets" / "data" / "artist-bios.json"
TEMPLATE = ROOT / "scripts" / "artist-page-template.html"
OUT_DIR = ROOT / "artistas"

# photo (opcional): foto propia para artistas sin perfil de Spotify.
ENTRY_RE = re.compile(
    r'\{\s*name:\s*"([^"]+)",\s*id:\s*"([^"]*)",\s*img:\s*"([^"]*)"(?:,\s*photo:\s*"([^"]*)")?\s*\}'
)


def slugify(name: str) -> str:
    normalized = unicodedata.normalize("NFD", name)
    stripped = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "-", stripped.lower()).strip("-")
    return slug


def load_artists():
    text = ARTISTS_JS.read_text(encoding="utf-8")
    artists = []
    for name, spotify_id, img, photo in ENTRY_RE.findall(text):
        artists.append({
            "name": name,
            "id": spotify_id,
            "img": img,
            "photo": photo,
            "slug": slugify(name),
        })
    return artists


def load_bios():
    if BIOS_JSON.exists():
        return json.loads(BIOS_JSON.read_text(encoding="utf-8"))
    return {}


def main():
    artists = load_artists()
    bios = load_bios()
    template = TEMPLATE.read_text(encoding="utf-8")
    OUT_DIR.mkdir(exist_ok=True)

    for a in artists:
        # {{BIO_JSON}} lleva el diccionario {idioma: texto} de este artista
        # (o {} si no hay biografía todavía) — assets/artist-stats.js lo lee
        # en el navegador y elige el idioma según el selector de la página.
        bio_json = json.dumps(bios.get(a["slug"], {}), ensure_ascii=False)
        html = (
            template
            .replace("{{NAME}}", a["name"])
            .replace("{{ID}}", a["id"])
            .replace("{{PHOTO_URL}}", f'../{a["photo"]}' if a["photo"] else f'https://i.scdn.co/image/{a["img"]}')
            .replace("{{SPOTIFY_BUTTON}}", (
                f'        <a class="btn" href="https://open.spotify.com/artist/{a["id"]}" target="_blank" rel="noopener" data-i18n="btn_spotify">Escuchar en Spotify ↗</a>\n'
                if a["id"] else ""))
            .replace("{{SLUG}}", a["slug"])
            .replace("{{BIO_JSON}}", bio_json)
        )
        out_path = OUT_DIR / f'{a["slug"]}.html'
        out_path.write_text(html, encoding="utf-8")
        print(f'{"✓" if a["slug"] in bios else "·"} {out_path.relative_to(ROOT)}')

    print(f"\n{len(artists)} páginas generadas. {len(bios)} con biografía real.")


if __name__ == "__main__":
    main()
