/**
 * Cloudinary Media Service
 * Fetches media assets from Cloudinary Asset Folder
 */

import { v2 as cloudinary } from "cloudinary";
import { config } from "../config";
import { logger } from "../utils/logger";
import { MediaItem } from "../images/imageCatalog";

const MEDIA_FOLDER = "miki-clinic";

let mediaCache: MediaItem[] = [];
let lastFetch = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

export async function fetchMediaFromCloudinary(): Promise<MediaItem[]> {
  if (mediaCache.length > 0 && Date.now() - lastFetch < CACHE_TTL_MS) {
    return mediaCache;
  }

  try {
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey) {
      return [];
    }

    const items: MediaItem[] = [];

    const result = await cloudinary.api.resources_by_asset_folder(MEDIA_FOLDER, {
      max_results: 500,
      context: true,
      tags: true,
    });

    for (const resource of result.resources) {
      const type = resource.resource_type === "video" ? "video" : "image";
      
      const context = (resource.context as Record<string, Record<string, string>> | undefined)?.custom || {};
      const description = context.alt || context.caption || context.description || extractDescription(resource.public_id);
      const tags = (resource.tags || []).join(" ");
      const searchText = `${description} ${tags}`.trim();
      
      const url = type === "video" 
        ? optimizeVideoUrl(resource.secure_url)
        : resource.secure_url;
      
      items.push({ url, type, description: searchText });
    }

    mediaCache = items;
    lastFetch = Date.now();

    logger.info("Media catalog loaded", { count: items.length, folder: MEDIA_FOLDER });

    return items;
  } catch (error) {
    logger.error("Failed to fetch media from Cloudinary", {
      error: error instanceof Error ? error.message : String(error),
    });
    return mediaCache;
  }
}

function extractDescription(publicId: string): string {
  return publicId
    .replace(/_[a-z0-9]{6}$/i, "")
    .replace(/[-_.]/g, " ")
    .trim();
}

function optimizeVideoUrl(url: string): string {
  return url.replace("/upload/", "/upload/q_auto,f_auto,w_1280,vc_h264/");
}

export async function refreshMediaCache(): Promise<void> {
  lastFetch = 0;
  await fetchMediaFromCloudinary();
}

export function getMediaCache(): MediaItem[] {
  return mediaCache;
}
