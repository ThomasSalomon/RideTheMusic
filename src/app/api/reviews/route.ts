import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import { getAuthUser, resolveAuthUser } from "@/utils/auth";
import { parseCreateReviewInput } from "@/services/review-input";
import { createReview, enrichReviewSummaries } from "@/services/reviews";
import { readJsonObject } from "@/utils/request-body";
import { routeErrorResponse } from "@/utils/http-errors";
import { withPublicAvatar } from "@/services/avatar";
import {
  invalidateUserRecapCache,
  invalidateUserStatsCache,
} from "@/services/user-derived-cache";

export const dynamic = "force-dynamic";

// Fetch recent reviews for activity feed (supports feed=following and username filters)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const feed = searchParams.get("feed");
    const username = searchParams.get("username");

    let whereClause = {};

    if (feed === "following") {
      const auth = await resolveAuthUser(req);
      if (!auth.ok && auth.reason === "missing") {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      }
      if (!auth.ok) {
        return NextResponse.json({ error: "Token inválido" }, { status: 401 });
      }

      const follows = await prisma.follow.findMany({
        where: { followerId: auth.user.userId },
        select: { followingId: true },
      });
      const followingIds = follows.map((f) => f.followingId);

      whereClause = {
        userId: { in: followingIds },
      };
    } else if (username) {
      whereClause = {
        user: { username },
      };
    }

    const reviews = await prisma.review.findMany({
      where: whereClause,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        user: {
          select: {
            id: true,
            username: true,
            profileColor: true, // We include this to display color presets in avatars
            profileImage: true,
          },
        },
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
      take: 10,
    });

    const currentUserId = reviews.length > 0
      ? (await getAuthUser(req))?.userId ?? null
      : null;
    const enrichedReviews = await enrichReviewSummaries(reviews, currentUserId);

    return NextResponse.json(
      enrichedReviews.map((review) => ({ ...review, user: withPublicAvatar(review.user) })),
    );
  } catch (error) {
    console.error("Fetch reviews error:", error);
    return NextResponse.json(
      { error: "Error al obtener reseñas" },
      { status: 500 }
    );
  }
}

// Create a review and atomically upsert the corresponding current rating.
export async function POST(req: Request) {
  try {
    const auth = await resolveAuthUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401 }
      );
    }
    const input = parseCreateReviewInput(await readJsonObject(req));
    const { review, rating } = await createReview(auth.user, input);

    // The review/rating transaction is durable. Both aggregates include this review.
    invalidateUserStatsCache(auth.user.userId);
    invalidateUserRecapCache(auth.user.userId, review.createdAt.getUTCFullYear());

    return NextResponse.json({
      message: "Reseña guardada con éxito",
      review,
      rating,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      operation: "Save review error:",
      fallbackMessage: "Error al guardar la reseña",
    });
  }
}
