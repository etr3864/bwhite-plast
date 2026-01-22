import fs from 'fs';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';

// טעינת משתני סביבה מהקובץ .env הראשי
dotenv.config();

// הגדרת נתיבים
const SOURCE_FILE = path.join(__dirname, 'knowledge_source.txt');
// שומרים את ה-JSON בתיקיית src/data
const OUTPUT_DIR = path.join(__dirname, '../src/data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'knowledge.json');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function buildKnowledge() {
  console.log("🧠 מתחיל לבנות את המוח (RAG)...");

  // 1. בדיקה שקובץ המקור קיים
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`❌ שגיאה: לא מצאתי את הקובץ: ${SOURCE_FILE}`);
    console.error(`   נא לוודא שיצרת את scripts/knowledge_source.txt והדבקת בו את המידע.`);
    return;
  }
  
  const rawText = fs.readFileSync(SOURCE_FILE, 'utf-8');

  // 2. חיתוך לפי המפריד "---"
  const chunks = rawText.split('---')
    .map(c => c.trim())
    .filter(c => c.length > 10); // מסנן חתיכות ריקות או קצרות מדי

  console.log(`📊 נמצאו ${chunks.length} נושאי מידע בקובץ המקור.`);

  if (chunks.length === 0) {
    console.error("⚠️ לא נמצאו נושאים! וודא שהפרדת את המידע עם '---' (שלושה מקפים)");
    return;
  }

  const vectorStore: any[] = [];

  // 3. שליחה ל-OpenAI והמרה לוקטורים
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // מדפיס התקדמות בשורה אחת
    process.stdout.write(`⚡ מעבד נושא ${i + 1}/${chunks.length}...\r`);

    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk,
      });

      vectorStore.push({
        content: chunk,
        embedding: response.data[0].embedding
      });
    } catch (e) {
      console.error(`\n❌ שגיאה בעיבוד חלק מס' ${i}:`, e);
    }
  }

  // 4. יצירת התיקייה ושמירת הקובץ
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(vectorStore, null, 2));
  console.log(`\n✅ בוצע! המוח נשמר בהצלחה ב: src/data/knowledge.json`);
}

buildKnowledge();