"""Genera assets/lang/names.json: nombres OFICIALES del juego en inglés y
español de España para la web (gear, armas, badges) + etiquetas de banners.

Fuente: clon local de Leanny/splat3 (textos del juego EUen/EUes + tablas
mush). Uso:
    python tools/build_names.py "<ruta a splat3-leanny>"

Salida (compacta):
{
  "v": "<versión mush>",
  "head" | "clothes" | "shoes": { "<código sin prefijo>": [en, es] },
  "weapon": { "<__RowId>": [en, es] },
  "badge":  { "Badge_<Name>": [en, es] }
}
Los banners no tienen nombre en el juego (NamePlateBgInfo no trae texto):
la web los etiqueta por su origen (ver nplLabel en js/data.js).
"""
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

root = Path(sys.argv[1])
lang_dir = root / "data" / "language"
mush_dir = root / "data" / "mush"
ver = max((p.name for p in mush_dir.iterdir() if p.name.isdigit()), key=int)
mush = mush_dir / ver

EN = json.loads((lang_dir / "EUen.json").read_text(encoding="utf-8"))
ES = json.loads((lang_dir / "EUes.json").read_text(encoding="utf-8"))


def pair(section: str, key: str):
    en = EN.get(section, {}).get(key)
    es = ES.get(section, {}).get(key)
    if not en and not es:
        return None
    return [en or es, es or en]


out = {"v": ver}

# Gear: clave = código sin el prefijo Hed_/Clt_/Shs_ (igual que la web)
for cat, sec in (("head", "GearName_Head"), ("clothes", "GearName_Clothes"), ("shoes", "GearName_Shoes")):
    m = {}
    for k in EN.get(f"CommonMsg/Gear/{sec}", {}):
        p = pair(f"CommonMsg/Gear/{sec}", k)
        if p:
            m[k] = p
    out[cat] = m

# Armas principales (clave = __RowId)
weapons = {}
for k in EN.get("CommonMsg/Weapon/WeaponName_Main", {}):
    p = pair("CommonMsg/Weapon/WeaponName_Main", k)
    if p:
        weapons[k] = p
out["weapon"] = weapons

# Badges: plantilla BadgeMsg[MsgLabelEx] con etiquetas de control del juego
#   type=0001 → arma (Sub1_Int = Id; en WinCount_WeaponSp es arma ESPECIAL)
#   type=000f → marca (Sub1_Int = índice → B00, B01…)
#   type=0007 → salmónido de Salmon Run (Sub1_Str, p. ej. SakeSaucer)
#   type=000e → escenario de Salmon Run (Sub1_Str, p. ej. Shakedent)
def ids(fname):
    rows = json.loads((mush / fname).read_text(encoding="utf-8"))
    return {w["Id"]: w["__RowId"] for w in rows}


main_ids, sp_ids = ids("WeaponInfoMain.json"), ids("WeaponInfoSpecial.json")
TAG = re.compile(r"\[group=0004 type=([0-9a-f]{4}) params=[^\]]*\]")


def fill(text: str, lang: dict, b: dict):
    sub1 = int(b.get("Sub1_Int") or 0)
    sub1s = b.get("Sub1_Str") or ""

    def rep(m):
        t = m.group(1)
        if t == "0001":
            if b.get("Category") == "WinCount_WeaponSp":
                row = sp_ids.get(sub1)
                return lang["CommonMsg/Weapon/WeaponName_Special"].get(row, row or "?")
            row = main_ids.get(sub1)
            return lang["CommonMsg/Weapon/WeaponName_Main"].get(row, row or "?")
        if t == "000f":
            key = f"B{sub1:02d}"
            return lang["CommonMsg/Gear/GearBrandName"].get(key, key)
        if t == "0007":
            return lang["CommonMsg/Coop/CoopEnemy"].get(sub1s, sub1s)
        if t == "000e":
            return lang["CommonMsg/Coop/CoopStageName"].get(sub1s, sub1s)
        return "?"
    txt = TAG.sub(rep, text)
    return re.sub(r"\[[^\]]*\]", "", txt).strip()  # otras etiquetas (color, ruby…)


badges = {}
missing = 0
for b in json.loads((mush / "BadgeInfo.json").read_text(encoding="utf-8")):
    label = b.get("MsgLabelEx") or b["Name"]  # sin plantilla: el texto va por su nombre
    en = EN["CommonMsg/Badge/BadgeMsg"].get(label)
    es = ES["CommonMsg/Badge/BadgeMsg"].get(label)
    if not en:
        missing += 1
        continue
    badges["Badge_" + b["Name"]] = [fill(en, EN, b), fill(es or en, ES, b)]
