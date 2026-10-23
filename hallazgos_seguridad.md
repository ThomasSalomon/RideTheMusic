# Revisión de seguridad — Ride The Music

> **Fecha:** 2026-10-22 · **Commit revisado:** `2715946` · **Tipo:** revisión white-box manual + verificación
> dinámica contra `next dev` local (puerto 3100) con una SQLite aislada y cuentas de prueba descartables.
> **No se usó Strix** (no había Docker, CLI ni clave de LLM); los hallazgos "Validado" se reprodujeron con
> peticiones HTTP reales, los "Observación" no se explotaron.

## Resumen

| ID | Severidad | Estado | Hallazgo |
|---|---|---|---|
| RTM-SEC-101 | Media | ✅ Corregido | Rate limit de login/registro evitable con `X-Forwarded-For` |
| RTM-SEC-102 | Media | ✅ Corregido | Campos de perfil sin límite y amplificación por avatares base64 |
| RTM-SEC-103 | Baja | ✅ Corregido | Enumeración de cuentas por tiempo: el hash bcrypt "dummy" es inválido |
| RTM-SEC-104 | Baja | ✅ Corregido | `GET /api/users/search` sin tope de `limit` ni validación de `index` |
| RTM-SEC-105 | Baja | ✅ Corregido | Registro acepta usernames sin formato ni longitud máxima |

Las correcciones de 101–105 están cubiertas por `test/security-hardening-unit.test.ts` (en `test:unit`) y
`test/security-hardening.test.ts` (en `test:integration`). Cada hallazgo indica abajo qué cambió.
| RTM-SEC-106 | Baja | 🔎 Observación | Sin cabeceras de seguridad (CSP, `frame-ancestors`, `nosniff`) |
| RTM-SEC-107 | Baja | 🔎 Observación | Escrituras no autenticadas en `MusicItem` desde IDs arbitrarios de Deezer |
| RTM-SEC-108 | Info | 🔎 Observación | Endurecimientos menores (ver final) |

No se encontraron IDOR, escalada de privilegios, inyección ni XSS: todos los handlers que escriben comprueban
propiedad contra la sesión (`resolveAuthUser`/`getAuthUser`), Prisma parametriza las consultas, el frontend no
usa `dangerouslySetInnerHTML`, la cookie es `HttpOnly` + `SameSite=Strict`, las URLs a Deezer se construyen
con IDs numéricos validados y los tickets de importación de playlists van firmados.

---

### RTM-SEC-101 — Rate limit evitable con `X-Forwarded-For`

- **Corrección:** `getClientIP` (`src/utils/rateLimit.ts`) sólo devuelve una IP si el despliegue declara
  proxies de confianza (`TRUSTED_PROXY_HOPS`, o `VERCEL=1`) y toma el salto que agregó el proxy, no el primero.
  El login suma un límite por cuenta (identificador normalizado, 10 intentos cada 15 min) que se aplica
  siempre. El registro sin IP confiable usa un único bucket compartido. Las claves van con prefijo por ruta
  (antes login y registro compartían el contador) y el store está acotado a 50 000 entradas.
- **Pendiente operativo:** si se hospeda fuera de Vercel detrás de un proxy, configurar `TRUSTED_PROXY_HOPS`.
  Con varias instancias, el límite sigue siendo por instancia.

- **Ubicación:** `src/utils/rateLimit.ts` (`getIP`), usado en `src/app/api/auth/login/route.ts` y `register/route.ts`.
- **Causa:** la clave del limitador es el primer valor de `X-Forwarded-For`, que controla el cliente.
- **Prueba:** con el mismo `X-Forwarded-For` el login devuelve `429` a partir del intento 11. Rotando el
  header, 30 intentos fallidos seguidos devolvieron siempre `400` y la contraseña correcta funcionó después
  (`200`). 12 registros con IPs falsas distintas se aceptaron todos (el límite es 10/hora).
