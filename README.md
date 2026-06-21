# ERO Data Collector

Web pública gratuita donde los jugadores conectan su **Discord** y envían su personaje de **Splatoon 3** (estilo Calico) + su **banner Splattag**. Los datos se sincronizan al vault Obsidian de ERO, con escaneo antivirus de los archivos subidos.

- **Configurador** especie-aware (Inkling/Octoling no mezclan peinados ni cejas), bilingüe **EN/ES**.
- **Login Discord** (OAuth vía Supabase, sin servidor propio).
- **Banner PNG** validado (magic bytes + dimensiones en cliente; antivirus en el sync local).
- **Editable**: el jugador vuelve a entrar con Discord y modifica su ficha.

## Arquitectura

```
Navegador (esta SPA)  ──login Discord──►  Supabase Auth
        │  guarda ficha + banner          Supabase Postgres (tabla players, RLS)
        ▼                                  Supabase Storage (bucket banners, PNG)
   GitHub Pages (estático)                          ▲
                                                     │ sync (service_role, local)
                              PC Windows ◄───────────┘
                              08_Scripts/ero_data_collector/sync.py
                              → pipeline seguridad → 26_Splatoon/Database/Players_Data/ del vault
```

Sin backend propio: el `client_secret` de Discord vive en Supabase. La SPA solo usa la **anon key** (pública).

## Puesta en marcha

1. Sigue **[SETUP.md](SETUP.md)** (alta de Supabase + Discord, ejecutar `supabase/schema.sql`, copiar keys).
2. Rellena `js/config.js` con `SUPABASE_URL` y `SUPABASE_ANON_KEY` (opcional `SPLATTAG_URL`).
3. Despliega (abajo).
4. Pon la URL pública como **Site URL** + **Redirect URL** en Supabase (Authentication → URL Configuration).

## Deploy — GitHub Pages (gratis)

> Usa un repo **nuevo y público** (no el vault privado). Este directorio es ese repo.

```bash
cd ero-data-collector
git init && git add . && git commit -m "ERO Data Collector"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/ero-data-collector.git
git push -u origin main
```
Luego: repo → **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
URL resultante: `https://<tu-usuario>.github.io/ero-data-collector/`

Alternativa: **Cloudflare Pages** (conecta el repo; bandwidth ilimitado; URL `*.pages.dev`).

### Anti-pausa (Supabase Free se pausa a los 7 días)
El workflow `.github/workflows/keepalive.yml` hace ping semanal. Configura los secrets `SUPABASE_URL` y `SUPABASE_ANON_KEY` en el repo. El sync local también mantiene viva la BBDD.

## Estructura

```
index.html              SPA
css/styles.css          tema Splatoon 3 dark
js/
  config.js             keys + constantes (rellenar)
  supabase.js           cliente Supabase (CDN esm.sh)
  auth.js               login Discord
  data.js               carga RSDB Flexlion + filtro especie
  i18n.js               EN/ES
  configurator.js       UI del personaje
  banner.js             upload + validación PNG
  store.js              guardar/cargar ficha + Storage
  app.js               orquestador
supabase/schema.sql     tabla players + RLS + bucket + keep_alive
SETUP.md                guía de alta paso a paso
test.html               harness de desarrollo (gitignored, no se despliega)
```

## Seguridad

- La SPA nunca ve el `client_secret` de Discord (lo maneja Supabase).
- RLS: cada usuario solo lee/edita su propia fila y su propia carpeta de banners.
- El bucket acepta solo `image/png` (no es antivirus). La validación real (magic bytes → re-encode Pillow → Microsoft Defender) la hace el sync local **antes** de escribir en el vault.
- La `service_role` key **solo** vive en el `config.json` del PC del sync (gitignored). Nunca aquí.
- SVG está prohibido (XML con JS ejecutable); solo PNG.

Los assets de Splatoon (imágenes/JSON) se cargan desde las URLs públicas de Flexlion; este repo no los aloja.
