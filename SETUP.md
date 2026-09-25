# SETUP — OC Data Collector

Guía de alta (todo gratis, ~30 min). Hazlo **una vez**. Al final tendrás 3 valores que pegar en `js/config.js` y en el sync.

> Las claves que necesitarás al final:
> - `SUPABASE_URL` = `https://<project-ref>.supabase.co`
> - `SUPABASE_ANON_KEY` (pública, segura de exponer) → web + sync
> - `SUPABASE_SERVICE_ROLE_KEY` (secreta máxima) → **solo** el sync local, nunca en la web/repo

---

## 1. Crear proyecto Supabase

1. Entra en https://supabase.com → **New project**.
2. Elige nombre (ej. `ero-data-collector`), contraseña de BBDD y región cercana.
3. Cuando termine, mira la URL del proyecto: `https://<project-ref>.supabase.co`. Anota el **`<project-ref>`**.

## 2. Ejecutar el esquema SQL

1. En el proyecto: **SQL Editor** → **New query**.
2. Pega **todo** el contenido de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. Debe terminar sin errores. Crea: tabla `players`, RLS + policies, trigger, bucket `banners`, función `keep_alive`.

## 3. Crear la app de Discord

1. https://discord.com/developers/applications → **New Application** → nombre (ej. `ERO Data Collector`) → **Create**.
2. Menú izquierdo → **OAuth2**.
3. Sección **Redirects** → **Add Redirect** → pega **EXACTAMENTE** (sin barra final, sin espacios):
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
   > ⚠️ Aquí va **solo** la callback de Supabase. **NO** pongas la URL de tu web. Discord exige coincidencia carácter a carácter (`https`, host, path).
4. **Save Changes**.
5. Arriba, en **OAuth2** → copia **Client ID** y **Client Secret** (botón *Reset Secret* si no lo ves).
   - Scopes que usará la web: `identify` + `email` (no requieren aprobación; no añadas más).

## 4. Conectar Discord en Supabase

1. Supabase → **Authentication** → **Providers** → **Discord**.
2. **Enable** ON.
3. Pega **Client ID** y **Client Secret** de Discord → **Save**.

## 5. Configurar URLs de retorno

1. Supabase → **Authentication** → **URL Configuration**.
2. **Site URL** = la URL pública de tu web (la tendrás tras desplegar; ver `README.md`):
   - GitHub Pages: `https://<tu-usuario>.github.io/ero-data-collector/`
   - Cloudflare Pages: `https://ero-data-collector.pages.dev/`
3. **Redirect URLs** → añade:
   - tu URL pública (igual que Site URL)
   - `http://localhost:5500/` y `http://127.0.0.1:5500/` (para probar en local con Live Server)

## 6. (Opcional) Limitar quién se registra

- **Authentication → Sign In / Providers → "Allow new users to sign up"** OFF = solo invitados.
- O usa el hook **Before User Created** para una allowlist (p. ej. solo miembros de tu server).

## 7. Copiar las keys

