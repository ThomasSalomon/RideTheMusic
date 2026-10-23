import { createHash } from "node:crypto";

/**
 * Uploaded avatars are stored inline as data URLs. API responses never embed
 * them: they carry a short, versioned URL to the avatar route instead, so a
 * listing costs the same whether its users uploaded photos or not.
 */

// The editor always crops to a 400x400 JPEG, which stays well under this.
export const MAX_UPLOADED_AVATAR_LENGTH = 300_000;

export const ALLOWED_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const DATA_URL_PATTERN = /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/;

export function parseAvatarDataUrl(value: string): { mime: string; base64: string } | null {
  const match = value.match(DATA_URL_PATTERN);
  return match ? { mime: match[1], base64: match[2] } : null;
}

export function avatarPath(username: string): string {
  return `/api/users/${encodeURIComponent(username)}/avatar`;
}

export function avatarVersion(dataUrl: string): string {
  return createHash("sha256").update(dataUrl).digest("base64url").slice(0, 16);
}

/** True for a URL produced by publicProfileImage for this user's current or an earlier upload. */
export function isOwnAvatarUrl(username: string, value: string): boolean {
  const path = avatarPath(username);
  return value === path || value.startsWith(`${path}?`);
}

export function publicProfileImage(username: string, profileImage: string | null): string | null {
  if (!profileImage?.startsWith("data:")) return profileImage;
  return `${avatarPath(username)}?v=${avatarVersion(profileImage)}`;
}

export function withPublicAvatar<T extends { username: string; profileImage: string | null }>(user: T): T {
  return { ...user, profileImage: publicProfileImage(user.username, user.profileImage) };
}
