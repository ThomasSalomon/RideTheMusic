# Sesiones revocables (RTM-SEC-005)

## Política

- Un login o registro crea una sesión independiente.
- `POST /api/auth/logout` revoca sólo la sesión del JWT recibido y siempre expira la cookie.
- Cambiar la contraseña revoca todas las sesiones activas del usuario, incrementa `credentialsVersion` y expira la cookie. Restablecerla con un enlace de recuperación hace lo mismo (ver [account-emails.md](account-emails.md)).
- Las sesiones vencidas o revocadas no se aceptan aunque el JWT conserve una firma y expiración válidas.

## Modelo y verificación

`AuthSession` almacena el identificador de sesión, usuario, versión de credenciales, creación, vencimiento y revocación. No almacena JWT, cookies, secretos, contraseñas, IP ni user-agent. El identificador es un UUID criptográficamente aleatorio incluido en el JWT como `sessionId`; no es un secreto autenticante sin la firma HS256 del JWT, por lo que se almacena directamente.

Los claims pasaron de `userId`, `username`, `iat`, `exp` a añadir `sessionId` y `credentialsVersion`. El helper autoritativo valida firma, expiración, claims, existencia de sesión, usuario correspondiente, ausencia de revocación, expiración del registro y ambas versiones de credenciales. Cada validación protegida realiza una sola operación Prisma indexada por sesión, con filtro relacional para la versión del usuario; no hay caché de sesiones.

Los índices son la PK de `AuthSession` para la validación, `(userId, revokedAt)` para revocar las sesiones activas de una cuenta y `(expiresAt)` para una eventual limpieza administrativa. La corrección no depende de limpieza automática; no se añadió cron ni worker.

## Migración, despliegue y rollback

La migración `20260804140000_revocable_sessions` es incremental: añade `User.credentialsVersion` con valor inicial `0`, crea `AuthSession` y preserva usuarios existentes. Los JWT anteriores no incluyen los claims de sesión y se rechazan deliberadamente al activar el código nuevo, forzando login una sola vez.

Orden seguro: aplicar la migración versionada, desplegar el código que emite y comprueba sesiones, y verificar login/logout. No se debe revertir el código después de empezar a emitir los nuevos claims: el código viejo no necesita esos claims, pero volvería a aceptar JWT legacy no revocables. Si fuese necesario rollback, mantener el esquema y volver a una versión que siga exigiendo `sessionId`; eliminar la tabla o columna sólo es seguro tras retirar ese código y aceptar el cierre forzado de todas las sesiones.

No se ejecutó ninguna migración sobre Turso ni producción durante este cambio.