Supabase → **Project Settings** → **API**:
- **Project URL** → `SUPABASE_URL`.
- **anon / public** key → `SUPABASE_ANON_KEY` (va en `js/config.js`, es segura de exponer).
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`.
  - ⚠️ **SECRETA**. Solo en herramientas de servidor o locales fuera de este repo (y en los secrets de las Edge Functions, que la inyecta Supabase). Nunca en la web, en el repo ni en capturas.

---

## 8. Rellenar la web

Edita [`js/config.js`](js/config.js):

```js
export const SUPABASE_URL = "https://<project-ref>.supabase.co";
export const SUPABASE_ANON_KEY = "<anon key>";
```

Despliega siguiendo [`README.md`](README.md). Luego vuelve al paso 5 y pon la URL real como Site URL.

---

## 9. (Opcional) Procesar las fichas fuera de la web

Las fichas y los banners quedan en Supabase (tabla `players` y bucket `banners`). Si quieres llevarlos a otra herramienta (un sync local, un bot…), hazlo desde un proceso propio con la `service_role` key, fuera de este repositorio, y valida los PNG antes de usarlos (magic bytes, re-encode y antivirus).

## 9b. Secrets de las Edge Functions

Supabase → **Edge Functions → Secrets**:
- `DISCORD_BOT_TOKEN` — token del bot de Discord (avisos y DMs).
- `OWNER_DISCORD_ID` — ID de Discord de quien recibe los avisos de reportes y las respuestas al bot.
- `EXTRA_RECIPIENTS` — (opcional) IDs de Discord extra, separados por comas, cuyas respuestas al bot se reenvían.
- `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SITE_URL` — envío de emails a artistas.

Para el despliegue en Cloudflare Pages: secret `CLOUDFLARE_API_TOKEN` y variable `CLOUDFLARE_ACCOUNT_ID` en el repo (Settings → Secrets and variables → Actions).

---

## 10. (Opcional) Login con X y vinculación de cuentas

Permite entrar con X (Twitter) además de Discord y vincular ambas cuentas a un mismo usuario. La web lleva la función **apagada** por defecto (`X_LOGIN_ENABLED = false` en `js/config.js`): hasta que no completes estos pasos no aparece ningún botón de X.

> ⚠️ **Orden obligatorio:** primero las migraciones de BBDD (10.4), después el proveedor, y **solo al final** la flag. Con la flag apagada la web no envía las columnas `x_*`, así que un deploy sin migrar no rompe el guardado; con la flag encendida sin migrar, **guardar falla**. Recomendado: ejecutar las migraciones antes del merge de esta función.

> ⚠️ Antes de empezar, comprueba en el portal de X (https://developer.x.com → tu proyecto → *Products*) qué nivel de acceso tiene tu app y **si el acceso a la API tiene coste**. El proveedor X de Supabase pide los scopes `users.email tweet.read users.read offline.access` (X exige `tweet.read` y `offline.access` aunque solo se lea el perfil); el tier gratuito ha cambiado varias veces, confírmalo antes de activar nada en producción.

### 10.1 Crear la app en X Developer Console

1. https://developer.x.com/en/portal/dashboard → **Projects & Apps** → crea un proyecto (o usa uno existente) → **Add App** → nombre (ej. `ERO Data Collector`).
2. Dentro de la app → **User authentication settings** → **Set up**.
3. Rellena:
   - **App permissions**: `Read` (basta con lectura) y marca **Request email from users** (Supabase pide el scope `users.email`; sin esto X no devuelve el email y el login puede fallar).
   - **Type of App**: **Web App, Automated App or Bot**.
   - **Callback URI / Redirect URL** → pega **EXACTAMENTE**:
     ```
     https://<project-ref>.supabase.co/auth/v1/callback
     ```
   - **Website URL**: la URL pública de tu web (GitHub Pages), p. ej. `https://<tu-usuario>.github.io/ero-data-collector/`.
   - **Terms of service** y **Privacy policy**: la misma URL de la web (el aviso legal y la política de privacidad están en el pie de página). X exige ambas para poder pedir el email.
4. **Save**. X muestra el **Client ID** y el **Client Secret** de OAuth 2.0 (pestaña **Keys and tokens** → *OAuth 2.0 Client ID and Client Secret*). Cópialos: el secret solo se muestra una vez (si lo pierdes, *Regenerate*).

### 10.2 Activar el proveedor en Supabase

1. Supabase → **Authentication** → **Providers** → **X / Twitter (OAuth 2.0)** (no el antiguo "Twitter (OAuth 1.0a)").
2. **Enable** ON → pega **Client ID** y **Client Secret** → **Save**.
3. La **Redirect URLs** de *URL Configuration* (paso 5) ya incluye tu web; no hace falta añadir nada más.

### 10.3 Activar la vinculación manual de identidades

1. Supabase → **Authentication** → **Providers** (o **Settings** → *Auth*, según versión del panel) → busca **"Allow manual linking"** / **Manual Linking** → ON → **Save**.
2. Sin esto, `linkIdentity` / `unlinkIdentity` devuelven `manual_linking_disabled` y los botones **Vincular X** / **Vincular Discord** fallan.