out["badge"] = badges

# Banners del generador (lista de SeymourSchlong/splashtags). El juego NO les
# da nombre: los oficiales (Npl_*) se etiquetan por su origen según
# NamePlateBgInfo; los de fans de escenarios/especiales llevan el nombre
# oficial del escenario o del arma especial. El resto: sin etiqueta.
import urllib.request

ST_ASSETS = "https://cdn.jsdelivr.net/gh/SeymourSchlong/splashtags@main/assets.min.json"
st = json.loads(urllib.request.urlopen(ST_ASSETS, timeout=30).read().decode("utf-8"))
files = [b["file"] for b in st["banners"] + st["customBanners"] if isinstance(b, dict) and "file" in b]
# + los oficiales que añade la web por su cuenta (js/extra-banners.js)
extra_js = (Path(__file__).resolve().parent.parent / "js" / "extra-banners.js").read_text(encoding="utf-8")
files += [e["f"] for e in json.loads(extra_js.split("export default ", 1)[1].rstrip().rstrip(";"))]


def norm(t: str) -> str:
    return re.sub(r"[^a-z0-9]", "", t.lower())


def origin(prefix_en, prefix_es, season, lv):
    en = f"{prefix_en}" + (f" S{season}" if season else "") + (f" · Level {lv}" if lv else "")
    es = f"{prefix_es}" + (f" T{season}" if season else "") + (f" · Nivel {lv}" if lv else "")
    return [en, es]


vs_en, vs_es = EN["CommonMsg/VS/VSStageName"], ES["CommonMsg/VS/VSStageName"]
co_en, co_es = EN["CommonMsg/Coop/CoopStageName"], ES["CommonMsg/Coop/CoopStageName"]
sp_en, sp_es = EN["CommonMsg/Weapon/WeaponName_Special"], ES["CommonMsg/Weapon/WeaponName_Special"]


def by_slug(slug, en_map, es_map, contains=False):
    # 1) prefijo (o subcadena para especiales); 2) subcadena ignorando la
    # "s" del posesivo inglés (Marooner's Bay → maroonerbay, Salmonid Smokeyard)
    for test in ((lambda n: slug in n) if contains else (lambda n: n.startswith(slug)),
                 lambda n: slug in n or slug in n.replace("s", "")):
        for k, v in en_map.items():
            n = norm(v)
            if test(n) or test(norm(v.replace("'s", ""))):
                return [v, es_map.get(k, v)]
    return None


banners = {}
for f in files:
    m = re.match(r"Npl_(Catalog|Coop)_Season(\d+)_Lv(\d+)$", f)
    if m:
        kind = {"Catalog": ("Catalog", "Catálogo"), "Coop": ("Salmon Run", "Salmon Run")}[m.group(1)]
        banners[f] = origin(*kind, int(m.group(2)), int(m.group(3)))
        continue
    m = re.match(r"Npl_Sdodr_(Shop|Locker)_Lv(\d+)$", f)
    if m:
        banners[f] = origin("Side Order", "Side Order", None, int(m.group(2)))
        continue
    if re.match(r"Npl_[FS]dodr\d+$", f):
        banners[f] = ["Side Order", "Side Order"]
        continue
    m = re.match(r"Npl_News_Ability_Lv(\d+)$", f)
    if m:
        banners[f] = origin("Splatoon Raiders", "Splatoon Raiders", None, int(m.group(1)))
        continue
    m = re.match(r"Npl_Tutorial(\d+)$", f)
    if m:
        banners[f] = ["Starter banner", "Placa inicial"]
        continue
    m = re.match(r"stages/(coop-)?([a-z]+)$", f)
    if m:
        p = by_slug(m.group(2), co_en if m.group(1) else vs_en, co_es if m.group(1) else vs_es)
        if p:
            banners[f] = p
        continue
    m = re.match(r"electrodev/([a-z]+)$", f)
    if m:
        p = by_slug(m.group(1), sp_en, sp_es, contains=True)
        if p:
            banners[f] = p
out["banner"] = banners

dest = Path(__file__).resolve().parent.parent / "assets" / "lang" / "names.json"
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"mush {ver}: head {len(out['head'])} · clothes {len(out['clothes'])} · shoes {len(out['shoes'])} · "
      f"weapon {len(weapons)} · badge {len(badges)} (sin texto: {missing}) · banner {len(banners)}/{len(files)} → {dest} ({dest.stat().st_size // 1024} KB)")
