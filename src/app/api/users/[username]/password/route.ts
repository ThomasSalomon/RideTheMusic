import { NextResponse } from "next/server";
import { authorizePasswordChange, changePassword } from "@/services/account";
import { resolveEmailLocale } from "@/services/account-emails";
import { sendPasswordChangedEmail } from "@/services/password-reset";
import { clearAuthCookie, resolveAuthUser } from "@/utils/auth";
import { runInBackground } from "@/utils/background";
import { routeErrorResponse } from "@/utils/http-errors";
import { readJsonObject, rejectUnknownFields, RequestBodyError } from "@/utils/request-body";

export async function PATCH(
  req: Request,
  { params }: { params: { username: string } },
) {
  try {
    const auth = await resolveAuthUser(req);
    if (!auth.ok) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const changeContext = await authorizePasswordChange(auth.user, params.username);

    const body = await readJsonObject(req);
    rejectUnknownFields(body, ["currentPassword", "newPassword"]);
    const { currentPassword, newPassword } = body;
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || !currentPassword || !newPassword) {
      throw new RequestBodyError("La contraseña actual y la nueva son requeridas");
    }
    if (newPassword.length < 6) {
      throw new RequestBodyError("La nueva contraseña debe tener al menos 6 caracteres");
    }

    const account = await changePassword(changeContext, { currentPassword, newPassword });
    const locale = resolveEmailLocale(req);
    runInBackground("password changed notice", () => sendPasswordChangedEmail(account, locale));

    const response = NextResponse.json({ message: "Contraseña actualizada con éxito" });
    clearAuthCookie(response);
    return response;
  } catch (error) {
    return routeErrorResponse(error, {
      operation: "PATCH password error:",
      fallbackMessage: "Error interno al cambiar la contraseña",
    });
  }
}
