# Correos de cuenta

Tres correos de seguridad, en el idioma con el que navega la persona (es, en, pt):

| Correo | Cuándo se envía |
| --- | --- |
| Nuevo inicio de sesión | Login correcto desde un navegador que esa cuenta no había usado antes. |
| Recuperación de contraseña | `POST /api/auth/forgot-password` con el correo de una cuenta existente. |
| Contraseña cambiada | Después de restablecerla con un enlace o de cambiarla desde el perfil. |

## Configuración

| Variable | Uso |
| --- | --- |
| `APP_URL` | Origen público de la app. Los enlaces de los correos se arman sólo con esto, nunca con `Host` ni `X-Forwarded-Host`. Obligatoria y con `https` en producción. |
| `RESEND_API_KEY`, `MAIL_FROM` | Proveedor [Resend](https://resend.com) por HTTP, sin dependencias nuevas. El remitente tiene que ser de un dominio verificado. |

Sin proveedor, en desarrollo los correos se imprimen en la consola del servidor (para seguir los enlaces localmente) y en tests se descartan. En producción un proveedor faltante es un error que se registra, nunca una impresión del contenido. Cambiar de proveedor es reemplazar `resendTransport` en `src/services/mail.ts`.

## Nuevo inicio de sesión

- Cada navegador recibe una cookie `rtm_device` (aleatoria de 256 bits, `HttpOnly`, `SameSite=Lax`, 400 días). En `KnownDevice` se guarda sólo su SHA-256 por cuenta; no se persisten IP ni user-agent, igual que en `AuthSession`.
- Si el login llega sin cookie, con una cookie mal formada o con una que esa cuenta no conoce, se registra el dispositivo y se avisa. El correo muestra fecha (UTC), navegador y sistema en nombres fijos (nunca el header crudo) y la IP sólo si hay un proxy de confianza (`TRUSTED_PROXY_HOPS` o Vercel).
- El navegador que crea la cuenta queda registrado, así que su siguiente login no avisa.
- Se guardan hasta 20 dispositivos por cuenta; se descartan los vistos hace más tiempo.
- El login nunca falla por esto: un error al registrar el dispositivo se loguea y la sesión se emite igual.
- Al desplegar, cada usuario existente recibe un aviso en su primer login, porque ningún navegador está registrado todavía.

## Recuperación de cuenta

Flujo: `/[locale]/forgot-password` → correo con enlace → `/[locale]/reset-password#token=…` → `POST /api/auth/reset-password`.

Medidas:

- **Sin enumeración.** `forgot-password` responde siempre `202` con el mismo cuerpo, exista o no la cuenta, y también cuando se agotó el límite por dirección. Buscar la cuenta, emitir el token y enviar el correo corre en segundo plano (`runInBackground`), así que el tiempo de respuesta tampoco depende de la cuenta.
- **Token.** 32 bytes aleatorios en base64url. En `PasswordResetToken` se guarda sólo su SHA-256; quien lea la base no puede usar enlaces vigentes.
- **Fuera de logs.** El token viaja en el fragmento (`#token=`), que el navegador no manda al servidor ni en `Referer`. La página lo lee una vez y lo borra de la barra de direcciones y del historial.
- **Vida corta y un solo uso.** Vence a los 30 minutos. Canjearlo lo marca usado dentro de la misma transacción que cambia la contraseña, y dos canjes simultáneos compiten por la misma fila.
- **Sólo el último enlace sirve.** Pedir uno nuevo retira los anteriores sin usar; restablecer retira todos.
- **Atado a las credenciales.** El token guarda el `credentialsVersion` con que se emitió. Si la contraseña cambia por cualquier vía, los enlaces pendientes dejan de funcionar.
- **Efectos del canje.** Nueva contraseña, `credentialsVersion + 1`, revocación de todas las sesiones, cookie de sesión expirada y correo de "contraseña cambiada" con un enlace para recuperar la cuenta si no fue la persona.
- **Límites.** Pedido: 10 cada 15 min por IP (si hay proxy de confianza) y 3 cada 15 min por dirección en memoria. En la base, por cuenta: 1 por minuto y 5 por hora, serializados por cuenta dentro de cada instancia. El tope por hora es bajo para frenar el spam y corto para que un tercero no bloquee la recuperación mucho tiempo. Canje: 10 cada 15 min por IP; un token de 256 bits no se puede adivinar.
- **Enlaces sin Host.** Ver `APP_URL` arriba: un `Host` falsificado no puede poner otro dominio delante de un token real.
- **HTML escapado.** Todo valor dinámico de los correos pasa por `escapeHtml`.

## Limitaciones conocidas

- En hosts serverless la instancia puede congelarse después de responder y cortar una tarea en segundo plano; el correo se perdería. Si pasa en la práctica, la salida es una cola (o `waitUntil` de `@vercel/functions`) en lugar de `runInBackground`.
- Los límites en memoria son por instancia (como el resto de `rateLimit`); los de la base son globales.
- La dirección se busca tal como se registró y, si no aparece, en minúsculas. El registro no normaliza correos.

## Migración

`20261024120000_account_emails` crea `PasswordResetToken` y `KnownDevice`; no toca datos existentes. Aplicarla antes de desplegar el código. Rollback: volver al código anterior es seguro (ignora las tablas); borrarlas sólo invalida enlaces pendientes y hace que el próximo login de cada navegador vuelva a avisar.