- **Impacto:** fuerza bruta de contraseñas sin límite efectivo (el mínimo es 6 caracteres) y alta masiva de
  cuentas. En Vercel el borde sobrescribe el header y el impacto baja; con `next start` directo o detrás de un
  proxy que *agrega* (`proxy_add_x_forwarded_for`) se explota tal cual.
- **Además:** el `Map` nunca expulsa entradas, así que rotar claves también hace crecer la memoria.
- **Recomendación:** derivar la IP sólo de un header que ponga tu proxy de confianza (p. ej. el último salto
  conocido o `x-real-ip` fijado por el proxy), añadir un límite por cuenta (`usernameOrEmail`) además del de IP,
  limpiar entradas vencidas y, si hay varias instancias, usar un store compartido (Upstash/Redis).

### RTM-SEC-102 — Campos de perfil sin límite y amplificación por avatares

- **Corrección:** `favoriteGenre` admite hasta 50 caracteres (también en el input del editor) y las rutas de
  avatar preset, hasta 300. Las fotos subidas se limitan a 300 000 caracteres (el recortador genera un JPEG de
  400×400, muy por debajo). Ninguna respuesta de la API embebe ya el base64: `withPublicAvatar`
  (`src/services/avatar.ts`) lo reemplaza por `/api/users/:username/avatar?v=<hash>`, y esa ruta sirve la
  imagen con caché inmutable. El editor reenvía esa URL al guardar sin cambios y el servidor la trata como
  "sin cambios".
- **Pendiente:** la base sigue guardando la foto inline; moverla a un storage de objetos evitaría leerla en
  cada consulta.

- **Ubicación:** `src/services/profile-input.ts` (`favoriteGenre`), `src/services/profile.ts` (`profileImage`).
- **Prueba:** `PUT /api/users/:username` aceptó un `favoriteGenre` de 5 MB (`200`). Un avatar `data:` de
  2,7 MB también se aceptó y luego `GET /api/users/search` devolvió 2,7 MB en una sola respuesta.
- **Impacto:** un usuario con sesión puede inflar la base y hacer que cada perfil, comentario, reseña o
  resultado de búsqueda que lo incluya pese varios MB (consumo de ancho de banda y CPU para todos los
  visitantes, y factura en Turso).
- **Recomendación:** límite de longitud en `favoriteGenre` (p. ej. 50) y en general en todo texto libre;
  guardar avatares como archivo/objeto (subida a storage) y exponer sólo la URL; como mínimo, no incluir
  `profileImage` base64 en listados.

### RTM-SEC-103 — Enumeración de cuentas por tiempo de respuesta

- **Corrección:** `comparePasswordWithoutAccount` (`src/utils/crypto.ts`) compara contra un hash bcrypt real
  del mismo costo, generado una vez por proceso. El test verifica que tarda lo mismo que una contraseña errónea.

- **Ubicación:** `src/app/api/auth/login/route.ts` (`dummyHash`).
- **Causa:** el hash de relleno tiene 54 caracteres; `bcryptjs.compare` devuelve `false` al instante para
  hashes que no miden 60, así que la mitigación no cuesta nada.
- **Prueba:** mediana de 83 ms para un usuario existente con contraseña errónea contra 10 ms para uno
  inexistente.
- **Impacto:** se puede saber si un usuario o email está registrado. El registro ya lo revela con el mensaje
  "ya está en uso", así que el impacto incremental es bajo, pero el login no debería filtrarlo.
- **Recomendación:** generar el hash dummy una vez con `bcrypt.hash(randomString, 10)` al cargar el módulo.

### RTM-SEC-104 — Búsqueda de usuarios sin paginación acotada

- **Corrección:** `limit` usa `getPageLimit` (1–50, 20 por defecto), `index` debe ser un entero entre 0 y
  10 000, `q` admite hasta 100 caracteres, los errores devuelven `400` y la respuesta ya no incluye `id`
  (Explore usa `username` como key).

