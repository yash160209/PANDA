export const MAX_CHAT_MEDIA_BYTES = 50 * 1024 * 1024;
export const CHAT_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
]);
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export function validateChatMedia(file: Pick<File, "type" | "size">): string | null {
  if (!CHAT_MEDIA_TYPES.has(file.type)) {
    return "Choose a JPEG, PNG, WebP, MP4, or WebM file.";
  }
  if (file.size <= 0 || file.size > MAX_CHAT_MEDIA_BYTES) {
    return "Media must be smaller than 50 MB.";
  }
  return null;
}

export function chatMediaKind(mimeType: string): "image" | "video" {
  return mimeType.startsWith("video/") ? "video" : "image";
}

export function validateAvatarMedia(file: Pick<File, "type" | "size">): string | null {
  if (!AVATAR_MEDIA_TYPES.has(file.type)) return "Choose a JPEG, PNG, WebP, or AVIF profile photo.";
  if (file.size <= 0 || file.size > MAX_AVATAR_BYTES) return "Profile photos must be smaller than 5 MB.";
  return null;
}