### 10.4 Ejecutar las migraciones de la BBDD (ANTES de la flag)

En **SQL Editor** → **New query**, en este orden:

1. [`supabase/migrations/20260915_01_x_identity.sql`](supabase/migrations/20260915_01_x_identity.sql) → **Run**. Añade a `players` las columnas `x_id`, `x_username`, `x_avatar` y un índice por handle. Idempotente, no toca RLS.
2. [`supabase/migrations/20260915_02_identity_trigger.sql`](supabase/migrations/20260915_02_identity_trigger.sql) → **Run**. Crea la función `players_fill_identity()` (`security definer`, `search_path` vacío, owner `postgres` = el rol del SQL Editor, con acceso a `auth.identities`) y un trigger `BEFORE INSERT OR UPDATE` en `players` que rellena `discord_*` y `x_*` **desde `auth.identities` del propio `user_id`**, ignorando lo que mande el navegador. Así nadie puede escribirse en su ficha la identidad de otro. El fichero vuelve a crear las columnas `x_*` si faltan, por lo que nunca falla por orden; al final rellena las filas existentes.

En instalaciones nuevas `schema.sql` ya incluye ambas cosas.

### 10.5 Encender la función en la web

Edita [`js/config.js`](js/config.js):

```js
export const X_LOGIN_ENABLED = true;
```

Despliega. En la pantalla de login aparece **Conectar con X** junto al botón de Discord (con un aviso: quien ya tenga ficha con Discord debe entrar con Discord y vincular X desde la cabecera), y en la cabecera (usuario logado) **Vincular X** / `@handle` + **Desvincular**, y **Vincular Discord** para quien entró solo con X.

Notas:
- Supabase no permite dejar a un usuario sin identidades: **Desvincular** solo se muestra si hay ≥2 cuentas vinculadas.
- Si la cuenta de X ya está vinculada a otro usuario, Supabase vuelve a la web con `error_code=identity_already_exists`; la web lo muestra como toast traducido.
- El sync local (`sync.py`) añade `x_username` / `x_id` al frontmatter de cada ficha y una fila `X` en la tabla si hay handle.

### 10.6 Usuarios huérfanos (entró con X teniendo ya ficha con Discord)

Si alguien entra con X **sin** haber vinculado antes, Supabase crea un **usuario nuevo** (sin ficha o con una ficha duplicada) y esa cuenta de X queda atada a él: cuando luego intente **Vincular X** desde su cuenta de Discord recibirá `identity_already_exists`. Para arreglarlo (admin):

1. Supabase → **Authentication** → **Users** → busca el usuario creado con X (proveedor `x`/`twitter`, sin identidad Discord). Comprueba que **no** es la cuenta buena (mira `created_at` y si tiene fila en `players`).
2. Si ese usuario huérfano tiene una ficha en `players` que quiera conservar, apunta sus datos antes (o pídele que los rehaga: es un formulario corto).
3. **Delete user**. Al borrarlo se borra su identidad de X (y su fila de `players` por `on delete cascade`), quedando la cuenta de X libre.
4. El usuario entra con **Discord** y pulsa **Vincular X** en la cabecera: ahora sí se vincula a su ficha buena.

---

## Checklist final

- [ ] Proyecto Supabase creado, `project-ref` anotado
- [ ] `schema.sql` ejecutado sin errores
- [ ] Discord app con redirect a la callback de Supabase
- [ ] Provider Discord activado en Supabase con Client ID/Secret
- [ ] Site URL + Redirect URLs configuradas
- [ ] `js/config.js` con URL + anon key
- [ ] `config.json` del sync con service_role (solo local)
- [ ] Web desplegada y login Discord funcionando
- [ ] (Opcional X) migraciones 01 y 02 ejecutadas → proveedor X + Manual Linking → `X_LOGIN_ENABLED = true`
