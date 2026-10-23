import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/services/db";
import { MusicService } from "@/services/music";
import type { ProfileUpdateInput } from "@/services/profile-input";
import { AppError } from "@/utils/errors";
import {
  ALLOWED_AVATAR_MIMES,
  isOwnAvatarUrl,
  MAX_UPLOADED_AVATAR_LENGTH,
  parseAvatarDataUrl,
  withPublicAvatar,
} from "@/services/avatar";

function validateProfileImage(username: string, profileImage: string | undefined): string | undefined {
  if (profileImage === undefined || profileImage === "") return profileImage;

  // The editor echoes back the public URL of the photo it was opened with.
  if (isOwnAvatarUrl(username, profileImage)) return undefined;

  if (profileImage.startsWith("data:image/")) {
    const avatar = parseAvatarDataUrl(profileImage);
    if (!avatar) {
      throw new AppError(
        "Formato de imagen base64 inválido.",
        400,
        "INVALID_PROFILE_IMAGE",
      );
    }
    if (!ALLOWED_AVATAR_MIMES.has(avatar.mime)) {
      throw new AppError(
        "Tipo de archivo no permitido. Solo se permiten imágenes (PNG, JPEG, WEBP, GIF).",
        400,
        "PROFILE_IMAGE_TYPE_NOT_ALLOWED",
      );
    }
    if (profileImage.length > MAX_UPLOADED_AVATAR_LENGTH) {
      throw new AppError(
        "La imagen recortada supera el tamaño permitido.",
        400,
        "PROFILE_IMAGE_TOO_LARGE",
      );
    }
    return profileImage;
  }

  if (
    !profileImage.startsWith("/avatars/") &&
    !profileImage.startsWith("/uploads/")
  ) {
    throw new AppError(
      "Avatar inválido. Seleccione un preset o cargue una foto.",
      400,
      "INVALID_PROFILE_IMAGE",
    );
  }

  return profileImage;
}

export async function updateProfile(
  actor: { userId: string },
  username: string,
  input: ProfileUpdateInput,
  client: PrismaClient = prisma,
) {
  const profileImage = validateProfileImage(username, input.profileImage);
  const requestedAlbums = await Promise.all(
    (input.favoriteAlbums ?? [])
      .filter((item) => item.musicItemId !== null)
      .map((item) => MusicService.getItemById(item.musicItemId!)),
  );
  if (requestedAlbums.some((item) => !item || item.type !== "ALBUM")) {
    throw new AppError(
      "Álbum no encontrado en el catálogo",
      404,
      "FAVORITE_ALBUM_NOT_FOUND",
    );
  }

  if (input.favoriteAlbums) {
    for (const { slot, musicItemId } of input.favoriteAlbums) {
      if (musicItemId === null) {
        await client.favoriteAlbum.deleteMany({
          where: { userId: actor.userId, slot },
        });
      } else {
        await client.favoriteAlbum.upsert({
          where: { userId_slot: { userId: actor.userId, slot } },
          update: { musicItemId },
          create: { userId: actor.userId, slot, musicItemId },
        });
      }
    }
  }

  const updated = await client.user.update({
    where: { username },
    data: {
      bio: input.bio,
      favoriteGenre: input.favoriteGenre,
      profileColor: input.profileColor,
      profileImage: profileImage === undefined
        ? undefined
        : profileImage.trim() === ""
          ? null
          : profileImage,
    },
    select: {
      username: true,
      bio: true,
      favoriteGenre: true,
      profileColor: true,
      profileImage: true,
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
  return withPublicAvatar(updated);
}
