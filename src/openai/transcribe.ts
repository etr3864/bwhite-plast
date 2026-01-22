/**
 * Audio transcription using OpenAI Whisper
 */

import OpenAI from "openai";
import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export async function transcribeAudio(audioUrl: string): Promise<string | null> {
  try {
    const audioResponse = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    const audioBuffer = Buffer.from(audioResponse.data as ArrayBuffer);
    const audioFile = new File([audioBuffer], "audio.ogg", {
      type: audioResponse.headers["content-type"] || "audio/ogg",
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "he",
    });

    const text = transcription.text.trim();

    if (text) {
      return text;
    }

    logger.warn("Transcription returned empty");
    return null;
  } catch (error) {
    logger.error("Transcription failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
