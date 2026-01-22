# 🏗️ Architecture Guide - WhatsApp AI Agent

## מבנה הפרויקט

```
src/
├── server.ts              # Entry point - Express server
├── config.ts              # Environment variables & system prompt loading
│
├── wa/                    # WhatsApp Integration Layer
│   ├── webhookHandler.ts  # Webhook entry → processes messages
│   ├── normalize.ts       # Raw WA → NormalizedIncoming
│   ├── decryptMedia.ts    # Media URL decryption
│   └── sendMessage.ts     # Send text/image/video/voice with retry
│
├── buffer/
│   └── bufferManager.ts   # Message batching (8s window per phone)
│
├── conversation/
│   ├── historyManager.ts  # Redis/Memory storage + flush logic + media intent
│   └── buildPrompt.ts     # System + History + Context → OpenAI messages
│
├── services/
│   └── mediaService.ts    # Fuzzy search for media assets
│
├── openai/
│   ├── client.ts          # OpenAI API wrapper (chat completions)
│   ├── transcribe.ts      # Whisper API (voice → text)
│   └── vision.ts          # GPT-4 Vision (image → text)
│
├── db/
│   └── redis.ts           # Redis connection manager
│
├── types/
│   ├── normalized.ts      # NormalizedIncoming, ChatMessage
│   ├── openai.ts          # OpenAIMessage
│   └── whatsapp.ts        # WA Sender webhook types
│
├── prompts/
│   └── system_prompt.txt  # ⭐ הזהות של הסוכן
│
├── images/
│   ├── imageCatalog.ts    # MEDIA_CATALOG + legacy IMAGE_CATALOG
│   └── imageHandler.ts    # [IMAGE:key] tag extraction (legacy)
│
├── voice/                 # Voice reply system (ElevenLabs TTS)
│   ├── voiceReplyHandler.ts
│   ├── voiceDecisionMaker.ts
│   ├── elevenLabs.ts
│   └── ttsNormalizer.ts
│
├── calendar/              # Meeting management (n8n integration)
│   ├── routes.ts
│   ├── meetingStorage.ts
│   └── reminders/
│
├── optout/                # Opt-out detection (AI-powered)
│   ├── optOutDetector.ts
│   └── optOutManager.ts
│
└── utils/
    ├── logger.ts          # Structured JSON logging
    ├── time.ts            # Human-like delays
    ├── timeout.ts         # Promise timeout wrapper
    └── webhookAuth.ts     # HMAC signature verification
```

---

## 🔄 Message Flow (Pipeline)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              INCOMING                                     │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  1. WEBHOOK HANDLER (wa/webhookHandler.ts)                               │
│     - Verify signature                                                    │
│     - Dedupe by message ID                                               │
│     - Ignore fromMe (prevent loop)                                       │
│     - Check opt-out status                                               │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  2. NORMALIZE (wa/normalize.ts)                                          │
│     - Raw WA payload → NormalizedIncoming                                │
│     - Extract: phone, name, type, text, mediaUrl                         │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  3. MEDIA PROCESSING (BEFORE buffer!)                                    │
│     ┌─────────────┬─────────────┬─────────────┐                          │
│     │   Audio     │   Image     │   Other     │                          │
│     │ decryptMedia│ decryptMedia│ decryptMedia│                          │
│     │ transcribe  │ analyzeImage│ (optional)  │                          │
│     │ → text      │ → text      │             │                          │
│     └─────────────┴─────────────┴─────────────┘                          │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  4. BUFFER MANAGER (buffer/bufferManager.ts)                             │
│     - Buffer per phone number                                            │
│     - Timer: 8 seconds (BATCH_WINDOW_MS)                                 │
│     - First message starts timer                                         │
│     - Timer expiry → flushConversation()                                 │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  5. FLUSH CONVERSATION (conversation/historyManager.ts)                  │
│     a) getHistory(phone) → ChatMessage[] from Redis                      │
│     b) buildPromptMessages(history, batch, phone)                        │
│     c) askOpenAI(messages)                                               │
│     d) addToHistory() - save user + assistant messages                   │
│     e) Process [MEDIA: query] → MediaService.findBestMatch() → sendMedia │
│     f) Extract [IMAGE:key] tags (legacy)                                 │
│     g) handleVoiceReply() OR sendTextMessage()                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🖼️ Media System

### Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   AI Response       │     │   MediaService      │     │   sendMedia()       │
│   [MEDIA: query]    │────▶│   findBestMatch()   │────▶│   (WA Sender API)   │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
                                     │
                                     ▼
                            ┌─────────────────────┐
                            │   MEDIA_CATALOG     │
                            │   (imageCatalog.ts) │
                            └─────────────────────┘
```

### Adding Media to Catalog

```typescript
// src/images/imageCatalog.ts

export const MEDIA_CATALOG: MediaItem[] = [
  {
    url: "https://res.cloudinary.com/xxx/image/upload/v123/photo.jpg",
    type: "image",
    caption: "תמונה לפני ואחרי",
    description: "שיניים עקומות יישור לפני אחרי",
  },
  {
    url: "https://res.cloudinary.com/xxx/video/upload/v123/demo.mp4",
    type: "video",
    caption: "סרטון הסבר",
    description: "הדגמה ציפוי חרסינה תהליך",
  },
];
```

### How Search Works (Token Matching)

```typescript
// Query: "שיניים עקומות"
// Tokens: ["שיניים", "עקומות"]

// Item 1: description = "שיניים עקומות יישור לפני אחרי"
//         Score = 2 (both tokens found)

// Item 2: description = "הדגמה ציפוי חרסינה תהליך"
//         Score = 0 (no tokens found)

// Winner: Item 1
```

### System Prompt Integration

```
### VISUAL CAPABILITIES

You have access to a secure media library.
Use this capability when a visual proof will help.

PROTOCOL:
To trigger a media send, output a specific tag on a new line:
[MEDIA: <search_keywords>]

RULES:
1. Do not invent URLs. Use the tag only.
2. Keywords should be descriptive.
3. Only send media if it directly relates to the user's concern.
```

---

## 📝 Data Types

### NormalizedIncoming
```typescript
interface NormalizedIncoming {
  sender: {
    phone: string;      // "972523006544"
    name?: string;      // WhatsApp display name
  };
  message: {
    type: "text" | "image" | "video" | "audio" | "document" | "sticker";
    text?: string;      // Text / transcription / image analysis
    mediaUrl?: string;  // Decrypted public URL
    timestamp: number;  // Unix ms
  };
}
```

### ChatMessage (History)
```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}
```

### MediaItem
```typescript
interface MediaItem {
  url: string;
  type: "image" | "video";
  caption?: string;
  description: string;  // For fuzzy search
}
```

### SendMediaPayload
```typescript
interface SendMediaPayload {
  phone: string;
  url: string;
  type: "image" | "video";
  caption?: string;
}
```

---

## 🧠 Prompt Building (buildPrompt.ts)

**מבנה ה-Prompt שנשלח ל-OpenAI:**

```
┌─────────────────────────────────────────────┐
│ 1. SYSTEM MESSAGE                           │
│    config.systemPrompt (from txt file)      │
├─────────────────────────────────────────────┤
│ 2. HISTORY (last N messages)                │
│    role: user/assistant                     │
│    content: previous messages               │
├─────────────────────────────────────────────┤
│ 3. CURRENT BATCH (user message)             │
│    [שם הלקוח: "X" (מגדר)]                   │
│    + batch messages content                 │
└─────────────────────────────────────────────┘
```

### Extension Point: RAG / Database Context

```typescript
// buildPrompt.ts - buildPromptMessages()

// 1. System message
messages.push({ role: "system", content: config.systemPrompt });

// ══════════════════════════════════════════════════════════════
// 🎯 ADD YOUR CONTEXT HERE - BETWEEN SYSTEM AND HISTORY
// ══════════════════════════════════════════════════════════════
// 
// const ragContext = await searchVectorDB(lastUserMessage);
// if (ragContext) {
//   messages.push({
//     role: "system",
//     content: `[מידע רלוונטי]\n${ragContext}`
//   });
// }
// ══════════════════════════════════════════════════════════════

