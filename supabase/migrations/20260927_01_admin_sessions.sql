-- ============================================================
-- Migración 20260927_01: endurecimiento del acceso de administración
-- (auditoría de seguridad 2026-09-27: A1, A2, M1 servidor, M2 lado SQL)
--
-- Antes:
--  - Todas las RPC admin_* recibían usuario + clave en cada llamada y eran
--    ejecutables por `anon`: un solo factor, sin límite de intentos, y el AND
--    de admin_check se cortaba antes del bcrypt si el usuario no coincidía
--    (permitía enumerar el usuario por tiempo de respuesta).
--  - La web guardaba usuario y clave en claro en localStorage.
--  - La clave "genérica" de los artistas estaba en claro en app_secrets.
--  - Las Edge Functions que dispara pg_net no comprobaban ningún secreto.
--
-- Ahora:
--  1) admin_identities: lista blanca de usuarios (auth.uid()) que pueden ser
--     admin. Sin sesión de la web (Discord/X) en esa lista no hay login.
--  2) admin_login(usuario, clave) → token de sesión aleatorio (12 h). En la
--     base de datos solo se guarda su SHA-256 (admin_sessions); revocable con
--     admin_logout. Bloqueo: 5 fallos en 15 min por uid; el contador por
--     usuario solo lo alimentan uids de la lista blanca (un tercero con
--     sesión no puede bloquear al admin). Serializado con advisory locks.
--     bcrypt SIEMPRE (contra un hash de relleno si falta el real) y
--     comparaciones en tiempo constante.
--  3) El resto de admin_* reciben p_token (primer parámetro) en vez de
--     usuario/clave. Se eliminan las firmas antiguas. EXECUTE solo para
--     authenticated (+ service_role, que entra sin token: panel local).
--  4) Clave genérica de artistas eliminada: admin_approve / admin_reset_*
--     generan una clave temporal aleatoria por artista (solo el bcrypt queda
--     en artists.access_key_hash; en la cola de avisos hasta enviarla). La
--     Edge Function, ante un rebote, pide otra con artist_issue_temp_key.
--     A los artistas aprobados que aún tenían la genérica
--     (must_change_password = true) se les rota la clave a una temporal
--     propia y se les reencola el aviso (bloque 8b): la genérica deja de
--     servir en el mismo instante en que se aplica esta migración.
--  5) Llamadas SQL → Edge Functions con la cabecera x-edc-secret, leída de
--     Supabase Vault (secreto `edc_internal_secret`). Sin secreto, el aviso
--     queda en la cola con error (nunca se llama sin cabecera).
--
-- PASOS MANUALES tras aplicar (ver DEPLOY_20260927.md):
--  a) Crear el secreto en Vault:
--       select vault.create_secret('<valor aleatorio>', 'edc_internal_secret');
--     y el mismo valor como secret EDC_INTERNAL_SECRET de las Edge Functions.
--  b) Dar de alta al administrador en admin_identities (bloque final).
--
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run (rol postgres).
-- Idempotente: se puede ejecutar varias veces sin error.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 0) Comparación en tiempo constante (sin cortocircuito por el primer byte)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ct_equal(a text, b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  ab   bytea := convert_to(coalesce(a, ''), 'UTF8');
  bb   bytea := convert_to(coalesce(b, ''), 'UTF8');
  la   int   := length(ab);
  lb   int   := length(bb);
  acc  int   := 0;
  i    int;
BEGIN
  -- Recorre siempre el mismo número de bytes (el mayor de los dos) y acumula
  -- las diferencias con OR: el tiempo no depende de dónde difieren.
  IF la = 0 THEN ab := '\x00'::bytea; END IF;
  IF lb = 0 THEN bb := '\x00'::bytea; END IF;
  FOR i IN 0 .. greatest(la, lb, 1) - 1 LOOP
    acc := acc | (get_byte(ab, i % length(ab)) # get_byte(bb, i % length(bb)));
  END LOOP;
  RETURN (acc = 0) AND (la = lb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ct_equal(text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 1) Lista blanca de administradores (auth.users.id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_identities (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  label      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_identities FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) Intentos fallidos de login (bloqueo temporal)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  id           bigserial PRIMARY KEY,
  subject      text NOT NULL,             -- 'user:<usuario>' | 'uid:<auth.uid()>'
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_login_attempts_subject_idx
  ON public.admin_login_attempts (subject, attempted_at);
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_login_attempts FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3) Sesiones de admin: token aleatorio, guardado solo hasheado (SHA-256)
--    La tabla ya existía (20260923_02) con user_id + expires_at para las
--    políticas de storage; se amplía. Una sesión activa por usuario.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  user_id    uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.admin_sessions
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_sessions FROM PUBLIC, anon, authenticated;
-- Las sesiones anteriores a esta migración no tienen token: fuera.
UPDATE public.admin_sessions SET revoked_at = now() WHERE token_hash IS NULL AND revoked_at IS NULL;

-- Hash de relleno para que el bcrypt se ejecute SIEMPRE, exista o no la
-- clave real (misma duración con usuario bueno o malo).
INSERT INTO public.app_secrets (k, v)
VALUES ('admin_pass_dummy', crypt(encode(gen_random_bytes(16), 'hex'), gen_salt('bf', 10)))
ON CONFLICT (k) DO NOTHING;

-- ------------------------------------------------------------
-- 4) admin_check: SOLO interna (la llama admin_login). No devuelve error:
--    registra el fallo y devuelve false, para que el intento quede grabado
--    aunque quien la llame lance después una excepción.
--    Motivos: 'ok' | 'locked' | 'no_session' | 'bad_credentials'.
--    Bloqueo: el contador 'uid:<uid>' cuenta siempre; el contador
--    'user:<usuario>' SOLO lo alimentan (y solo bloquea a) uids que estén en
--    admin_identities. Así un usuario cualquiera con sesión no puede dejar
--    fuera al admin a base de fallar con su nombre: solo se bloquea a sí
--    mismo. Los dos contadores se leen y escriben bajo advisory locks de
--    transacción (en orden estable por el valor del hash) para que dos
--    intentos concurrentes no cuenten de menos.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_check(text, text);
CREATE FUNCTION public.admin_check(p_user text, p_pass text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text := coalesce(auth.role(), '');
  v_subj_u  text := 'user:' || left(coalesce(p_user, ''), 200);
  v_subj_id text := 'uid:' || coalesce(v_uid::text, '-');
  v_fails_u int;
  v_fails_i int;
  v_user    text;
  v_hash    text;
  v_dummy   text;
  v_cmp     text;
  v_ok_user boolean;
  v_ok_pass boolean;
  v_ok_uid  boolean;
  v_lock_a  int := hashtext(v_subj_u);
  v_lock_b  int := hashtext(v_subj_id);
BEGIN
  -- Serializar por sujeto (usuario y uid), siempre en el mismo orden
  -- (menor hash primero) para que dos sesiones no se crucen en deadlock.
  PERFORM pg_advisory_xact_lock(least(v_lock_a, v_lock_b));
  PERFORM pg_advisory_xact_lock(greatest(v_lock_a, v_lock_b));

  DELETE FROM public.admin_login_attempts WHERE attempted_at < now() - interval '1 day';

  -- ¿Puede este uid ser admin? (service_role: panel local, sin uid)
  v_ok_uid  := (v_role = 'service_role')
               OR (v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_identities WHERE user_id = v_uid));

  SELECT count(*) INTO v_fails_i FROM public.admin_login_attempts
   WHERE subject = v_subj_id AND attempted_at > now() - interval '15 minutes';
  IF v_ok_uid THEN
    SELECT count(*) INTO v_fails_u FROM public.admin_login_attempts
     WHERE subject = v_subj_u AND attempted_at > now() - interval '15 minutes';
  ELSE
    v_fails_u := 0;
  END IF;
  IF v_fails_u >= 5 OR v_fails_i >= 5 THEN
    RETURN 'locked';
  END IF;

  SELECT v INTO v_user  FROM public.app_secrets WHERE k = 'admin_user';
  SELECT v INTO v_hash  FROM public.app_secrets WHERE k = 'admin_pass';
  SELECT v INTO v_dummy FROM public.app_secrets WHERE k = 'admin_pass_dummy';

  -- Las tres comprobaciones se calculan SIEMPRE (sin cortocircuito) y en
  -- tiempo constante; solo al final se combinan.
  v_cmp     := coalesce(v_hash, v_dummy);
  v_ok_user := public.ct_equal(coalesce(p_user, ''), coalesce(v_user, ''));
  v_ok_pass := public.ct_equal(crypt(coalesce(p_pass, ''), v_cmp), v_cmp);
  v_ok_user := v_ok_user AND (v_user IS NOT NULL);
  v_ok_pass := v_ok_pass AND (v_hash IS NOT NULL);

  IF v_ok_user AND v_ok_pass AND v_ok_uid THEN
    DELETE FROM public.admin_login_attempts WHERE subject IN (v_subj_u, v_subj_id);
    RETURN 'ok';
  END IF;

  -- uid fuera de la lista blanca: solo cuenta contra sí mismo, nunca
  -- contra el usuario (evita el bloqueo del admin por terceros).
  IF NOT v_ok_uid THEN
    INSERT INTO public.admin_login_attempts (subject) VALUES (v_subj_id);
    RETURN 'bad_credentials';
  END IF;

  INSERT INTO public.admin_login_attempts (subject) VALUES (v_subj_u), (v_subj_id);
  IF v_ok_user AND v_ok_pass AND v_uid IS NULL THEN
    RETURN 'no_session';
  END IF;
  RETURN 'bad_credentials';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_check(text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5) admin_login → token de sesión (12 h). Devuelve JSON, nunca lanza por
--    credenciales malas (así el intento fallido queda registrado).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_login(p_user text, p_pass text)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_res   text;
  v_token text;
  v_exp   timestamptz;
BEGIN
  v_res := public.admin_check(p_user, p_pass);
  IF v_res <> 'ok' THEN
    RETURN json_build_object('ok', false, 'reason', v_res);
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_session');
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp   := now() + interval '12 hours';
  INSERT INTO public.admin_sessions (user_id, expires_at, token_hash, created_at, revoked_at)
  VALUES (auth.uid(), v_exp, encode(digest(v_token, 'sha256'), 'hex'), now(), NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at, token_hash = EXCLUDED.token_hash,
        created_at = now(), revoked_at = NULL;
  DELETE FROM public.admin_sessions WHERE expires_at < now() - interval '1 day';

  RETURN json_build_object('ok', true, 'token', v_token, 'expires_at', v_exp);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_login(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_login(text, text) TO authenticated;

-- ¿Es válida esta sesión de admin? service_role (panel local) entra sin token.
CREATE OR REPLACE FUNCTION public.admin_session_ok(p_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN true;
  END IF;
  IF p_token IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  SELECT s.token_hash INTO v_hash
    FROM public.admin_sessions s
    JOIN public.admin_identities ai ON ai.user_id = s.user_id
   WHERE s.user_id = auth.uid()
     AND s.revoked_at IS NULL
     AND s.expires_at > now();
  IF v_hash IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.ct_equal(v_hash, encode(digest(p_token, 'sha256'), 'hex'));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_session_ok(text) FROM PUBLIC, anon, authenticated;

-- Lanza 'unauthorized' (28000) si el token no vale. La usan todas las admin_*.
CREATE OR REPLACE FUNCTION public.admin_require(p_token text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.admin_session_ok(p_token) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_require(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_logout(p_token text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_token IS NULL OR auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.admin_sessions
     SET revoked_at = now()
   WHERE user_id = auth.uid()
     AND revoked_at IS NULL
     AND public.ct_equal(token_hash, encode(digest(p_token, 'sha256'), 'hex'));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_logout(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_logout(text) TO authenticated;

-- Storage (renders/banners del admin): la sesión tiene que seguir viva y no
-- revocada, y el usuario en la lista blanca.
CREATE OR REPLACE FUNCTION public.admin_media_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.admin_sessions s
      JOIN public.admin_identities ai ON ai.user_id = s.user_id
     WHERE s.user_id = auth.uid()
       AND s.revoked_at IS NULL
       AND s.token_hash IS NOT NULL
       AND s.expires_at > now()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.admin_media_ok() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_media_ok() TO authenticated;

-- ------------------------------------------------------------
-- 6) Cabecera secreta para las Edge Functions (Supabase Vault)
--    NULL si el secreto no está creado: quien la usa no llama a la función y
--    deja el aviso en la cola con error (fail-closed en los dos lados).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edc_internal_headers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'edc_internal_secret'
     ORDER BY created_at DESC
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;
  IF v_secret IS NULL OR length(v_secret) < 16 THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('Content-Type', 'application/json', 'x-edc-secret', v_secret);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.edc_internal_headers() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7) Clave temporal por artista (sustituye a generic_artist_key)
--    La fila generic_artist_key de app_secrets se borra en el bloque 8b,
--    junto con la rotación de los artistas que aún la tenían (necesita
--    queue_artist_email ya redefinida con la cabecera secreta).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.artist_new_temp_key()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  -- 16 caracteres legibles (base64 sin / + =)
  SELECT replace(replace(replace(encode(gen_random_bytes(12), 'base64'), '/', 'x'), '+', 'y'), '=', '');
$$;
REVOKE EXECUTE ON FUNCTION public.artist_new_temp_key() FROM PUBLIC, anon, authenticated;

-- Para la Edge Function (service_role) cuando un aviso rebota y hay que
-- reenviar la clave por Discord: solo si el artista está aprobado y aún no
-- ha elegido su propia clave (must_change_password). Devuelve la nueva.
CREATE OR REPLACE FUNCTION public.artist_issue_temp_key(p_artist_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
  v_key := public.artist_new_temp_key();
  UPDATE public.artists
     SET access_key_hash = crypt(v_key, gen_salt('bf', 12)),
         must_change_password = true
   WHERE id = p_artist_id
     AND status = 'approved'
     AND coalesce(must_change_password, false);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_key;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.artist_issue_temp_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.artist_issue_temp_key(uuid) TO service_role;

-- ------------------------------------------------------------
-- 8) Cola de avisos → Edge Function, ahora con la cabecera secreta
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_artist_email(
  p_email TEXT, p_name TEXT, p_slug TEXT, p_key TEXT, p_lang TEXT, p_reset BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id      UUID;
  v_url     TEXT;
  v_headers JSONB;
BEGIN
  UPDATE public.artist_email_outbox SET key = NULL
   WHERE email = p_email AND sent_at IS NULL AND key IS NOT NULL;

  INSERT INTO public.artist_email_outbox (email, name, slug, key, lang, reset)
  VALUES (p_email, p_name, p_slug, p_key, CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, COALESCE(p_reset, false))
  RETURNING id INTO v_id;

  SELECT v INTO v_url FROM public.app_secrets WHERE k = 'send_email_url';
  IF v_url IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'send_email_url not configured' WHERE id = v_id;
    RETURN false;
  END IF;
  v_headers := public.edc_internal_headers();
  IF v_headers IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'edc_internal_secret not configured (Vault)' WHERE id = v_id;
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := v_headers,
    timeout_milliseconds := 20000
  );
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_artist_email(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.queue_artist_notice(
  p_email TEXT, p_name TEXT, p_lang TEXT, p_kind TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id      UUID;
  v_url     TEXT;
  v_headers JSONB;
BEGIN
  IF p_kind NOT IN ('rejected') THEN
    RAISE EXCEPTION 'bad notice kind';
  END IF;

  INSERT INTO public.artist_email_outbox (email, name, slug, key, lang, reset, kind)
  VALUES (p_email, p_name, NULL, NULL, CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, false, p_kind)
  RETURNING id INTO v_id;

  SELECT v INTO v_url FROM public.app_secrets WHERE k = 'send_email_url';
  IF v_url IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'send_email_url not configured' WHERE id = v_id;
    RETURN false;
  END IF;
  v_headers := public.edc_internal_headers();
  IF v_headers IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'edc_internal_secret not configured (Vault)' WHERE id = v_id;
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := v_headers,
    timeout_milliseconds := 20000
  );
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.queue_artist_notice(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- 8b) Retirar la clave genérica: borrar el secreto y, en el mismo bloque,
--     rotar la clave de TODOS los artistas aprobados que aún la tenían
--     (must_change_password = true) a una temporal aleatoria propia, con
--     su aviso reencolado (misma cola/Edge Function; variante "reset").
--     Idempotente: si el secreto ya no existe (segunda ejecución) no se
--     rota nada, para no reenviar avisos.
--     Si el aviso no puede encolarse (send_email_url o Vault sin
--     configurar) la fila queda en artist_email_outbox con error y la
--     clave ya rotada: se reenvía con admin_reset_generic desde el panel.
DO $do$
DECLARE
  r     record;
  v_key text;
  v_n   int := 0;
  v_q   int := 0;
BEGIN
  DELETE FROM public.app_secrets WHERE k = 'generic_artist_key';
  IF NOT FOUND THEN
    RAISE NOTICE 'generic_artist_key ya no existía: no se rota ninguna clave';
    RETURN;
  END IF;

  FOR r IN
    SELECT id, email, name, slug, coalesce(preferred_lang, 'en') AS lang
      FROM public.artists
     WHERE status = 'approved'
       AND coalesce(must_change_password, false)
     ORDER BY created_at
  LOOP
    v_key := public.artist_new_temp_key();
    UPDATE public.artists
       SET access_key_hash = crypt(v_key, gen_salt('bf', 12)),
           must_change_password = true
     WHERE id = r.id;
    v_n := v_n + 1;
    IF r.email IS NOT NULL THEN
      IF public.queue_artist_email(r.email, r.name, r.slug, v_key, r.lang, true) THEN
        v_q := v_q + 1;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'generic_artist_key retirada: % artistas con clave temporal nueva, % avisos encolados', v_n, v_q;
END
$do$;

-- Revisión de rebotes (pg_cron): misma cabecera. Solo se programa si el
-- secreto existe en el momento de la llamada (WHERE ... IS NOT NULL).
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'artist-email-bounces';
SELECT cron.schedule(
  'artist-email-bounces',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url     := (SELECT v FROM public.app_secrets WHERE k = 'send_email_url'),
    body    := '{"action":"check_bounces"}'::jsonb,
    headers := public.edc_internal_headers(),
    timeout_milliseconds := 60000
  )
  WHERE public.edc_internal_headers() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.artist_email_outbox
       WHERE sent_at > now() - interval '3 days'
         AND bounced_at IS NULL
         AND (channel IS NULL OR channel IN ('email', 'email_alt'))
    );
  $cron$
);

-- ------------------------------------------------------------
-- 9) RPC de administración: firmas nuevas (p_token) y fuera las antiguas
-- ------------------------------------------------------------
-- Todas las admin_* del schema public cuya lista de argumentos empiece por
-- (p_user text, p_pass text ...) son firmas antiguas: se borran una a una,
-- sin CASCADE. admin_check y admin_login (nuevas, con esa misma cabecera)
-- se excluyen. Si alguna tuviera dependencias (vista, política, trigger),
-- el DROP falla con un mensaje claro: revisar pg_depend (ver DEPLOY) antes
-- de volver a ejecutar.
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname LIKE 'admin\_%' ESCAPE '\'
       AND p.proname NOT IN ('admin_check', 'admin_login')
       AND pg_get_function_identity_arguments(p.oid) LIKE 'p_user text, p_pass text%'
     ORDER BY p.proname
  LOOP
    BEGIN
      EXECUTE format('DROP FUNCTION %s', r.sig);
      RAISE NOTICE 'firma antigua eliminada: %', r.sig;
    EXCEPTION WHEN dependent_objects_still_exist THEN
      RAISE EXCEPTION 'No se puede borrar % (firma antigua usuario/clave): tiene dependencias. Revisar pg_depend (DEPLOY_20260927.md, paso 1 de backup) y decidir a mano.', r.sig
        USING DETAIL = SQLERRM;
    END;
  END LOOP;
END
$do$;

-- 9a) Solicitudes de artistas (pending primero) + nº de jugadores asociados
CREATE OR REPLACE FUNCTION public.admin_list(p_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  RETURN coalesce((
    SELECT json_agg(a ORDER BY
             CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
             a.created_at DESC)
    FROM (
      SELECT ar.id, ar.discord_id, ar.name, ar.email, ar.portfolio, ar.reason, ar.slug,
             ar.status, ar.created_at, ar.approved_at, ar.notes, ar.preferred_lang,
             (SELECT count(*) FROM public.player_artists pa WHERE pa.artist_id = ar.id) AS players
      FROM public.artists ar
    ) a
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_pending_count(p_token text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  RETURN (SELECT count(*)::int FROM public.artists WHERE status = 'pending');
END;
$$;

-- 9b) Aprobar: slug + clave temporal aleatoria (bcrypt) + aviso por la cola.
--     La clave no se devuelve al cliente: viaja en la cola hasta enviarse.
CREATE OR REPLACE FUNCTION public.admin_approve(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_slug  text; v_base text; v_key text; v_sent boolean;
  v_email text; v_name text; v_lang text;
BEGIN
  PERFORM public.admin_require(p_token);

  SELECT email, name, coalesce(preferred_lang, 'en')
    INTO v_email, v_name, v_lang
    FROM public.artists WHERE id = p_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'artist has no email' USING ERRCODE = '22004';
  END IF;

  SELECT slug INTO v_slug FROM public.artists WHERE id = p_id;
  IF v_slug IS NULL THEN
    SELECT nullif(trim(both '-' FROM regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), '')
      INTO v_base;
    v_base := coalesce(v_base, 'artist');
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.artists WHERE slug = v_slug AND id <> p_id) LOOP
      v_slug := v_base || '-' || substr(encode(gen_random_bytes(2), 'hex'), 1, 3);
    END LOOP;
  END IF;

  v_key := public.artist_new_temp_key();
  UPDATE public.artists
     SET status = 'approved',
         slug = v_slug,
         access_key_hash = crypt(v_key, gen_salt('bf', 12)),
         must_change_password = true,
         approved_at = now()
   WHERE id = p_id;

  v_sent := public.queue_artist_email(v_email, v_name, v_slug, v_key, v_lang, false);
  RETURN json_build_object('slug', v_slug, 'sent', v_sent);
END;
$$;

-- 9c) Restablecer: nueva clave temporal + aviso (nombre histórico, ya no hay
--     clave genérica).
CREATE OR REPLACE FUNCTION public.admin_reset_generic(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text; v_sent boolean;
  v_email text; v_name text; v_slug text; v_lang text;
BEGIN
  PERFORM public.admin_require(p_token);

  SELECT email, name, slug, coalesce(preferred_lang, 'en')
    INTO v_email, v_name, v_slug, v_lang
    FROM public.artists
   WHERE id = p_id AND status = 'approved';
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'artist not approved or missing email' USING ERRCODE = '22004';
  END IF;

  v_key := public.artist_new_temp_key();
  UPDATE public.artists
     SET access_key_hash = crypt(v_key, gen_salt('bf', 12)),
         must_change_password = true
   WHERE id = p_id;

  v_sent := public.queue_artist_email(v_email, v_name, v_slug, v_key, v_lang, true);
  RETURN json_build_object('sent', v_sent);
END;
$$;

-- 9d) Nueva clave mostrada UNA vez al admin (panel web, entrega a mano).
CREATE OR REPLACE FUNCTION public.admin_reset_key(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text;
BEGIN
  PERFORM public.admin_require(p_token);
  v_key := public.artist_new_temp_key();
  UPDATE public.artists
     SET access_key_hash = crypt(v_key, gen_salt('bf', 12)),
         must_change_password = true
   WHERE id = p_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artist not approved' USING ERRCODE = '22004';
  END IF;
  RETURN json_build_object('key', v_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_status(p_token text, p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  IF p_status NOT IN ('pending', 'approved', 'rejected', 'revoked') THEN
    RAISE EXCEPTION 'bad status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.artists SET status = p_status WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_status text; v_email text; v_name text; v_lang text;
  v_sent boolean := false;
BEGIN
  PERFORM public.admin_require(p_token);

  SELECT status, email, name, coalesce(preferred_lang, 'en')
    INTO v_status, v_email, v_name, v_lang
    FROM public.artists WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'artist not found' USING ERRCODE = '22004';
  END IF;

  UPDATE public.artists SET status = 'rejected' WHERE id = p_id;

  IF v_status = 'pending' AND v_email IS NOT NULL THEN
    v_sent := public.queue_artist_notice(v_email, v_name, v_lang, 'rejected');
  END IF;
  RETURN json_build_object('sent', v_sent, 'emailed', v_status = 'pending' AND v_email IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_email_status(p_token text, p_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email text;
  r record;
BEGIN
  PERFORM public.admin_require(p_token);
  SELECT email INTO v_email FROM public.artists WHERE id = p_id;
  SELECT created_at, sent_at, error, channel, delivered_to, bounced_at, note INTO r
    FROM public.artist_email_outbox
   WHERE email = v_email
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('state', 'none');
  END IF;
  RETURN json_build_object(
    'state', CASE WHEN r.bounced_at IS NOT NULL AND r.channel IS DISTINCT FROM 'discord' THEN 'error'
                  WHEN r.sent_at IS NOT NULL THEN 'sent'
                  WHEN r.error IS NOT NULL THEN 'error'
                  ELSE 'pending' END,
    'error', r.error, 'created_at', r.created_at, 'sent_at', r.sent_at,
    'channel', r.channel, 'delivered_to', r.delivered_to,
    'bounced_at', r.bounced_at, 'note', r.note);
END;
$$;

-- 9e) Todas las fichas (panel web del admin). La sesión de storage la da
--     admin_login; aquí ya no se escribe nada.
CREATE OR REPLACE FUNCTION public.admin_players(p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_players jsonb;
BEGIN
  PERFORM public.admin_require(p_token);

  SELECT jsonb_agg(
    (to_jsonb(p) - 'banner_sha256' - 'splattag_config')
    || jsonb_build_object('artists', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'artist_id',  a.id,
               'name',       a.name,
               'slug',       a.slug,
               'consent_at', pa.consent_at,
               'variant',    (SELECT to_jsonb(pac) - 'player_id' - 'artist_id'
                                FROM public.player_artist_chars pac
                               WHERE pac.player_id = p.id AND pac.artist_id = a.id))
             ORDER BY pa.created_at)
        FROM public.player_artists pa
        JOIN public.artists a ON a.id = pa.artist_id
       WHERE pa.player_id = p.id), '[]'::jsonb))
    ORDER BY p.created_at DESC
  ) INTO v_players
  FROM public.players p;

  RETURN jsonb_build_object(
    'media',   auth.uid() IS NOT NULL,
    'players', coalesce(v_players, '[]'::jsonb)
  );
END;
$$;

-- 9f) Panel local: resumen, reportes, cola de avisos
CREATE OR REPLACE FUNCTION public.admin_edc_overview(p_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- Cuentas de prueba del equipo (no cuentan como artistas aprobados).
  -- Sustituir por sus IDs de Discord al ejecutar; en el repo no se publican.
  v_test_ids CONSTANT text[] := ARRAY['<TEST_DISCORD_ID_1>', '<TEST_DISCORD_ID_2>'];
BEGIN
  PERFORM public.admin_require(p_token);
  RETURN json_build_object(
    'players',          (SELECT count(*) FROM public.players),
    'artists_approved', (SELECT count(*) FROM public.artists
                          WHERE status = 'approved'
                            AND (discord_id IS NULL OR NOT (discord_id = ANY (v_test_ids)))),
    'artists_pending',  (SELECT count(*) FROM public.artists WHERE status = 'pending'),
    'artist_slots',     15,
    'feedback_new',     (SELECT count(*) FROM public.feedback WHERE status = 'new'),
    'feedback_open',    (SELECT count(*) FROM public.feedback WHERE status IN ('new', 'read')),
    'emails_failed_7d', (SELECT count(*) FROM public.artist_email_outbox
                          WHERE created_at > now() - interval '7 days'
                            AND (error IS NOT NULL
                                 OR (bounced_at IS NOT NULL AND channel IS DISTINCT FROM 'discord'))),
    'last_player_at',   (SELECT max(created_at) FROM public.players)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_feedback_list(p_token text DEFAULT NULL, p_status text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  IF p_status IS NOT NULL AND p_status NOT IN ('new', 'read', 'done', 'discarded') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
             'id', f.id, 'created_at', f.created_at, 'kind', f.kind, 'message', f.message,
             'contact_method', f.contact_method, 'contact_email', f.contact_email,
             'contact_discord_id', f.contact_discord_id, 'contact_discord_name', f.contact_discord_name,
             'page', f.page, 'lang', f.lang, 'status', f.status, 'notified', f.notified)
           ORDER BY f.created_at DESC)
      FROM (
        SELECT * FROM public.feedback
         WHERE (p_status IS NULL AND status IN ('new', 'read')) OR status = p_status
         ORDER BY created_at DESC
         LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
      ) f
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_feedback_set_status(p_token text, p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  IF p_status IS NULL OR p_status NOT IN ('new', 'read', 'done', 'discarded') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE public.feedback SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_email_log(p_token text DEFAULT NULL, p_limit int DEFAULT 20)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  RETURN coalesce((
    SELECT json_agg(json_build_object(
             'id', o.id, 'email', o.email, 'name', o.name, 'kind', o.kind,
             'created_at', o.created_at, 'sent_at', o.sent_at, 'error', o.error,
             'channel', o.channel, 'delivered_to', o.delivered_to,
             'bounced_at', o.bounced_at, 'note', o.note)
           ORDER BY o.created_at DESC)
      FROM (
        SELECT id, email, name, kind, created_at, sent_at, error, channel, delivered_to, bounced_at, note
          FROM public.artist_email_outbox
         ORDER BY created_at DESC
         LIMIT greatest(1, least(coalesce(p_limit, 20), 200))
      ) o
  ), '[]'::json);
END;
$$;

-- 9g) Aviso libre por email (cuenta del proyecto)
CREATE OR REPLACE FUNCTION public.admin_send_email(
  p_token   text,
  p_email   text,
  p_name    text,
  p_subject text,
  p_body    text,
  p_lang    text DEFAULT 'en'
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id      uuid;
  v_url     text;
  v_headers jsonb;
BEGIN
  PERFORM public.admin_require(p_token);
  IF p_email IS NULL
     OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     OR length(p_email) NOT BETWEEN 5 AND 320
     OR coalesce(trim(p_subject), '') = '' OR length(p_subject) > 200
     OR coalesce(trim(p_body), '') = ''    OR length(p_body) > 10000 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.artist_email_outbox (email, name, slug, key, lang, reset, kind, subject, body)
  VALUES (trim(p_email), nullif(trim(coalesce(p_name, '')), ''), NULL, NULL,
          CASE WHEN p_lang = 'es' THEN 'es' ELSE 'en' END, false, 'custom',
          trim(p_subject), p_body)
  RETURNING id INTO v_id;

  SELECT v INTO v_url FROM public.app_secrets WHERE k = 'send_email_url';
  IF v_url IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'send_email_url not configured' WHERE id = v_id;
    RETURN json_build_object('id', v_id, 'queued', false);
  END IF;
  v_headers := public.edc_internal_headers();
  IF v_headers IS NULL THEN
    UPDATE public.artist_email_outbox SET error = 'edc_internal_secret not configured (Vault)' WHERE id = v_id;
    RETURN json_build_object('id', v_id, 'queued', false);
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object('id', v_id),
    headers := v_headers,
    timeout_milliseconds := 20000
  );
  RETURN json_build_object('id', v_id, 'queued', true);
END;
$$;

-- 9h) Baneos
CREATE OR REPLACE FUNCTION public.admin_ban(p_token text, p_player_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_p       public.players%ROWTYPE;
  v_ban_id  uuid;
  v_reason  text;
BEGIN
  PERFORM public.admin_require(p_token);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_p FROM public.players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT b.id INTO v_ban_id
    FROM public.banned_users b
   WHERE b.user_id = v_p.user_id
      OR (b.discord_id IS NOT NULL AND b.discord_id = v_p.discord_id)
      OR (b.x_id       IS NOT NULL AND b.x_id       = v_p.x_id)
   ORDER BY b.banned_at
   LIMIT 1;

  IF v_ban_id IS NULL THEN
    INSERT INTO public.banned_users (user_id, discord_id, x_id, alias, reason)
    VALUES (v_p.user_id, v_p.discord_id, v_p.x_id, v_p.alias, v_reason)
    RETURNING id INTO v_ban_id;
  ELSE
    UPDATE public.banned_users
       SET user_id    = coalesce(v_p.user_id, user_id),
           discord_id = coalesce(v_p.discord_id, discord_id),
           x_id       = coalesce(v_p.x_id, x_id),
           alias      = coalesce(v_p.alias, alias),
           reason     = v_reason,
           banned_at  = now()
     WHERE id = v_ban_id;
  END IF;

  UPDATE public.players
     SET banner_path = NULL, banner_sha256 = NULL, splattag_config = NULL
   WHERE id = p_player_id;

  RETURN json_build_object('ban_id', v_ban_id, 'alias', v_p.alias, 'banner_path', v_p.banner_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unban(p_token text, p_ban_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  DELETE FROM public.banned_users WHERE id = p_ban_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ban not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_banned_list(p_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.admin_require(p_token);
  RETURN coalesce((
    SELECT json_agg(json_build_object(
             'id', b.id, 'user_id', b.user_id, 'discord_id', b.discord_id, 'x_id', b.x_id,
             'alias', b.alias, 'reason', b.reason, 'banned_at', b.banned_at)
           ORDER BY b.banned_at DESC)
      FROM public.banned_users b
  ), '[]'::json);
END;
$$;

-- ------------------------------------------------------------
-- 10) Permisos: NUNCA anon. authenticated (web, con token) y service_role
--     (panel local, sin token). Supabase concede EXECUTE por defecto a
--     anon/authenticated en cada función nueva: se retira explícitamente.
-- ------------------------------------------------------------
DO $do$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_list(text)',
    'public.admin_pending_count(text)',
    'public.admin_approve(text, uuid)',
    'public.admin_reset_generic(text, uuid)',
    'public.admin_reset_key(text, uuid)',
    'public.admin_set_status(text, uuid, text)',
    'public.admin_reject(text, uuid)',
    'public.admin_email_status(text, uuid)',
    'public.admin_players(text)',
    'public.admin_edc_overview(text)',
    'public.admin_feedback_list(text, text, int)',
    'public.admin_feedback_set_status(text, uuid, text)',
    'public.admin_email_log(text, int)',
    'public.admin_send_email(text, text, text, text, text, text)',
    'public.admin_ban(text, uuid, text)',
    'public.admin_unban(text, uuid)',
    'public.admin_banned_list(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$do$;

NOTIFY pgrst, 'reload schema';

-- ►►► ALTA DEL ADMINISTRADOR (paso manual, una sola vez) ◄◄◄
-- El uuid es el id de auth.users de la cuenta (Discord o X) con la que el
-- administrador inicia sesión en la web. Para encontrarlo:
--   select u.id, i.provider, i.provider_id
--     from auth.users u join auth.identities i on i.user_id = u.id
--    where i.provider_id = '<tu id de Discord>';
-- y después:
--
-- insert into public.admin_identities (user_id, label)
-- values ('00000000-0000-0000-0000-000000000000', 'admin')
-- on conflict (user_id) do nothing;
