import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import { withPublicAvatar } from "@/services/avatar";
import { getPageLimit, PaginationError } from "@/utils/cursor-pagination";

export const dynamic = "force-dynamic";

const MAX_SEARCH_INDEX = 10_000;
const MAX_QUERY_LENGTH = 100;

const userSelect = {
  username: true,
  profileColor: true,
  profileImage: true,
  _count: {
    select: { followers: true, following: true, reviews: true },
  },
} as const;

function searchIndex(searchParams: URLSearchParams): number {
  const raw = searchParams.get("index");
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_SEARCH_INDEX) {
    throw new PaginationError(`El índice debe ser un entero entre 0 y ${MAX_SEARCH_INDEX}`);
  }
  return Number(raw);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q") || "";
    const index = searchIndex(url.searchParams);
    const limit = getPageLimit(url.searchParams);

    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `La búsqueda no puede superar ${MAX_QUERY_LENGTH} caracteres` },
        { status: 400 }
      );
    }

    if (!query) {
      // If no query, return top users by follower count
      const topUsers = await prisma.user.findMany({
        skip: index,
        take: limit,
        orderBy: [
          {
            followers: {
              _count: "desc",
            },
          },
          {
            reviews: {
              _count: "desc",
            },
          }
        ],
        select: userSelect,
      });
      return NextResponse.json(topUsers.map(withPublicAvatar));
    }

    const users = await prisma.user.findMany({
      where: {
        username: {
          contains: query,
        },
      },
      skip: index,
      take: limit,
      select: userSelect,
    });

    return NextResponse.json(users.map(withPublicAvatar));
  } catch (error) {
    if (error instanceof PaginationError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("GET user search error:", error);
    return NextResponse.json(
      { error: "Error al buscar usuarios" },
      { status: 500 }
    );
  }
}
