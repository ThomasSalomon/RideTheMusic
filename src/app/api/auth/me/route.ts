import { NextResponse } from "next/server";
import { resolveAuthUser } from "@/utils/auth";
import { prisma } from "@/services/db";
import { routeErrorResponse } from "@/utils/http-errors";
import { withPublicAvatar } from "@/services/avatar";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthUser(request);
    if (!auth.ok) return NextResponse.json({ user: null }, { status: 200 });

    const dbUser = await prisma.user.findUnique({
      where: { id: auth.user.userId },
      select: { id: true, username: true, profileColor: true, profileImage: true },
    });

    if (!dbUser) {
      console.error("Auth me authenticated session references a missing user", {
        userId: auth.user.userId,
      });
      return NextResponse.json(
        { error: "No se pudo obtener la sesión autenticada", code: "INTERNAL_ERROR" },
        { status: 500 },
      );
    }

    return NextResponse.json({ user: withPublicAvatar(dbUser) });
  } catch (error) {
    return routeErrorResponse(error, {
      operation: "Auth me check error:",
      fallbackMessage: "No se pudo obtener la sesión autenticada",
    });
  }
}
