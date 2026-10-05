"""Genera la migración del catálogo de piezas (public.gear_catalog).

El panel de artistas ya no recibe la configuración cruda del personaje
(ids numéricos de PlayerConfig): la RPC artist_group resuelve en el servidor
cada id a lo que se pinta (nombre de imagen + nombre oficial EN/ES). Para eso
necesita esta tabla, que replica la parte mínima del RSDB de Flexlion.

Uso:
    python tools/build_gear_catalog.py [<carpeta con los JSON del RSDB>]

Sin argumento descarga los JSON de Flexlion (raw.githubusercontent.com). Con
carpeta, los lee de ahí (GearInfoHead.json, GearInfoClothes.json,
GearInfoShoes.json, HairInfo.json, EyebrowInfo.json, BottomInfo.json).
Los nombres salen de assets/lang/names.json (tools/build_names.py).

Salida: supabase/migrations/20260927_02_gear_catalog.sql (idempotente).
Regenerar tras cada actualización del juego (nuevas prendas) y aplicar.
"""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "supabase" / "migrations" / "20260927_02_gear_catalog.sql"
RSDB_URL = "https://raw.githubusercontent.com/Flexlion/flexlion.github.io/master/assets/RSDB"
FILES = {
    "head": "GearInfoHead.json",
    "clothes": "GearInfoClothes.json",
    "shoes": "GearInfoShoes.json",
    "hair": "HairInfo.json",
    "eyebrow": "EyebrowInfo.json",
    "bottom": "BottomInfo.json",
}

def load(kind: str) -> list:
    name = FILES[kind]
    if len(sys.argv) > 1:
        return json.loads((Path(sys.argv[1]) / name).read_text(encoding="utf-8"))
    with urllib.request.urlopen(f"{RSDB_URL}/{name}", timeout=60) as r:  # noqa: S310
        return json.loads(r.read().decode("utf-8"))

def q(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

names = json.loads((ROOT / "assets" / "lang" / "names.json").read_text(encoding="utf-8"))
rows = []
for kind in FILES:
    for e in load(kind):
        row_id = e["__RowId"]
        name_en = name_es = None
        if kind in ("head", "clothes", "shoes"):
            pair = names.get(kind, {}).get(row_id[4:])
            if pair:
                name_en, name_es = pair[0], pair[1]
        rows.append((
            kind, int(e["Id"]), row_id, name_en, name_es,
            int(e.get("VariationNum") or 0),
            e.get("IsSquid"),
            int(e.get("Order", 0) if e.get("Order") is not None else 0),
        ))

rows.sort(key=lambda r: (r[0], r[1]))
values = ",\n".join(
    f"  ({q(k)}, {i}, {q(rid)}, {q(en)}, {q(es)}, {var}, "
    f"{'NULL' if sq is None else ('true' if sq else 'false')}, {order})"
    for k, i, rid, en, es, var, sq, order in rows
)

sql = f"""-- ============================================================
-- Migración 20260927_02: catálogo de piezas (public.gear_catalog)
--
-- GENERADO por tools/build_gear_catalog.py — no editar a mano.
-- Mapea el id numérico de PlayerConfig de cada pieza (peinado, cejas,
-- piernas, gear de cabeza/ropa/zapatillas) a su nombre de imagen (__RowId
-- del RSDB de Flexlion) y a su nombre oficial EN/ES. Lo usa artist_group
-- (migración 20260927_03) para devolver al panel del artista solo lo que se
-- pinta, nunca los ids crudos del personaje.
--
-- Tabla de solo lectura para todo el mundo: RLS activado sin políticas; la
-- consultan únicamente funciones SECURITY DEFINER.
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run. Idempotente.
-- Regenerar y volver a aplicar tras cada actualización del juego.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.gear_catalog (
  kind          TEXT NOT NULL CHECK (kind IN ('head', 'clothes', 'shoes', 'hair', 'eyebrow', 'bottom')),
  id            INT  NOT NULL,
  row_id        TEXT NOT NULL,
  name_en       TEXT,
  name_es       TEXT,
  variation_num INT  NOT NULL DEFAULT 0,
  is_squid      BOOLEAN,
  ord           INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
);
ALTER TABLE public.gear_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gear_catalog FROM PUBLIC, anon, authenticated;

INSERT INTO public.gear_catalog (kind, id, row_id, name_en, name_es, variation_num, is_squid, ord) VALUES
{values}
ON CONFLICT (kind, id) DO UPDATE SET
  row_id = EXCLUDED.row_id, name_en = EXCLUDED.name_en, name_es = EXCLUDED.name_es,
  variation_num = EXCLUDED.variation_num, is_squid = EXCLUDED.is_squid, ord = EXCLUDED.ord;
"""
OUT.write_text(sql, encoding="utf-8")
print(f"{OUT.relative_to(ROOT)}: {len(rows)} filas")