// 2. Conversation history
// 3. Current batch
```

---

## 💾 Redis Schema

| Key Pattern | Type | TTL | Content |
|-------------|------|-----|---------|
| `chat:{phone}` | JSON Array | 7 days | `ChatMessage[]` |
| `customer:{phone}` | JSON Object | 1 year | `{name, gender, savedAt}` |
| `customer:{phone}.optOut` | JSON Object | 7 days | `{unsubscribed, timestamp, reason}` |
| `meeting:{phone}` | JSON Object | 3 days | Meeting data + reminder flags |

---

## 📤 Sending Messages

### Text
```typescript
import { sendTextMessage } from "./wa/sendMessage";
await sendTextMessage(phone, "הודעה");
```

### Media (Image/Video) - NEW
```typescript
import { sendMedia } from "./wa/sendMessage";
await sendMedia({
  phone: "972523006544",
  url: "https://cloudinary.com/...",
  type: "image",  // or "video"
  caption: "תמונה לפני ואחרי",
});
```

### Legacy Image (by key)
```typescript
import { sendImageMessage } from "./wa/sendMessage";
await sendImageMessage(phone, "image_key", "caption");
```

### Voice (TTS)
```typescript
import { sendVoiceMessage } from "./wa/sendMessage";
await sendVoiceMessage(phone, audioBuffer);
```

---

## ⚙️ Configuration (config.ts)

```bash
# Server
PORT=3000

# WhatsApp (WA Sender)
WA_SENDER_BASE_URL=https://wasenderapi.com/api
WA_SENDER_API_KEY=xxx
WA_SENDER_WEBHOOK_SECRET=xxx

# OpenAI
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_MAX_TOKENS=1000
OPENAI_TEMPERATURE=0.7

# Redis
REDIS_ENABLED=true
REDIS_HOST=xxx
REDIS_PORT=6379
REDIS_PASSWORD=xxx
REDIS_TTL_DAYS=7

# Conversation
MAX_HISTORY_MESSAGES=40
BATCH_WINDOW_MS=8000
MIN_RESPONSE_DELAY_MS=1500
MAX_RESPONSE_DELAY_MS=3000

# Voice (optional)
VOICE_REPLIES=off
ELEVENLABS_API_KEY=xxx
ELEVENLABS_VOICE_ID=xxx
```

---

## 🧪 Testing Media System

### 1. Add Test Media to Catalog

```typescript
// src/images/imageCatalog.ts
export const MEDIA_CATALOG: MediaItem[] = [
  {
    url: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
    type: "image",
    caption: "תמונת בדיקה",
    description: "בדיקה טסט test demo",
  },
];
```

### 2. Update System Prompt

Make sure `system_prompt.txt` includes the VISUAL CAPABILITIES section.

### 3. Test Flow

Send a message that triggers the AI to use `[MEDIA: בדיקה]`.

### Expected Logs

```
🔍 AI Intent: Search Media { query: "בדיקה" }
🖼️ Media sent via intent { query: "בדיקה", type: "image" }
💬 Reply: "הנה התמונה..."
```

---

## 📊 Logging

Key log patterns:
- `📩` - Incoming message
- `⏳` - Buffer timer started
- `🤖` - AI processing
- `🔍` - Media search intent
- `🖼️` - Media/Image sent
- `💬` - Text reply sent
- `🎤` - Voice reply sent
- `❌` - Error
- `⚠️` - Warning (e.g., no media match)

---

## 🚀 Production Notes

1. **Rate Limiting**: Built-in retry with exponential backoff for 429 errors
2. **Timeouts**: 30s for media, 120s for OpenAI
3. **Memory**: Buffers are in-memory only, history is in Redis
4. **Deduplication**: Message IDs cached for 60 seconds
5. **Graceful Shutdown**: SIGTERM/SIGINT handlers close Redis cleanly
6. **Media Fail-Safe**: If no media match found, logs warning and continues with text

