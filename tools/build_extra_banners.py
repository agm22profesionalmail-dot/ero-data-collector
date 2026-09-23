"""Genera js/extra-banners.js: banners OFICIALES de Splatoon 3 que faltan en el
catálogo de SeymourSchlong/splashtags (temporada 8-9, Splatoon Raiders…).

Fuente: NamePlateBgInfo del RSDB en Leanny/splat3 (color del texto incluido) e
imágenes de Leanny/splat3/images/npl (700x200, las mismas que el juego).
Uso:
    python tools/build_extra_banners.py [versión mush, p. ej. 1130]
"""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

LEANNY = "https://cdn.jsdelivr.net/gh/Leanny/splat3@main"
ST = "https://cdn.jsdelivr.net/gh/SeymourSchlong/splashtags@main/assets.min.json"
get = lambda u: json.loads(urllib.request.urlopen(u, timeout=30).read().decode("utf-8"))

ver = sys.argv[1] if len(sys.argv) > 1 else "1130"
rows = get(f"{LEANNY}/data/mush/{ver}/NamePlateBgInfo.json")
have = {b["file"] for b in get(ST)["banners"] if isinstance(b, dict) and "file" in b}

# Sección del generador según el prefijo (igual que agrupa el catálogo original)
SECTION = {"Catalog": "catalog", "Coop": "coop", "Lot": "jackpot", "Sdodr": "side"}


def srgb(c: float) -> int:  # TextColor viene en lineal
    c = max(0.0, min(1.0, c))
    v = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return round(v * 255)


out = []
for r in rows:
    f = r["__RowId"]
    if f in have:
        continue
    tc = r["TextColor"]
    out.append({"f": f, "c": "".join(f"{srgb(tc[k]):02x}" for k in "RGB"),
                "s": SECTION.get(f.split("_")[1], "misc")})

dest = Path(__file__).resolve().parent.parent / "js" / "extra-banners.js"
dest.write_text(
    "// AUTO-GENERADO por tools/build_extra_banners.py — no editar a mano.\n"
    "// Banners oficiales de Splatoon 3 ausentes en el catálogo de SeymourSchlong/splashtags.\n"
    f"// RSDB NamePlateBgInfo (mush {ver}); imágenes desde Leanny/splat3/images/npl.\n"
    "//   f = fichero (sin extensión)   c = color del texto (hex sRGB)   s = sección\n"
    "export default " + json.dumps(out, separators=(",", ":")) + ";\n", encoding="utf-8")
print(f"mush {ver}: {len(out)} banners extra → {dest}")
