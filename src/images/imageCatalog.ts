/**
 * Media Types
 */

export interface MediaItem {
  url: string;
  type: "image" | "video";
  description: string;
  caption?: string;
}
