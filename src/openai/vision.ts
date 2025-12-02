/**
 * Image analysis using OpenAI GPT-4 Vision
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// Load vision prompt
const visionPromptPath = path.join(__dirname, "../prompts", "vision_prompt.txt");
const visionPrompt = fs.readFileSync(visionPromptPath, "utf8");

/**
 * Download image and convert to base64
 */
async function downloadImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 10000, // 10 second timeout
    });

    const base64 = Buffer.from(response.data, "binary").toString("base64");
    const mimeType = response.headers["content-type"] || "image/jpeg";

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    logger.error("Failed to download image", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Analyze image using GPT-4 Vision
 * @param imageUrl Public URL of the image
 * @param caption Optional caption/text sent with the image
 * @returns Analysis/description of the image
 */
export async function analyzeImage(
  imageUrl: string,
  caption?: string
): Promise<string | null> {
  try {
    logger.info("🖼️  Analyzing image...");

    // Download image and convert to base64
    const base64Image = await downloadImageAsBase64(imageUrl);

    if (!base64Image) {
      logger.error("❌ Failed to download image");
      return null;
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: caption
              ? `${visionPrompt}\n\nהלקוח כתב: "${caption}"`
              : visionPrompt,
          },
          {
            type: "image_url",
            image_url: {
              url: base64Image, // Use base64 data URI instead of direct URL
            },
          },
        ],
      },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o", // GPT-4 Vision model
      messages,
      max_completion_tokens: 500,
    });

    const analysis = response.choices[0]?.message?.content;

    if (!analysis) {
      logger.warn("⚠️  Vision API returned empty analysis");
      return null;
    }

    logger.info(`📸 Analysis: "${analysis.substring(0, 100)}..."`);
    return analysis;
  } catch (error) {
    logger.error("❌ Image analysis failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

