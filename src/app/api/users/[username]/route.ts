import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import { getAuthUser } from "@/utils/auth";
import { updateProfile } from "@/services/profile";
import { parseProfileUpdate } from "@/services/profile-input";
import { routeErrorResponse } from "@/utils/http-errors";
import { readJsonObject } from "@/utils/request-body";
import { withPublicAvatar } from "@/services/avatar";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { username: string } }
) {
  try {
    const { username } = params;

    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        bio: true,
        favoriteGenre: true,
        profileColor: true,
        profileImage: true,
        createdAt: true,
        favoriteAlbums: {
          orderBy: { slot: "asc" },
          include: {
            musicItem: {
              select: {
                id: true,
                title: true,
                artist: true,
                coverUrl: true,
                type: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    // Fetch counts
    const reviewsCount = await prisma.review.count({
      where: { userId: user.id },
    });

    const followersCount = await prisma.follow.count({
      where: { followingId: user.id },
    });

    const followingCount = await prisma.follow.count({
      where: { followerId: user.id },
    });

    // Check if current user is following this user
    let isFollowing = false;
    const authUser = await getAuthUser(req);
    if (authUser && authUser.userId !== user.id) {
      const followRecord = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: authUser.userId,
            followingId: user.id,
          },
        },
      });
      isFollowing = !!followRecord;
    }

    // Remove internal id from return value to prevent ID harvesting
    const { id, ...publicProfile } = user;

    return NextResponse.json({
      profile: withPublicAvatar(publicProfile),
      stats: {
        reviewsCount,
        followersCount,
        followingCount,
      },
      isFollowing,
    });
  } catch (error) {
    console.error("GET user profile error:", error);
    return NextResponse.json(
      { error: "Error al obtener perfil de usuario" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { username: string } }
) {
  try {
    const { username } = params;

    // 1. Authenticate request
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: "No autenticado" },
        { status: 401 }
      );
    }

    // 2. Authorization check (only owner can modify)
    if (authUser.username !== username) {
      return NextResponse.json(
        { error: "Acceso prohibido (no puedes editar el perfil de otra persona)" },
        { status: 403 }
      );
    }

    // 3. Validate the complete DTO before performing any write.
    const input = parseProfileUpdate(await readJsonObject(req));
    const updatedUser = await updateProfile(authUser, username, input);

    return NextResponse.json({
      message: "Perfil actualizado con éxito",
      profile: updatedUser,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      operation: "PUT user profile error:",
      fallbackMessage: "Error al actualizar perfil de usuario",
    });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { username: string } }
) {
  try {
    const { username } = params;
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    // Verify user exists and matches auth
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    if (user.id !== authUser.userId) {
      return NextResponse.json(
        { error: "No autorizado para eliminar este perfil" },
        { status: 403 }
      );
    }

    // Prisma Cascade delete handles reviews, comments, lists, etc.
    await prisma.user.delete({
      where: { id: user.id },
    });

    return NextResponse.json({ message: "Cuenta eliminada con éxito" }, { status: 200 });
  } catch (error) {
    console.error("DELETE user error:", error);
    return NextResponse.json(
      { error: "Error interno al eliminar cuenta" },
      { status: 500 }
    );
  }
}
