import { prisma } from "./db";
import { DeezerService, DeezerAlbumSearchItem } from "./deezer";
import { withPublicAvatar } from "./avatar";

export interface Track {
  title: string;
  duration: string;
}

export interface ReviewWithUser {
  id: string;
  content: string;
  ratingValue: number;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  musicItemId: string;
  user: {
    id: string;
    username: string;
    profileColor?: string | null;
    profileImage?: string | null;
  };
}

export interface MusicItemWithStats {
  id: string;
  title: string;
  artist: string;
  type: string;
  coverUrl: string;
  releaseYear: number;
  tracks: Track[] | null;
  createdAt: Date;
  reviews?: ReviewWithUser[];
  stats: {
    averageRating: number;
    totalRatings: number;
    totalReviews: number;
  };
}

export const MusicService = {
  async getAllItems(type?: "ALBUM" | "SONG") {
    const items = await prisma.musicItem.findMany({
      where: type ? { type } : undefined,
      include: {
        ratings: true,
        reviews: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profileColor: true,
                profileImage: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    return items.map((item) => this._enrichStats(item));
  },

  async getItemById(id: string, signal?: AbortSignal) {
    let item = await prisma.musicItem.findUnique({
      where: { id },
      select: { id: true, title: true, artist: true, type: true, coverUrl: true, releaseYear: true, tracks: true, createdAt: true },
    });

    // If album doesn't exist locally, fetch from Deezer and cache it
    if (!item) {
      const deezerAlbum = await DeezerService.getAlbumById(id, signal);
      if (!deezerAlbum) return null;

      try {
        item = await prisma.musicItem.create({
          data: {
            id: deezerAlbum.id,
            title: deezerAlbum.title,
            artist: deezerAlbum.artist,
            type: "ALBUM",
            coverUrl: deezerAlbum.coverUrl,
            releaseYear: deezerAlbum.releaseYear,
            tracks: JSON.stringify(deezerAlbum.tracks),
          },
          select: { id: true, title: true, artist: true, type: true, coverUrl: true, releaseYear: true, tracks: true, createdAt: true },
        });
      } catch (error: any) {
        // Handle race conditions in case another parallel thread inserted it first (Unique constraint failed)
        if (error.code === "P2002") {
          item = await prisma.musicItem.findUnique({
            where: { id },
            select: { id: true, title: true, artist: true, type: true, coverUrl: true, releaseYear: true, tracks: true, createdAt: true },
          });
        } else {
          throw error;
        }
      }
    }

    if (!item) return null;
    const [ratingStats, totalReviews] = await Promise.all([
      prisma.rating.aggregate({ where: { musicItemId: id }, _avg: { value: true }, _count: { _all: true } }),
      prisma.review.count({ where: { musicItemId: id } }),
    ]);
    let tracks: Track[] | null = null;
    if (item.tracks) {
      try { tracks = JSON.parse(item.tracks); } catch (error) { console.error("Failed to parse tracks for item: " + item.id, error); }
    }
    return {
      ...item,
      tracks,
      reviews: [],
      stats: {
        averageRating: Math.round((ratingStats._avg.value ?? 0) * 10) / 10,
        totalRatings: ratingStats._count._all,
        totalReviews,
      },
    };
  },

  async searchItems(query: string, index: number = 0, limit: number = 50, signal?: AbortSignal) {
    if (!query || query.trim() === "") {
      return [];
    }

    const deezerResults = await DeezerService.searchAlbums(query, index, limit, signal);
    if (deezerResults.length === 0) return [];

    return this.blendExternalItems(deezerResults);
  },

  async blendExternalItems(items: DeezerAlbumSearchItem[]): Promise<MusicItemWithStats[]> {
    const ids = items.map((item) => item.id);
    const localItems = await prisma.musicItem.findMany({
      where: { id: { in: ids } },
      include: {
        ratings: true,
        reviews: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profileColor: true,
                profileImage: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    // Create lookup map
    const localItemsMap = new Map(localItems.map((item) => [item.id, item]));

    return items.map((item) => {
      const localItem = localItemsMap.get(item.id);
      if (localItem) {
        return this._enrichStats(localItem);
      }

      // Return item with 0 ratings/reviews stats
      return {
        id: item.id,
        title: item.title,
        artist: item.artist,
        type: "ALBUM",
        coverUrl: item.coverUrl,
        releaseYear: item.releaseYear,
        tracks: null,
        createdAt: new Date(),
        reviews: [],
        stats: {
          averageRating: 0,
          totalRatings: 0,
          totalReviews: 0,
        },
      };
    });
  },

  async blendExternalItemsForHomeSearch(items: DeezerAlbumSearchItem[]): Promise<MusicItemWithStats[]> {
    const ids = items.map((item) => item.id);
    const localItems = await prisma.musicItem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        artist: true,
        type: true,
        coverUrl: true,
        releaseYear: true,
        tracks: true,
        createdAt: true,
        ratings: { select: { value: true } },
        _count: { select: { reviews: true } },
      },
    });
    const localItemsMap = new Map(localItems.map((item) => [item.id, item]));

    return items.map((item) => {
      const localItem = localItemsMap.get(item.id);
      if (!localItem) {
        return {
          id: item.id,
          title: item.title,
          artist: item.artist,
          type: "ALBUM",
          coverUrl: item.coverUrl,
          releaseYear: item.releaseYear,
          tracks: null,
          createdAt: new Date(),
          reviews: [],
          stats: {
            averageRating: 0,
            totalRatings: 0,
            totalReviews: 0,
          },
        };
      }

      const ratingsCount = localItem.ratings.length;
      const averageRating = ratingsCount === 0
        ? 0
        : Math.round((localItem.ratings.reduce((sum, rating) => sum + rating.value, 0) / ratingsCount) * 10) / 10;

      let tracks: Track[] | null = null;
      if (localItem.tracks) {
        try {
          tracks = JSON.parse(localItem.tracks);
        } catch (error) {
          console.error("Failed to parse tracks for item: " + localItem.id, error);
        }
      }

      return {
        id: localItem.id,
        title: localItem.title,
        artist: localItem.artist,
        type: localItem.type,
        coverUrl: localItem.coverUrl,
        releaseYear: localItem.releaseYear,
        tracks,
        createdAt: localItem.createdAt,
        reviews: [],
        stats: {
          averageRating,
          totalRatings: ratingsCount,
          totalReviews: localItem._count.reviews,
        },
      };
    });
  },

  async getPopularItems(signal?: AbortSignal) {
    const popularAlbums = await DeezerService.getPopularAlbums(signal);
    if (popularAlbums.length === 0) return [];

    // 2. Query matching local records
    const ids = popularAlbums.map((r) => r.id);
    const localItems = await prisma.musicItem.findMany({
      where: { id: { in: ids } },
      include: {
        ratings: true,
        reviews: {
          include: {
            user: {
              select: {
                username: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    const localItemsMap = new Map(localItems.map((item) => [item.id, item]));

    // 3. Blend Deezer popular items with local stats
    return popularAlbums.map((item) => {
      const localItem = localItemsMap.get(item.id);
      if (localItem) {
        return this._enrichStats(localItem);
      }

      return {
        id: item.id,
        title: item.title,
        artist: item.artist,
        type: "ALBUM",
        coverUrl: item.coverUrl,
        releaseYear: item.releaseYear,
        tracks: null,
        createdAt: new Date(),
        reviews: [],
        stats: {
          averageRating: 0,
          totalRatings: 0,
          totalReviews: 0,
        },
      };
    });
  },

  _enrichStats(item: any): MusicItemWithStats {
    let parsedTracks: Track[] | null = null;
    if (item.tracks) {
      try {
        parsedTracks = JSON.parse(item.tracks);
      } catch (e) {
        console.error("Failed to parse tracks for item: " + item.id, e);
      }
    }

    const ratingsCount = item.ratings.length;
    const reviewsCount = item.reviews.length;

    // Calculate average rating
    let averageRating = 0;
    if (ratingsCount > 0) {
      const sum = item.ratings.reduce((acc: number, r: any) => acc + r.value, 0);
      averageRating = Math.round((sum / ratingsCount) * 10) / 10;
    }

    return {
      id: item.id,
      title: item.title,
      artist: item.artist,
      type: item.type,
      coverUrl: item.coverUrl,
      releaseYear: item.releaseYear,
      tracks: parsedTracks,
      createdAt: item.createdAt,
      reviews: (item.reviews as ReviewWithUser[]).map((review) => ({
        ...review,
        user: withPublicAvatar({ ...review.user, profileImage: review.user.profileImage ?? null }),
      })),
      stats: {
        averageRating,
        totalRatings: ratingsCount,
        totalReviews: reviewsCount,
      },
    };
  },
};
