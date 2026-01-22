/**
 * Cloudinary Audio Upload
 */

import { v2 as cloudinary } from "cloudinary";
import { config } from "../config";
import { logger } from "../utils/logger";

cloudinary.config({
  cloud_name: config.cloudinaryCloudName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});

export async function uploadAudioToCloudinary(audioBuffer: Buffer): Promise<string> {
  try {
    if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
      throw new Error("Cloudinary credentials not configured");
    }

    const base64Audio = audioBuffer.toString("base64");
    const dataUri = `data:audio/mpeg;base64,${base64Audio}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: "raw",
      folder: "whatsapp_voice",
      public_id: `voice_${Date.now()}.mp3`,
      overwrite: true,
      type: "upload",
      access_mode: "public",
      invalidate: true,
    });

    return result.secure_url;
  } catch (error) {
    logger.error("Cloudinary upload failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    throw new Error("Failed to upload audio to Cloudinary");
  }
}

export async function deleteAudioFromCloudinary(publicUrl: string): Promise<void> {
  try {
    const urlParts = publicUrl.split("/");
    const fileName = urlParts[urlParts.length - 1];
    const folder = urlParts[urlParts.length - 2];
    const publicId = `${folder}/${fileName}`;

    await cloudinary.uploader.destroy(publicId, {
      resource_type: "raw",
    });
  } catch (error) {
    logger.warn("Failed to delete audio from Cloudinary", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
