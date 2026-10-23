import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import {
  ALLOWED_AVATAR_MIMES,
  avatarVersion,
  parseAvatarDataUrl,
} from "@/services/avatar";

export const dynamic = "force-dynamic";

// Serves uploaded avatars as images so API payloads only carry their URL.
export async function GET(
  req: Request,
  { params }: { params: { username: string } }
) {
  try {
    const user = await prisma.user.findUnique({
      where: { username: params.username },
      select: { profileImage: true },
    });

    const avatar = user?.profileImage ? parseAvatarDataUrl(user.profileImage) : null;
    if (!user?.profileImage || !avatar || !ALLOWED_AVATAR_MIMES.has(avatar.mime)) {
      return NextResponse.json({ error: "Avatar no encontrado" }, { status: 404 });
    }

    // A matching version addresses immutable bytes; anything else must revalidate.
    const requestedVersion = new URL(req.url).searchParams.get("v");
    const isCurrentVersion = requestedVersion === avatarVersion(user.profileImage);

    return new NextResponse(Buffer.from(avatar.base64, "base64"), {
      headers: {
        "Content-Type": avatar.mime,
        "Cache-Control": isCurrentVersion
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("GET avatar error:", error);
    return NextResponse.json({ error: "Error al obtener el avatar" }, { status: 500 });
  }
}
