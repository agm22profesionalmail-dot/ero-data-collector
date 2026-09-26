# OC Data Collector

**Share your Splatoon 3 character once, and every artist gets exactly what they need to draw it.**

🌐 **[eroplayerdata.pages.dev](https://eroplayerdata.pages.dev)** · 💬 [Discord](https://discord.gg/Hckay4PGNR) · ☕ [Ko-fi](https://ko-fi.com/zerosplatoon)

OC Data Collector is a free fan-made web tool. Players sign in with **Discord** or **X**, rebuild their in-game character piece by piece and attach their **Splattag banner**. The result is a character sheet with species, skin and eye colour, hairstyle, every gear piece by name, weapon, exact ink colour and a 3D reference, so commission artists don't have to ask.

> Español: más abajo, en [Resumen en español](#resumen-en-español).

---

## Features

### For players
- **Character builder**: Inkling / Octoling, girl / boy, skin tone, eye colour, hairstyle, eyebrows, legs, head / clothes / shoes (with ALT variants), weapon and pose. Species-aware: only compatible hairstyles and eyebrows are offered.
- **Exact ink colour**: pick your colour and anyone can copy it as **HEX**, **RGB** or **HSL**.
- **Built-in Splattag creator**: banners (including layer-recolourable ones), name, titles in 13 languages with their original fonts, tag, up to 3 badges, or your own banner / badge image. Exported as a real 700×200 PNG and attached to your sheet on save. You can also upload your in-game banner instead.
- **3D render (beta)**: a turntable of your character that artists can spin 360°, with top and bottom views for the tricky details.
- **Edit anytime**: sign back in and update your sheet. You can link **Discord and X** to the same sheet from the header.
- **English / Español** interface.

### For artists (Artist Beta)
- **Apply** at [`/?apply`](https://eroplayerdata.pages.dev/?apply) with your portfolio. Approved artists get their own link.
- Players who sign up through an artist's link share their OC with that artist: full 3D reference, every gear piece named, exact colours and banner.
- **Artist panel** with all the characters shared with you, including artist-exclusive versions of a character.

### Community & safety
- **Bug reports and suggestions** straight from the site at [`/?feedback`](https://eroplayerdata.pages.dev/?feedback).
- **Content rules**: offensive content or hate symbols in names or uploaded images lead to an account ban.
- Only **PNG** uploads (no SVG). Files are validated in the browser and scanned before they are used.
- We only read your username, avatar and account ID. Nothing is ever posted on your behalf. Users must be 14+.

---

## How it works

```
Browser (static SPA) ──sign in with Discord / X──►  Supabase Auth
        │   saves sheet + banner                    Supabase Postgres (row-level security)
        ▼                                            Supabase Storage (PNG only)
 Cloudflare Pages (static hosting)                   Supabase Edge Functions (feedback, emails)
```

- There is no custom backend. OAuth secrets live in Supabase; the site only ships the public *anon* key.
- Row-level security: every user can only read and edit their own sheet and their own files. Artists only see the characters explicitly shared with them.
- Game data (gear lists, icons) is loaded from [Flexlion](https://github.com/Flexlion/flexlion.github.io)'s public files; Splattag assets from [splashtags](https://github.com/SeymourSchlong/splashtags) via jsDelivr. This repository does not host them.

## Project structure

```
index.html            Single-page app
css/styles.css        Splatoon 3 inspired dark theme
js/
  app.js              App orchestration
  auth.js             Discord / X sign-in and account linking
  configurator.js     Character builder
  data.js             Game data loading and species filters
  banner.js           Splattag tabs (create / upload) and PNG validation
  splattag.js         Splattag renderer (port of splashtags)
  render_spin.js      3D render turntable viewer
  artists.js          Artist links and sharing
  artist_panel.js     Artist panel
  artist_terms.js     Artist Beta terms
  feedback.js         Bug reports and suggestions
  store.js            Save / load sheets and files
  i18n.js             English / Spanish strings
supabase/
  schema.sql          Base schema, RLS and storage buckets
  migrations/         Incremental migrations (run in order)
  functions/          Edge Functions
.github/workflows/    Cloudflare Pages deploy and keep-alive
SETUP.md              Self-hosting guide
```

## Self-hosting

The site is fully static. To run your own copy:

1. Follow **[SETUP.md](SETUP.md)**: create a Supabase project, enable Discord (and optionally X) sign-in, run `supabase/schema.sql` and the files in `supabase/migrations/` in order.
2. Fill in `js/config.js` with your `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
3. Deploy the folder to any static host. This repo deploys to **Cloudflare Pages** on every push to `main` (`.github/workflows/deploy-cloudflare.yml`, needs a `CLOUDFLARE_API_TOKEN` secret).
4. Add your public URL as **Site URL** and **Redirect URL** in Supabase → Authentication → URL Configuration.

Supabase's free tier pauses inactive projects after 7 days; `.github/workflows/keepalive.yml` pings it weekly (secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`).

> Never put the Supabase `service_role` key in this repository or in the site.

---

## Resumen en español

**OC Data Collector** es una web gratuita hecha por fans. Entras con **Discord** o **X**, recreas tu personaje de Splatoon 3 pieza a pieza y adjuntas tu **banner Splattag**. El resultado es una ficha con especie, colores, peinado, el nombre de cada prenda, arma, el color de tinta exacto (HEX/RGB/HSL) y una referencia 3D que se puede girar 360°.

- Creador de Splattag integrado, o sube tu banner del juego.
- Puedes editar tu ficha cuando quieras y vincular Discord y X a la misma ficha desde la cabecera.
- **Artist Beta:** los artistas se apuntan en [`/?apply`](https://eroplayerdata.pages.dev/?apply) y reciben su propio enlace; los jugadores que entran por él les comparten su OC.
- Reportes y sugerencias en [`/?feedback`](https://eroplayerdata.pages.dev/?feedback).
- Solo se lee tu nombre de usuario, avatar e ID. Nunca se publica nada en tu nombre. Edad mínima: 14 años.

---

## License & credits

Licensed under **GPL-3.0** (see [`LICENSE`](LICENSE)).

The Splattag creator (`js/splattag.js`) is a port of the renderer from the open-source project **[SeymourSchlong/splashtags](https://github.com/SeymourSchlong/splashtags)** ([splashtagmaker.com](https://splashtagmaker.com/)), also GPL-3.0. Its banners, badges, fonts and data are served via **jsDelivr** from that repository; this project does not host or redistribute them.

Credits to its authors and contributors: **seymour** (@spaghettitron, original site), **LeanYoshi** (database), **Raven_The_Cute** (translations), **DeadLineSMB**, **ElectroDev**, **Lucyfer**, **mya** (banners), **Zeeto**, **Sharkinodraws** (badges). Full list on the [original credits page](https://splashtagmaker.com/credits/).

Game data and icons come from the public files of **[Flexlion](https://github.com/Flexlion/flexlion.github.io)**.

«Splatoon», «Nintendo Switch», «Inkling», «Octoling» and related logos are registered trademarks of Nintendo. Game images, characters and other assets are the intellectual property of Nintendo Co., Ltd. and/or its affiliates. This is a fan project not affiliated with Nintendo. Donations are used exclusively to cover hosting and infrastructure costs.
