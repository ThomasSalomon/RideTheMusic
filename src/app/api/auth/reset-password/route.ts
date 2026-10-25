import { NextResponse } from "next/server";
import { isEmailLocale, resolveEmailLocale } from "@/services/account-emails";
import { resetPasswordWithToken, sendPasswordChangedEmail } from "@/services/password-reset";
import { clearAuthCookie } from "@/utils/auth";
import { runInBackground } from "@/utils/background";
import { routeErrorResponse } from "@/utils/http-errors";
import { rateLimit, getClientIP } from "@/utils/rateLimit";
import { readJsonObject, rejectUnknownFields, RequestBodyError } from "@/utils/request-body";

const IP_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 10 };

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req);
    if (ip && !rateLimit(`password-reset-confirm:ip:${ip}`, IP_RATE_LIMIT).success) {
      return NextResponse.json({ error: "Demasiados intentos. Intenta de nuevo más tarde." }, { status: 429 });
    }

    const body = await readJsonObject(req);
    rejectUnknownFields(body, ["token", "newPassword", "locale"]);
    const { token, newPassword, locale } = body;
    if (typeof token !== "string" || typeof newPassword !== "string" || !token || !newPassword) {
      throw new RequestBodyError("El enlace y la nueva contraseña son requeridos");
    }
    if (newPassword.length < 6) {
      throw new RequestBodyError("La nueva contraseña debe tener al menos 6 caracteres");
    }

    const account = await resetPasswordWithToken(token, newPassword);
    const emailLocale = isEmailLocale(locale) ? locale : resolveEmailLocale(req);
    runInBackground("password changed notice", () => sendPasswordChangedEmail(account, emailLocale));

    // Every session was revoked, including any this browser held.
    const response = NextResponse.json({ message: "Contraseña restablecida. Ya podés iniciar sesión." });
    clearAuthCookie(response);
    return response;
  } catch (error) {
    return routeErrorResponse(error, {
      operation: "Password reset confirm error:",
      fallbackMessage: "Error interno al restablecer la contraseña",
    });
  }
}
