/**
 * Build prompt messages for OpenAI
 */

import { ChatMessage, NormalizedIncoming } from "../types/normalized";
import { OpenAIMessage } from "../types/openai";
import { config } from "../config";
import { askOpenAI } from "../openai/client";
import { saveCustomerInfo, getCustomerInfo } from "./historyManager";
import { fetchMediaFromCloudinary } from "../services/cloudinaryMedia";
import { searchKnowledge, formatRagContext } from "../services/ragService";

export async function buildPromptMessages(
  history: ChatMessage[],
  batchMessages: NormalizedIncoming[],
  phone: string
): Promise<OpenAIMessage[]> {
  const messages: OpenAIMessage[] = [];

  // Extract user query for RAG search
  const userQuery = extractUserQuery(batchMessages);

  // Build system message with media catalog
  const mediaCatalog = await buildMediaCatalogSection();
  const systemContent = config.systemPrompt + mediaCatalog;

  messages.push({
    role: "system",
    content: systemContent,
  });

  // RAG: Search for relevant knowledge (runs in parallel conceptually)
  const ragContext = await buildRagContext(userQuery);
  if (ragContext) {
    messages.push({
      role: "system",
      content: ragContext,
    });
  }

  // Conversation history
  for (const msg of history) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // Customer info
  const customerInfo = await getOrCreateCustomerInfo(phone, history, batchMessages);

  // Current batch
  const batchContent = formatBatch(batchMessages, customerInfo);
  messages.push({ role: "user", content: batchContent });

  return messages;
}

/**
 * Extract user text query from batch messages for RAG
 */
function extractUserQuery(batchMessages: NormalizedIncoming[]): string {
  return batchMessages
    .map((msg) => msg.message.text || "")
    .filter(Boolean)
    .join(" ");
}

/**
 * Build RAG context from knowledge base
 */
async function buildRagContext(query: string): Promise<string | null> {
  if (!query.trim()) return null;

  const chunks = await searchKnowledge(query);
  if (chunks.length === 0) return null;

  return formatRagContext(chunks);
}

async function buildMediaCatalogSection(): Promise<string> {
  const media = await fetchMediaFromCloudinary();
  
  if (media.length === 0) return "";

  const catalogItems = media.map((item, i) => {
    // Clean up description for display
    const cleanDesc = item.description
      .replace(/[-_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `${i + 1}. ${cleanDesc}`;
  }).join("\n");

  return `

---

### ספריית התמונות הזמינה

להלן רשימת התמונות שברשותך. **השתמש בפרטים האלה** כדי לדעת מה לשלוח ומה לכתוב:

${catalogItems}

**חשוב:** כשמבקשים תמונה, חפש לפי מילות מפתח מהתיאור (שם מפורסם, סוג טיפול).
`;
}

interface CustomerInfo {
  name: string | null;
  gender: string | null;
}

async function getOrCreateCustomerInfo(
  phone: string,
  history: ChatMessage[],
  batchMessages: NormalizedIncoming[]
): Promise<CustomerInfo> {
  const existing = await getCustomerInfo(phone);
  
  if (existing) {
    return existing;
  }

  const isFirstMessage = history.length === 0;
  if (isFirstMessage && batchMessages.length > 0) {
    const originalName = extractFirstName(batchMessages[0].sender.name);
    if (originalName) {
      const result = await translateNameAndDetectGender(originalName);
      await saveCustomerInfo(phone, result.name, result.gender);
      return result;
    }
  }

  return { name: null, gender: null };
}

function formatBatch(
  batchMessages: NormalizedIncoming[],
  customerInfo: CustomerInfo
): string {
  const namePrefix = customerInfo.name
    ? `[שם הלקוח: "${customerInfo.name}"${getGenderInstruction(customerInfo.gender)}]\n\n`
    : "";

  if (batchMessages.length === 1) {
    return namePrefix + formatSingleMessage(batchMessages[0]);
  }

  const combined = batchMessages
    .map((msg, i) => `הודעה ${i + 1}:\n${formatSingleMessage(msg)}`)
    .join("\n\n");

  return `${namePrefix}הלקוח שלח מספר הודעות ברצף:\n\n${combined}`;
}

function formatSingleMessage(msg: NormalizedIncoming): string {
  let content = msg.message.text || "";
  if (msg.message.mediaUrl) {
    const label = getMediaTypeLabel(msg.message.type);
    content += `\n\n[${label}: ${msg.message.mediaUrl}]`;
  }
  return content.trim();
}

function getMediaTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    image: "תמונה",
    video: "וידאו",
    audio: "הודעה קולית",
    document: "מסמך",
    sticker: "סטיקר",
  };
  return labels[type] || "מדיה";
}

function extractFirstName(fullName?: string): string | null {
  if (!fullName?.trim()) return null;
  return fullName.trim().split(/\s+/)[0] || null;
}

function getGenderInstruction(gender: string | null): string {
  if (!gender || gender === "לא_ברור") return "";
  if (gender === "זכר") return " (זכר)";
  if (gender === "נקבה") return " (נקבה)";
  return "";
}

async function translateNameAndDetectGender(
  name: string
): Promise<{ name: string; gender: string }> {
  const isHebrew = /[\u0590-\u05FF]/.test(name);

  if (isHebrew) {
    try {
      const response = await askOpenAI([
        { role: "system", content: "זהה מגדר לפי שם. השב: זכר, נקבה, או לא_ברור" },
        { role: "user", content: name },
      ]);
      return { name, gender: response?.trim() || "לא_ברור" };
    } catch {
      return { name, gender: "לא_ברור" };
    }
  }

  try {
    const response = await askOpenAI([
      { role: "system", content: "תרגם שם לעברית וזהה מגדר. פורמט: שם|מגדר" },
      { role: "user", content: name },
    ]);
    const [translated, gender] = (response?.trim() || `${name}|לא_ברור`).split("|");
    return {
      name: translated?.trim() || name,
      gender: gender?.trim() || "לא_ברור",
    };
  } catch {
    return { name, gender: "לא_ברור" };
  }
}

