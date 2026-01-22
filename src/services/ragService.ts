/**
 * RAG Service - Semantic search over knowledge base
 */

import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { config } from "../config";
import { logger } from "../utils/logger";

interface KnowledgeItem {
  content: string;
  embedding: number[];
}

let knowledgeBase: KnowledgeItem[] | null = null;
let openaiClient: OpenAI | null = null;

const KNOWLEDGE_PATH = path.join(__dirname, "../data/knowledge.json");
const TOP_K = 3;
const MIN_SIMILARITY = 0.3;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

function loadKnowledge(): KnowledgeItem[] {
  if (knowledgeBase) return knowledgeBase;

  try {
    if (!fs.existsSync(KNOWLEDGE_PATH)) {
      logger.warn("knowledge.json not found - RAG disabled");
      knowledgeBase = [];
      return knowledgeBase;
    }

    const data = fs.readFileSync(KNOWLEDGE_PATH, "utf-8");
    knowledgeBase = JSON.parse(data);
    logger.info("RAG loaded", { chunks: knowledgeBase!.length });
    return knowledgeBase!;
  } catch (error) {
    logger.error("Failed to load knowledge base", {
      error: error instanceof Error ? error.message : String(error),
    });
    knowledgeBase = [];
    return knowledgeBase;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

async function createEmbedding(text: string): Promise<number[]> {
  const openai = getOpenAI();
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export async function searchKnowledge(query: string): Promise<string[]> {
  const knowledge = loadKnowledge();

  if (knowledge.length === 0) {
    return [];
  }

  try {
    const queryEmbedding = await createEmbedding(query);

    const scored = knowledge.map((item) => ({
      content: item.content,
      score: cosineSimilarity(queryEmbedding, item.embedding),
    }));

    const relevant = scored
      .filter((item) => item.score >= MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    return relevant.map((item) => item.content);
  } catch (error) {
    logger.error("RAG search failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function formatRagContext(chunks: string[]): string {
  if (chunks.length === 0) return "";

  return `
---

### מידע רלוונטי מהמאגר

${chunks.map((chunk, i) => `**[${i + 1}]** ${chunk}`).join("\n\n")}

---`;
}

export function preloadKnowledge(): void {
  loadKnowledge();
}