- **Ubicación:** `src/app/api/users/search/route.ts`.
- **Prueba:** `?limit=100000` devolvió todos los usuarios; `?index=-5` produjo `500`.
- **Impacto:** volcado completo de usuarios (con `id` interno, que el endpoint de perfil oculta a propósito)
  en una sola petición; combinado con RTM-SEC-102 multiplica el tamaño de la respuesta.
- **Recomendación:** reutilizar `getPageLimit` de `src/utils/cursor-pagination.ts`, validar `index >= 0` y no
  devolver `id` si no se necesita.

### RTM-SEC-105 — Usernames sin formato

- **Corrección:** el registro exige `^[A-Za-z0-9][A-Za-z0-9_.-]{2,29}$` (y emails de hasta 254 caracteres).
  El formulario valida lo mismo, con el mensaje `usernameFormat` en es/en/pt. Los usuarios existentes no se
  modifican.
- **Pendiente:** la unicidad sigue distinguiendo mayúsculas (`Ana` y `ana` pueden coexistir); resolverlo
  requiere una migración con índice único sobre `lower(username)` y revisar duplicados existentes.

- **Ubicación:** `src/app/api/auth/register/route.ts`.
- **Prueba:** se registraron un username de 3001 caracteres y otro con `../`, `?` y `#`.
- **Impacto:** rutas `/users/[username]` y enlaces de notificación rotos o confusos, nombres casi idénticos
  para suplantación visual (mayúsculas, Unicode) y textos enormes en la UI. No se encontró ejecución de código.
- **Recomendación:** `^[a-zA-Z0-9_.]{3,30}$` (o similar) y comparación sin distinguir mayúsculas.

### RTM-SEC-106 — Sin cabeceras de seguridad (Observación)

`next.config.mjs` no define `headers()`. La respuesta de `/en` sólo trae `X-Powered-By: Next.js`. Faltan
`Content-Security-Policy` (incluida `frame-ancestors 'none'` contra clickjacking de acciones como borrar la
cuenta), `X-Content-Type-Options: nosniff`, `Referrer-Policy` y `Strict-Transport-Security` en producción.
Desactivar `poweredByHeader`.

### RTM-SEC-107 — Escrituras anónimas en el catálogo (Observación)

`GET /api/music/:id` (sin sesión) y otros caminos llaman a `MusicService.getItemById`, que crea una fila
`MusicItem` para cualquier ID que Deezer resuelva. Un cliente anónimo puede recorrer IDs y llenar la base
(también consume la cuota de Deezer). No se verificó en vivo porque requiere red externa. Mitigación: rate
limit por IP en esa ruta o no persistir hasta que haya una interacción autenticada.

### RTM-SEC-108 — Endurecimientos menores (Observación)

- `DELETE /api/users/:username` borra la cuenta sin pedir la contraseña actual.
- El cambio de contraseña no tiene rate limit (fuerza bruta de `currentPassword` con una sesión robada).
- `POST /api/lists` escapa `<`/`>` pero `PUT /api/lists/:id` no: inconsistencia de datos (React ya escapa al
  renderizar, así que no hay XSS) que conviene resolver quitando el escape del POST.
- Los límites de 50 listas y 100 ítems por lista se comprueban con *count + create*, con carrera posible bajo
  concurrencia.
- La contraseña mínima de 6 caracteres es baja; 8+ es lo habitual.

## Cobertura y límites

- Revisados: las 35 rutas de `src/app/api`, servicios de auth, perfil, reseñas, listas, social, diario,
  playlists y Deezer, middleware y sinks de XSS del frontend.
- **No cubierto:** dependencias (`npm audit` no se ejecutó), despliegue real (proxy, Vercel, Turso), logging y
  alertas, y pruebas automáticas de explotación tipo Strix. Un análisis con Strix (cloud o con Docker + LLM)
  sigue siendo recomendable para confirmar que no hay más hallazgos.
