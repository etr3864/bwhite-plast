/**
 * Cloudinary Media Service
 * Fetches and retrieves media assets from Cloudinary
 */

import { v2 as cloudinary } from "cloudinary";
import { config } from "../config";
import { logger } from "../utils/logger";
import { MediaItem } from "../images/imageCatalog";

const MEDIA_FOLDER = "miki-clinic";
const CACHE_TTL_MS = 5 * 60 * 1000;
const UNSUPPORTED_FORMATS = ["pdf", "psd", "ai", "eps", "svg"];

let mediaCache: MediaItem[] = [];
let lastFetch = 0;

cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

export async function fetchMediaFromCloudinary(): Promise<MediaItem[]> {
  if (mediaCache.length > 0 && Date.now() - lastFetch < CACHE_TTL_MS) {
    return mediaCache;
  }

  if (!config.cloudinaryCloudName || !config.cloudinaryApiKey) {
    return [];
  }

  try {
    const result = await cloudinary.api.resources_by_asset_folder(MEDIA_FOLDER, {
      max_results: 500,
      context: true,
      tags: true,
    });

    const items: MediaItem[] = [];

    for (const resource of result.resources) {
      const resourceType = resource.resource_type as string;
      const format = (resource.format as string || "").toLowerCase();

      if (resourceType === "raw" || UNSUPPORTED_FORMATS.includes(format)) {
        continue;
      }

      const type = resourceType === "video" ? "video" : "image";
      const context = (resource.context as Record<string, Record<string, string>> | undefined)?.custom || {};
      const description = context.alt || context.caption || context.description || extractDescription(resource.public_id as string);

      const url = type === "video"
        ? optimizeVideoUrl(resource.secure_url as string)
        : resource.secure_url as string;

      items.push({ url, type, description } as MediaItem);
    }

    mediaCache = items;
    lastFetch = Date.now();
    logger.info("Media catalog loaded", { count: items.length });

    return items;
  } catch (error) {
    logger.error("Failed to fetch media from Cloudinary", {
      error: error instanceof Error ? error.message : String(error),
    });
    return mediaCache;
  }
}

export async function getMediaById(id: number): Promise<MediaItem | null> {
  const catalog = await fetchMediaFromCloudinary();
  const index = id - 1;

  if (index < 0 || index >= catalog.length) {
    logger.warn("Invalid media ID", { id, catalogSize: catalog.length });
    return null;
  }

  return catalog[index];
}

export async function getMediaCatalogForPrompt(): Promise<string> {
  const catalog = await fetchMediaFromCloudinary();

  if (catalog.length === 0) {
    return "";
  }

  return catalog
    .map((item, index) => {
      const typeLabel = item.type === "video" ? "[סרטון]" : "[תמונה]";
      const desc = item.description.replace(/\s+/g, " ").trim();
      return `${index + 1}. ${typeLabel} ${desc}`;
    })
    .join("\n");
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
