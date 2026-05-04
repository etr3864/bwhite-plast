/**
 * Normalized message types - unified format for all incoming messages
 */

export type MessageType = "text" | "image" | "video" | "audio" | "document" | "sticker";

export interface NormalizedSender {
  phone: string;
  name?: string;
}

export interface NormalizedMessage {
  type: MessageType;
  text?: string; // Text content or caption
  mediaUrl?: string; // Public URL after decryption
  timestamp: number; // Unix timestamp
}

export interface NormalizedIncoming {
  sessionId: string;
  sender: NormalizedSender;
  message: NormalizedMessage;
  rawPayload?: unknown;
}

/**
 * Chat message format for conversation history
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}
