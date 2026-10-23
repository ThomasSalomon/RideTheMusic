import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import {
  parseCreateCommentInput,
  SocialActionError,
  SocialActionService,
} from "@/services/social-actions";
import { resolveAuthUser } from "@/utils/auth";
import { withPublicAvatar } from "@/services/avatar";
import { ascendingTemporalWhere, getPageLimit, pageResult, PaginationError, temporalCursor } from "@/utils/cursor-pagination";

export const dynamic = "force-dynamic";

function socialErrorResponse(error: SocialActionError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await resolveAuthUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { error: "No autenticado", code: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new SocialActionError("INVALID_JSON", "El body debe contener JSON válido", 400);
    }
    const input = parseCreateCommentInput(body);
    const result = await SocialActionService.comment(auth.user, params.id, input);
    return NextResponse.json(
      {
        ...result.comment,
        user: withPublicAvatar(result.comment.user),
        changed: result.changed,
        commentsCount: result.commentsCount,
      },
      { status: result.changed ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof SocialActionError) return socialErrorResponse(error);
    console.error("POST comment error:", error);
    return NextResponse.json(
      { error: "Error al agregar comentario", code: "COMMENT_FAILED" },
      { status: 500 },
    );
  }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const limit = getPageLimit(searchParams);
    const cursor = temporalCursor(searchParams);
    const comments = await prisma.comment.findMany({
      where: { reviewId: params.id, ...(cursor ? { OR: ascendingTemporalWhere(cursor) } : {}) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: {
        user: {
          select: {
            username: true,
            profileColor: true,
            profileImage: true,
          },
        },
      },
    });

    const page = pageResult(comments, limit, "createdAt");
    return NextResponse.json({
      ...page,
      items: page.items.map((comment) => ({ ...comment, user: withPublicAvatar(comment.user) })),
    });
  } catch (error) {
    if (error instanceof PaginationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("GET comments error:", error);
    return NextResponse.json(
      { error: "Error al obtener comentarios" },
      { status: 500 },
    );
  }
}
