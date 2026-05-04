/**
 * Voice Reply System - Type Definitions
 */

export interface VoiceReplyDecision {
  shouldUseVoice: boolean;
  reason: "incoming_voice" | "random_intelligent" | "none";
}

export interface TTSResult {
  audioBuffer: Buffer;
  originalText: string;
  normalizedText: string;
  durationMs?: number;
}

export interface VoiceReplyContext {
  phone: string;
  responseText: string;
  incomingMessageType: string;
  conversationHistory: Array<{ role: string; content: string }>;
  sessionId: string;
}

export interface ElevenLabsResponse {
  audio: Buffer;
  metadata?: {
    characters: number;
    request_id: string;
  };
}

