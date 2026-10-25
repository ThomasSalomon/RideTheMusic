import { NextResponse } from "next/server";
import { isEmailLocale, resolveEmailLocale } from "@/services/account-emails";
import { requestPasswordReset } from "@/services/password-reset";
import { runInBackground } from "@/utils/background";
import { rateLimit, getClientIP } from "@/utils/rateLimit";
import { readJsonObject, rejectUnknownFields, RequestBodyError } from "@/utils/request-body";

const IP_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 10 };
const ADDRESS_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 3 };
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same body and status whether or not the address has an account.
const ACCEPTED_MESSAGE =
  "Si el correo corresponde a una cuenta, te enviamos un enlace para restablecer la contraseña.";

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req);
    if (ip && !rateLimit(`password-reset:ip:${ip}`, IP_RATE_LIMIT).success) {
      return NextResponse.json({ error: "Demasiadas solicitudes. Intenta de nuevo más tarde." }, { status: 429 });
    }

    const body = await readJsonObject(req);
    rejectUnknownFields(body, ["email", "locale"]);
    const { email, locale } = body;

    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "El correo electrónico es obligatorio" }, { status: 400 });
    }
    const address = email.trim();
    if (address.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(address)) {
      return NextResponse.json({ error: "El correo electrónico no tiene un formato válido" }, { status: 400 });
    }

    // An exhausted address limit is answered like any other request, so it
    // cannot be used to learn which addresses someone else is targeting.
    if (rateLimit(`password-reset:address:${address.toLowerCase()}`, ADDRESS_RATE_LIMIT).success) {
      const emailLocale = isEmailLocale(locale) ? locale : resolveEmailLocale(req);
      runInBackground("password reset request", () => requestPasswordReset(address, emailLocale));
    }

    return NextResponse.json({ message: ACCEPTED_MESSAGE }, { status: 202 });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Password reset request error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
