/**
 * Media Types & Legacy Exports
 * 
 * Media is now fetched dynamically from Cloudinary (miki-clinic folder)
 * Filename = Description for search matching
 */

export interface MediaItem {
  url: string;
  type: "image" | "video";
  caption?: string;
  description: string;
}

// Legacy exports for backward compatibility with [IMAGE:key] system
export type ImageInfo = MediaItem;
export const IMAGE_CATALOG: Record<string, MediaItem> = {};

export function getImage(key: string): MediaItem | null {
  return IMAGE_CATALOG[key] || null;
}

export function getAvailableImageKeys(): string[] {
  return Object.keys(IMAGE_CATALOG);
}

export function getImageDescriptions(): string {
  return "";
}
