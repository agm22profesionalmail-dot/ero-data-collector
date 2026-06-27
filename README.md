# ERO Data Collector

Web pública gratuita donde los jugadores conectan su **Discord** y envían su personaje de **Splatoon 3** (estilo Calico) + su **banner Splattag**. Los datos se sincronizan al vault Obsidian de ERO, con escaneo antivirus de los archivos subidos.

- **Configurador** especie-aware (Inkling/Octoling no mezclan peinados ni cejas), bilingüe **EN/ES**.
- **Login Discord** (OAuth vía Supabase, sin servidor propio).
- **Generador de splattag integrado** (pestaña *Crear*): paridad completa con splashtagmaker.com — banner (incl. recoloreables por capas), nombre, títulos en 13 idiomas con sus fuentes (incl. japonés/coreano/chino), prefijo de tag, hasta 3 insignias y marca de agua de artistas, en un canvas 700×200 exportado como PNG real — sin salir de la web.
- **Banner PNG** validado (magic bytes + dimensiones en cliente; antivirus en el sync local), por generador o subida manual (pestaña *Subir*).
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
  banner.js             pestañas Crear/Subir + validación PNG
  splattag.js           generador de splattag (canvas) — render portado de splashtags
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

## Licencia y créditos

Este proyecto se distribuye bajo **GPL-3.0** (ver [`LICENSE`](LICENSE)). El generador de splattag (`js/splattag.js`) es un port del render del proyecto open-source **[SeymourSchlong/splashtags](https://github.com/SeymourSchlong/splashtags)** (= [splashtagmaker.com](https://splashtagmaker.com/)), también GPL-3.0. Sus banners, insignias, fuentes y datos se sirven vía **jsDelivr** desde ese repositorio; este proyecto no los aloja ni los redistribuye.

Crédito completo a sus autores y colaboradores: **seymour** (@spaghettitron, web original), **LeanYoshi** (base de datos), **Raven_The_Cute** (traducciones), **DeadLineSMB**, **ElectroDev**, **Lucyfer**, **mya** (banners), **Zeeto**, **Sharkinodraws** (insignias). Lista completa en la [página de créditos original](https://splashtagmaker.com/credits/).

«Splatoon», «Inkling», «Octoling» y los recursos del juego son marcas y propiedad de © Nintendo. Proyecto de fans, sin ánimo de lucro y sin afiliación con Nintendo.
