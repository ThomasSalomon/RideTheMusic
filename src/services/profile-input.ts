import {
  isJsonObject,
  rejectUnknownFields,
  RequestBodyError,
  type JsonObject,
} from "@/utils/request-body";

export const PROFILE_COLORS = ["emerald", "violet", "cobalt", "amber", "rose", "slate"] as const;
export const MAX_PROFILE_BIO_LENGTH = 500;
export const MAX_FAVORITE_GENRE_LENGTH = 50;
// Presets and legacy upload paths are short; data URLs have their own limit in services/avatar.
const MAX_PROFILE_IMAGE_PATH_LENGTH = 300;
export const MAX_FAVORITE_ALBUM_SLOTS = 3;
const MAX_MUSIC_ITEM_ID_LENGTH = 200;

export type FavoriteAlbumInput = { slot: number; musicItemId: string | null };
export type ProfileUpdateInput = {
  bio?: string;
  favoriteGenre?: string;
  profileColor?: (typeof PROFILE_COLORS)[number];
  profileImage?: string;
  favoriteAlbums?: FavoriteAlbumInput[];
};

function invalid(message: string): never {
  throw new RequestBodyError(message);
}

function optionalText(body: JsonObject, field: "bio" | "favoriteGenre" | "profileImage"): string | undefined {
  if (!Object.hasOwn(body, field)) return undefined;
  if (typeof body[field] !== "string") invalid(`${field} debe ser texto`);
  return body[field];
}

function parseFavoriteAlbums(value: unknown): FavoriteAlbumInput[] {
  if (!Array.isArray(value) || value.length > MAX_FAVORITE_ALBUM_SLOTS) {
    invalid(`favoriteAlbums debe ser un array de hasta ${MAX_FAVORITE_ALBUM_SLOTS} posiciones`);
  }

  const slots = new Set<number>();
  return value.map((entry, index) => {
    if (!isJsonObject(entry)) invalid(`favoriteAlbums[${index}] debe ser un objeto`);
    rejectUnknownFields(entry, ["slot", "musicItemId"]);
    const slot = entry.slot;
    if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 1 || slot > MAX_FAVORITE_ALBUM_SLOTS) {
      invalid(`favoriteAlbums[${index}].slot debe estar entre 1 y ${MAX_FAVORITE_ALBUM_SLOTS}`);
    }
    if (slots.has(slot)) invalid("favoriteAlbums no puede repetir slots");
    slots.add(slot);
    if (entry.musicItemId !== null && (
      typeof entry.musicItemId !== "string" ||
      entry.musicItemId.trim().length === 0 ||
      entry.musicItemId.length > MAX_MUSIC_ITEM_ID_LENGTH
    )) {
      invalid(`favoriteAlbums[${index}].musicItemId debe ser un identificador válido o null`);
    }
    return {
      slot,
      musicItemId: entry.musicItemId === null ? null : entry.musicItemId.trim(),
    };
  });
}

export function parseProfileUpdate(value: unknown): ProfileUpdateInput {
  if (!isJsonObject(value)) invalid("El cuerpo debe ser un objeto JSON");
  rejectUnknownFields(value, ["bio", "favoriteGenre", "profileColor", "profileImage", "favoriteAlbums"]);

  const bio = optionalText(value, "bio");
  if (bio !== undefined && bio.length > MAX_PROFILE_BIO_LENGTH) {
    invalid(`La biografía no puede superar los ${MAX_PROFILE_BIO_LENGTH} caracteres`);
  }
  const favoriteGenre = optionalText(value, "favoriteGenre");
  if (favoriteGenre !== undefined && favoriteGenre.length > MAX_FAVORITE_GENRE_LENGTH) {
    invalid(`El género favorito no puede superar los ${MAX_FAVORITE_GENRE_LENGTH} caracteres`);
  }
  const profileImage = optionalText(value, "profileImage");
  if (profileImage !== undefined && !profileImage.startsWith("data:") && profileImage.length > MAX_PROFILE_IMAGE_PATH_LENGTH) {
    invalid("Avatar inválido. Seleccione un preset o cargue una foto.");
  }
  let profileColor: ProfileUpdateInput["profileColor"];
  if (Object.hasOwn(value, "profileColor")) {
    const candidate = value.profileColor;
    if (typeof candidate !== "string" || !PROFILE_COLORS.includes(candidate as (typeof PROFILE_COLORS)[number])) {
      invalid("Color de perfil no permitido");
    }
    profileColor = candidate as (typeof PROFILE_COLORS)[number];
  }
  const favoriteAlbums = Object.hasOwn(value, "favoriteAlbums")
    ? parseFavoriteAlbums(value.favoriteAlbums)
    : undefined;

  if ([bio, favoriteGenre, profileColor, profileImage, favoriteAlbums].every((field) => field === undefined)) {
    invalid("No se enviaron campos editables");
  }
  return { bio, favoriteGenre, profileColor, profileImage, favoriteAlbums };
}
