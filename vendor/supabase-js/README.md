# supabase-js (vendorizado)

- Paquete: `@supabase/supabase-js` **2.116.0** (licencia MIT, ver `LICENSE`).
- Fichero: `supabase-js-2.116.0.min.js` = `dist/umd/supabase.js` del tarball
  oficial de npm, sin modificar. Expone `window.supabase`.
- Origen: `https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.116.0.tgz`
  - integridad del tarball (registro npm): `sha512-YyWmKXt2NspV9iO8FPnlswUFJIRnrLd3oTCb+3ZyYRuKZtBH0xCUDgnUqoyA0fGUxpM/UhfwDjYf/dht/9bp7g==`
  - sha256 del fichero vendorizado: `84ee9bf45695c1dd3ba1595b6bcfb0f09672434631351ffc8ebe9140545d5ff6`

Por qué: la web se sirve con una CSP `script-src 'self'`; nada de scripts de
terceros en tiempo de ejecución (antes se importaba desde esm.sh sin SRI).

## Actualizar

```sh
npm pack @supabase/supabase-js@<versión>          # descarga el tarball
tar -xzf supabase-supabase-js-<versión>.tgz package/dist/umd/supabase.js package/LICENSE
# comprobar la integridad contra `npm view @supabase/supabase-js@<versión> dist.integrity`
cp package/dist/umd/supabase.js vendor/supabase-js/supabase-js-<versión>.min.js
```

Después: cambiar la ruta en `index.html` (`<script src="vendor/supabase-js/...">`),
actualizar este README (versión + hashes) y borrar el fichero antiguo.
