# OC Data Collector

A free, fan-made web tool for Splatoon 3 players and artists. You rebuild your in-game character, attach your Splattag banner, and artists who follow your link get everything they need to draw it: the 3D render, every gear piece by name, exact ink colour and banner.

Site: https://eroplayerdata.pages.dev
Discord: https://discord.gg/Hckay4PGNR
Ko-fi: https://ko-fi.com/zerosplatoon

## What it does

Players sign in with Discord or X and build their character piece by piece: species, skin and eye colour, hair, eyebrows, legs, gear with ALT variants, weapon and pose. Ink colour can be copied as HEX, RGB or HSL. There is a Splattag creator built in, or you can upload your own banner. Each character gets a 3D render you can spin, and the sheet can be edited whenever you like.

Artists apply at /?apply and get their own link. Characters shared through it show up in the artist panel with full references. Bugs and suggestions go through /?feedback.

Every account has one character. Extra slots are optional and paid for through Ko-fi, since storage for images and renders has a real cost. Slots are also given away in free prize draws.

Only your username, avatar and account ID are read from Discord or X, and nothing is posted on your behalf. Uploads are PNG only and are checked before use. Minimum age is 14. Offensive content or hate symbols lead to a ban.

## Built with

A static single-page app on Cloudflare Pages, with Supabase for authentication, database, storage and edge functions. Row-level security means each user only reads and edits their own data, and artists only see what has been shared with them. The site ships only the public anon key. The content security policy allows scripts from the site itself, and supabase-js is vendored.

Game data and icons are loaded from Flexlion's public files, and Splattag assets from the splashtags project.

```
index.html          single page
css/styles.css      theme
js/                 app logic, auth, character builder, banner creator, artist panel
functions/          Cloudflare Pages functions
supabase/           schema, migrations, edge functions
.github/workflows/  deploy and keep-alive
```

To host your own copy, create a Supabase project, enable Discord sign-in, run `supabase/schema.sql` and then the files in `supabase/migrations/` in order. Put your `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/config.js`, deploy the folder to any static host, and add your URL as Site URL and Redirect URL in Supabase. The `service_role` key never goes in this repository or in the site.

## About AI

Parts of the code are written with the help of an AI assistant, used for coding support and maintenance. It does not create any art, renders, banners or any asset, and none of them are AI-generated.

## Resumen en español

Web gratuita hecha por fans. Entras con Discord o X, recreas tu personaje de Splatoon 3 y adjuntas tu banner Splattag. Los artistas que reciban tu enlace ven la ficha completa con el render 3D, cada pieza con su nombre y el color exacto. Cada cuenta tiene un personaje; los slots extra son opcionales por Ko-fi, porque el almacenamiento tiene coste, y también se regalan en sorteos gratuitos. Los artistas se apuntan en /?apply y los reportes van en /?feedback. Parte del código se escribe con ayuda de un asistente de IA, como apoyo de programación y mantenimiento; no crea arte, renders, banners ni otros recursos, y ninguno está generado con IA.

## License & credits

Licensed under **GPL-3.0** (see [`LICENSE`](LICENSE)).

The Splattag creator (`js/splattag.js`) is a port of the renderer from the open-source project **[SeymourSchlong/splashtags](https://github.com/SeymourSchlong/splashtags)** ([splashtagmaker.com](https://splashtagmaker.com/)), also GPL-3.0. Its banners, badges, fonts and data are served via **jsDelivr** from that repository; this project does not host or redistribute them.

Credits to its authors and contributors: **seymour** (@spaghettitron, original site), **LeanYoshi** (database), **Raven_The_Cute** (translations), **DeadLineSMB**, **ElectroDev**, **Lucyfer**, **mya** (banners), **Zeeto**, **Sharkinodraws** (badges). Full list on the [original credits page](https://splashtagmaker.com/credits/).

Game data and icons come from the public files of **[Flexlion](https://github.com/Flexlion/flexlion.github.io)**.

«Splatoon», «Nintendo Switch», «Inkling», «Octoling» and related logos are registered trademarks of Nintendo. Game images, characters and other assets are the intellectual property of Nintendo Co., Ltd. and/or its affiliates. This is a fan project not affiliated with Nintendo. Donations are used exclusively to cover hosting and infrastructure costs.
