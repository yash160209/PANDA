import { z } from "zod";

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

export const postCaptionSchema = z
  .string()
  .trim()
  .min(1, "Write a caption before adding your post.")
  .max(500, "Captions must be 500 characters or fewer.");

export const postCommentSchema = z
  .string()
  .trim()
  .min(1, "Write a comment first.")
  .max(500, "Comments must be 500 characters or fewer.");

export function validatePostMedia(file: { type: string; size: number } | null) {
  if (!file) return "Choose a photo or video to continue.";

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) return "Choose an image or video file.";
  if (isImage && file.size > MAX_IMAGE_SIZE) return "Photos must be 10 MB or smaller.";
  if (isVideo && file.size > MAX_VIDEO_SIZE) return "Videos must be 50 MB or smaller.";

  return null;
}
