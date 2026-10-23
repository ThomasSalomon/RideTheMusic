import { NextResponse } from "next/server";
import { MusicService } from "@/services/music";
import { getAuthUser } from "@/utils/auth";
import { prisma } from "@/services/db";
import { descendingTemporalWhere, getPageLimit, pageResult, PaginationError, temporalCursor } from "@/utils/cursor-pagination";
import { DeezerError, deezerHttpError } from "@/services/deezer-http";
import { enrichReviewSummaries } from "@/services/reviews";
import { withPublicAvatar } from "@/services/avatar";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const searchParams = new URL(req.url).searchParams;
    const limit = getPageLimit(searchParams);
    const cursor = temporalCursor(searchParams);

    const currentUserId = (await getAuthUser(req))?.userId ?? null;

    const item = await MusicService.getItemById(id, req.signal);

    if (!item) {
      return NextResponse.json(
        { error: "Ítem musical no encontrado" },
        { status: 404 }
      );
    }

    const reviews = await prisma.review.findMany({
      where: { musicItemId: id, ...(cursor ? { OR: descendingTemporalWhere(cursor) } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { user: { select: { id: true, username: true, profileColor: true, profileImage: true } } },
    });
    const reviewPage = pageResult(reviews, limit, "createdAt");

    // Check if current user has marked a favorite track on this album
    let favoriteTrack: string | null = null;
    let isListenLater = false;
    let currentUserRating: number | null = null;
    let enrichedReviews = reviewPage.items;
    try {
      if (currentUserId) {
        const record = await prisma.favoriteTrack.findFirst({
          where: {
            userId: currentUserId,
            musicItemId: id,
          },
          select: { trackTitle: true },
        });
        favoriteTrack = record?.trackTitle || null;

        const listenLaterRecord = await prisma.listenLater.findFirst({
          where: {
            userId: currentUserId,
            musicItemId: id,
          },
          select: { userId: true },
        });
        isListenLater = !!listenLaterRecord;

        const ratingRecord = await prisma.rating.findUnique({
          where: {
            userId_musicItemId: {
              userId: currentUserId,
              musicItemId: id,
            },
          },
          select: { value: true },
        });
        currentUserRating = ratingRecord?.value || null;
      }

      enrichedReviews = await enrichReviewSummaries(reviewPage.items, currentUserId);
    } catch (e) {
      console.error("Failed to query favorite track or interactive details:", e);
    }

    return NextResponse.json({
      ...item,
      reviews: enrichedReviews.map((review) => ({ ...review, user: withPublicAvatar(review.user) })),
      reviewsNextCursor: reviewPage.nextCursor,
      reviewsHasNextPage: reviewPage.hasNextPage,
      reviewsLimit: reviewPage.limit,
      favoriteTrack,
      isListenLater,
      currentUserRating,
    });
  } catch (error) {
    if (error instanceof PaginationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof DeezerError) {
      const response = deezerHttpError(error);
      return NextResponse.json(response.body, { status: response.status, headers: response.headers });
    }
    console.error("Fetch single music item error:", error);
    return NextResponse.json(
      { error: "Error al obtener detalles del álbum" },
      { status: 500 }
    );
  }
}
