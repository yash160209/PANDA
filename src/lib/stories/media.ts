export const MAX_STORY_IMAGE_SIZE = 10 * 1024 * 1024;
export const MAX_STORY_VIDEO_SIZE = 50 * 1024 * 1024;

export type StoryMediaType = "image" | "video";

type StoryFileMetadata = { name: string; type: string; size: number };

const storyMimeTypes: Record<string, { mediaType: StoryMediaType; extensions: string[] }> = {
  "image/jpeg": { mediaType: "image", extensions: [".jpg", ".jpeg"] },
  "image/png": { mediaType: "image", extensions: [".png"] },
  "image/webp": { mediaType: "image", extensions: [".webp"] },
  "image/avif": { mediaType: "image", extensions: [".avif"] },
  "video/mp4": { mediaType: "video", extensions: [".mp4"] },
  "video/webm": { mediaType: "video", extensions: [".webm"] },
};

export function validateStoryMedia(file: StoryFileMetadata | null) {
  if (!file) return { error: "Choose a photo or video to add to your story." } as const;
  const allowed = storyMimeTypes[file.type];
  if (!allowed || !allowed.extensions.some((extension) => file.name.toLowerCase().endsWith(extension))) {
    return { error: "Choose a supported JPG, PNG, WebP, AVIF, MP4, or WebM file." } as const;
  }
  const maximum = allowed.mediaType === "image" ? MAX_STORY_IMAGE_SIZE : MAX_STORY_VIDEO_SIZE;
  if (file.size <= 0 || file.size > maximum) {
    return {
      error: allowed.mediaType === "image" ? "Photos must be 10 MB or smaller." : "Videos must be 50 MB or smaller.",
    } as const;
  }
  return { mediaType: allowed.mediaType } as const;
}

function isBrand(bytes: Uint8Array, brand: string) {
  return String.fromCharCode(...bytes.slice(8, 12)) === brand;
}

export function matchesStoryFileSignature(type: string, bytes: Uint8Array) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && isBrand(bytes, "WEBP");
  if (type === "image/avif") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && (isBrand(bytes, "avif") || isBrand(bytes, "avis"));
  if (type === "video/mp4") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && bytes.length >= 12;
  if (type === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}
