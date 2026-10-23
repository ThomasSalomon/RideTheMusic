import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import { getAuthUser } from "@/utils/auth";
import { withPublicAvatar } from "@/services/avatar";
import { descendingTemporalWhere, getPageLimit, pageResult, PaginationError, temporalCursor } from "@/utils/cursor-pagination";

export async function GET(req: Request) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = getPageLimit(searchParams);
    const cursor = temporalCursor(searchParams);
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const whereClause: any = { userId: authUser.userId };
    if (unreadOnly) {
      whereClause.isRead = false;
    }
    if (cursor) whereClause.OR = descendingTemporalWhere(cursor);

    const notifications = await prisma.notification.findMany({
      where: whereClause,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, type: true, message: true, isRead: true, createdAt: true, sourceUserId: true, link: true, userId: true },
    });

    const page = pageResult(notifications, limit, "createdAt");
    const sourceUserIds = Array.from(new Set(page.items.map((notification) => notification.sourceUserId).filter((id): id is string => Boolean(id))));
    const sourceUsers = sourceUserIds.length === 0 ? [] : await prisma.user.findMany({
      where: { id: { in: sourceUserIds } },
      select: { id: true, username: true, profileImage: true, profileColor: true },
    });
    const sourceUsersById = new Map(sourceUsers.map((user) => [user.id, withPublicAvatar(user)]));
    const enrichedNotifications = page.items.map((notification) => ({
      ...notification,
      sourceUser: notification.sourceUserId ? sourceUsersById.get(notification.sourceUserId) ?? null : null,
    }));

    const unreadCount = await prisma.notification.count({
      where: { userId: authUser.userId, isRead: false },
    });

    return NextResponse.json({
      notifications: enrichedNotifications,
      unreadCount,
      nextCursor: page.nextCursor,
      hasNextPage: page.hasNextPage,
      limit: page.limit,
    });
  } catch (error) {
    if (error instanceof PaginationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("GET notifications error:", error);
    return NextResponse.json(
      { error: "Error al obtener notificaciones" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const authUser = await getAuthUser();
    if (!authUser) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    await prisma.notification.deleteMany({
      where: { userId: authUser.userId }
    });

    return NextResponse.json({ message: "Todas las notificaciones han sido eliminadas" });
  } catch (error) {
    console.error("DELETE notifications error:", error);
    return NextResponse.json(
      { error: "Error al eliminar notificaciones" },
      { status: 500 }
    );
  }
}
