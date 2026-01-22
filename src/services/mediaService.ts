/**
 * Media Service - Fuzzy search for media assets from Cloudinary
 */

import { MediaItem } from "../images/imageCatalog";
import { fetchMediaFromCloudinary } from "./cloudinaryMedia";
import { logger } from "../utils/logger";

export class MediaService {
  static async findBestMatch(query: string): Promise<MediaItem | null> {
    if (!query) return null;

    const catalog = await fetchMediaFromCloudinary();
    
    if (catalog.length === 0) {
      return null;
    }

    const queryTokens = query
      .toLowerCase()
      .replace(/[-_.,]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 2);
    
    let bestMatch: MediaItem | null = null;
    let maxScore = 0;

    for (const item of catalog) {
      const description = item.description
        .toLowerCase()
        .replace(/[-_.,]/g, " ");
      
      let score = 0;

      for (const token of queryTokens) {
        if (description.includes(token)) {
          score += 2;
        } else if (token.length >= 3) {
          const root = token.slice(0, -1);
          if (description.includes(root)) {
            score += 1;
          }
        }
      }

      if (score > maxScore) {
        maxScore = score;
        bestMatch = item;
      }
    }

    if (!bestMatch) {
      logger.warn("Media not found", { query });
    }

    return bestMatch;
  }
}
