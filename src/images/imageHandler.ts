/**
 * Image Handler - Detects image tags in AI responses and handles sending
 */

import { getImage, getAvailableImageKeys } from "./imageCatalog";
import { logger } from "../utils/logger";

const IMAGE_TAG_REGEX = /\[IMAGE:(\w+)\]/g;

export interface ExtractedImages {
  cleanText: string;
  images: Array<{
    key: string;
    url: string;
    caption?: string;
  }>;
}

export function extractImages(responseText: string): ExtractedImages {
  const images: ExtractedImages["images"] = [];
  const matches = responseText.matchAll(IMAGE_TAG_REGEX);

  for (const match of matches) {
    const key = match[1];
    const imageInfo = getImage(key);

    if (imageInfo) {
      images.push({
        key,
        url: imageInfo.url,
        caption: imageInfo.caption,
      });
    } else {
      logger.warn("Unknown image key", { key, available: getAvailableImageKeys() });
    }
  }

  const cleanText = responseText
    .replace(IMAGE_TAG_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleanText, images };
}

export function hasImageTags(responseText: string): boolean {
  return IMAGE_TAG_REGEX.test(responseText);
}
