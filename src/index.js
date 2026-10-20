import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import { GoogleGenAI } from "@google/genai";
import { fal } from "@fal-ai/client";
import { createServer } from "node:http";

const required = ["TELEGRAM_BOT_TOKEN", "GEMINI_API_KEY", "FAL_KEY"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
fal.config({ credentials: process.env.FAL_KEY });

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const IMAGE_MODEL = process.env.FAL_IMAGE_TO_VIDEO_MODEL || "fal-ai/ovi/image-to-video";
const TEXT_MODEL = process.env.FAL_TEXT_TO_VIDEO_MODEL || "fal-ai/ovi";

// Temporary per-user state. This is intentionally simple for the MVP;
// a database will replace it before production.
const userState = new Map();

const mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback("📸 Video dari Foto Produk", "menu_photo")],
  [Markup.button.callback("✍️ Video dari Prompt Teks", "menu_text")],
  [Markup.button.callback("💡 Tips Konten Affiliate", "menu_tips")]
]);

bot.start(async (ctx) => {
  userState.delete(ctx.from.id);
  await ctx.reply(
    "🔥 *COMBO AI AFFILIATE BOT — MVP*\\n\\n" +
    "Bikin konsep video affiliate dari foto produk atau prompt teks.\\n\\n" +
    "📸 *Video dari Foto:* kirim foto produk, AI akan memberi 5 konsep.\\n" +
    "✍️ *Video dari Prompt:* tulis ide video, lalu AI akan membuat video.\\n\\n" +
    "Catatan: proses generate menggunakan API berbayar. Prototype ini belum memakai sistem kredit/pembayaran.",
    { parse_mode: "Markdown", ...mainMenu }
  );
});

bot.command("cancel", async (ctx) => {
  userState.delete(ctx.from.id);
  await ctx.reply("Oke, proses dibatalkan. Ketik /start untuk membuka menu.");
});

bot.command("textvideo", async (ctx) => {
  userState.set(ctx.from.id, { mode: "waiting_text_prompt" });
  await ctx.reply(
    "Kirim prompt video yang kamu mau dalam satu pesan.\\n\\n" +
    "Contoh: Cinematic product ad for a minimalist black water bottle, slow camera orbit, studio lighting, premium commercial style. No text or logos added."
  );
});

bot.action("menu_photo", async (ctx) => {
  await ctx.answerCbQuery();
  userState.set(ctx.from.id, { mode: "waiting_photo" });
  await ctx.reply("Kirim *foto produk* yang jelas ya. Setelah dianalisis, aku akan kasih 5 konsep video yang cocok.", { parse_mode: "Markdown" });
});

bot.action("menu_text", async (ctx) => {
  await ctx.answerCbQuery();
  userState.set(ctx.from.id, { mode: "waiting_text_prompt" });
  await ctx.reply("Kirim prompt video yang kamu mau. Contoh: A premium cinematic ad for a stainless steel tumbler, slow orbiting camera, soft studio lighting, realistic product details.");
});

bot.action("menu_tips", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "💡 *Tips konten affiliate*\\n\\n" +
    "• Tampilkan bentuk dan detail produk dengan jelas.\\n" +
    "• Gunakan hook yang menarik tanpa klaim berlebihan.\\n" +
    "• Cocokkan konsep dengan kategori produk.\\n" +
    "• Periksa hasil video sebelum diunggah; AI bisa mengubah detail produk.",
    { parse_mode: "Markdown", ...mainMenu }
  );
});

async function telegramPhotoAsDataUri(ctx, fileId) {
  const file = await ctx.telegram.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram tidak mengembalikan lokasi file.");
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gagal mengunduh foto dari Telegram (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) throw new Error("Foto terlalu besar. Coba kirim foto yang lebih kecil.");
  const mime = file.file_path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return { dataUri: `data:${mime};base64,${buffer.toString("base64")}`, base64: buffer.toString("base64"), mime };
}

async function createConcepts(base64, mime) {
  const prompt = `
Kamu adalah creative director iklan affiliate yang jujur dan praktis.
Analisis foto produk ini. Jangan mengarang merek, harga, bahan, spesifikasi, atau manfaat yang tidak terlihat/tercantum.
Buat tepat 5 konsep video yang benar-benar berbeda dan cocok untuk produk ini:
1. cinematic product showcase,
2. penggunaan/demo produk (jika masuk akal),
3. close-up detail dan fitur yang terlihat,
4. lifestyle/UGC-style (jangan mengklaim ada orang asli),
5. konsep kreatif alternatif.
Untuk setiap konsep berikan:
- title: judul singkat Bahasa Indonesia,
- style: "showcase", "demo", atau "lifestyle",
- description: deskripsi Bahasa Indonesia,
- prompt: prompt video dalam Bahasa Inggris, konkret, realistis, menjaga bentuk/warna produk, tanpa teks/logo tambahan dan tanpa klaim tak terverifikasi,
- hook: hook singkat Bahasa Indonesia,
- caption: caption affiliate singkat tanpa klaim yang tidak didukung,
- hashtags: 4-6 hashtag.
Kembalikan JSON valid saja dengan bentuk:
{"product_summary":"...","concepts":[{"title":"...","style":"...","description":"...","prompt":"...","hook":"...","caption":"...","hashtags":["..."]}]}
`;
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: mime, data: base64 } }
      ]
    }],
    config: { responseMimeType: "application/json", temperature: 0.8 }
  });

  const raw = response.text || "";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.concepts) || parsed.concepts.length < 1) {
    throw new Error("Gemini tidak menghasilkan daftar konsep yang valid.");
  }
  return parsed;
}

function conceptsKeyboard(concepts) {
  const rows = concepts.slice(0, 5).map((c, i) => [
    Markup.button.callback(`${i + 1}. ${String(c.title || `Konsep ${i + 1}`).slice(0, 45)}`, `concept_${i}`)
  ]);
  rows.push([Markup.button.callback("❌ Batal", "cancel_pending")]);
  return Markup.inlineKeyboard(rows);
}

bot.action(/^concept_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const state = userState.get(ctx.from.id);
  const index = Number(ctx.match[1]);
  if (!state || state.mode !== "choose_concept" || !state.concepts?.[index]) {
    return ctx.reply("Pilihan konsep sudah kedaluwarsa. Kirim /start lalu coba lagi.");
  }
  const concept = state.concepts[index];
  userState.set(ctx.from.id, { ...state, mode: "generating", selectedConcept: concept });
  await generateAndSend(ctx, {
    model: IMAGE_MODEL,
    input: {
      image_url: state.dataUri,
      prompt: `${concept.prompt}\\nCommercial product video, vertical social-media framing, keep the product's visible design consistent.`
    },
    concept
  });
});

bot.action("cancel_pending", async (ctx) => {
  await ctx.answerCbQuery("Dibatalkan");
  userState.delete(ctx.from.id);
  await ctx.reply("Proses dibatalkan. Ketik /start untuk mulai lagi.");
});

async function generateAndSend(ctx, { model, input, concept }) {
  const status = await ctx.reply("🎬 *Sedang membuat video...*\\n\\nProses dapat memerlukan beberapa menit. Jangan kirim ulang dulu ya.", { parse_mode: "Markdown" });
  try {
    const result = await fal.subscribe(model, {
      input,
      logs: false
    });
    const videoUrl = result?.data?.video?.url || result?.video?.url;
    if (!videoUrl) {
      console.error("fal.ai result did not contain video URL:", JSON.stringify(result?.data || result));
      throw new Error("API tidak mengembalikan URL video.");
    }

    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) throw new Error(`Gagal mengunduh hasil video (${videoResponse.status}).`);
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

    // Telegram bot video uploads are size-limited. Fail clearly rather than crashing.
    if (videoBuffer.length > 49 * 1024 * 1024) {
      await ctx.reply(`Video berhasil dibuat, tetapi ukuran file terlalu besar untuk dikirim langsung lewat bot.\\n\\nHasil: ${videoUrl}`);
      return;
    }

    const captionParts = [];
    if (concept?.title) captionParts.push(`🎬 ${concept.title}`);
    if (concept?.hook) captionParts.push(`🪝 Hook: ${concept.hook}`);
    if (concept?.caption) captionParts.push(`📝 ${concept.caption}`);
    if (Array.isArray(concept?.hashtags)) captionParts.push(concept.hashtags.join(" "));
    captionParts.push("\\nPeriksa detail produk dan hasil AI sebelum mengunggah.");
    await ctx.telegram.sendVideo(ctx.chat.id, { source: videoBuffer, filename: "affiliate-video.mp4" }, {
      caption: captionParts.join("\\n").slice(0, 1024)
    });
  } catch (error) {
    console.error("Video generation error:", error);
    await ctx.reply(
      "❌ Generate gagal. Belum ada sistem kredit di prototype ini, jadi cek dashboard fal.ai untuk memastikan apakah request dikenakan biaya.\\n\\n" +
      "Detail: " + String(error?.message || error).slice(0, 350)
    );
  } finally {
    userState.delete(ctx.from.id);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id); } catch {}
  }
}

bot.on("photo", async (ctx) => {
  const state = userState.get(ctx.from.id);
  if (state?.mode === "generating") return ctx.reply("Generate sebelumnya masih berjalan. Tunggu dulu ya.");
  await ctx.reply("🔎 Foto diterima. Aku sedang menganalisis produk dan menyiapkan 5 konsep...");
  try {
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const image = await telegramPhotoAsDataUri(ctx, largest.file_id);
    const result = await createConcepts(image.base64, image.mime);
    const concepts = result.concepts.slice(0, 5);
    userState.set(ctx.from.id, {
      mode: "choose_concept",
      dataUri: image.dataUri,
      concepts
    });

    const overview = String(result.product_summary || "Produk berhasil dianalisis.");
    const text = `🧠 *Analisis produk:* ${overview}\\n\\nPilih konsep yang ingin dibuat jadi video:`;
    await ctx.reply(text, { parse_mode: "Markdown", ...conceptsKeyboard(concepts) });

    // Send short concept details as a separate message for easier reading.
    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i];
      await ctx.reply(
        `*${i + 1}. ${c.title || `Konsep ${i + 1}`}*\\n${c.description || ""}\\n` +
        (c.hook ? `Hook: ${c.hook}\\n` : ""),
        { parse_mode: "Markdown" }
      );
    }
  } catch (error) {
    console.error("Photo analysis error:", error);
    userState.delete(ctx.from.id);
    await ctx.reply("❌ Gagal menganalisis foto. Cek API Gemini dan log Railway, lalu coba lagi.\\nDetail: " + String(error?.message || error).slice(0, 250));
  }
});

bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  const state = userState.get(ctx.from.id);

  if (!state || state.mode === "waiting_photo") {
    return ctx.reply("Pilih menu terlebih dahulu lewat /start, lalu kirim foto atau prompt.");
  }

  if (state.mode === "waiting_text_prompt") {
    const prompt = ctx.message.text.trim();
    if (prompt.length < 10) return ctx.reply("Prompt terlalu singkat. Coba jelaskan produk, gerakan kamera, pencahayaan, dan gaya videonya.");
    userState.set(ctx.from.id, { mode: "generating_text" });
    await generateAndSend(ctx, {
      model: TEXT_MODEL,
      input: {
        prompt: `${prompt}\\nCreate a polished social-media product advertisement. Avoid unsupported claims, fake labels, and added text.`
      }
    });
  }
});

bot.catch((err, ctx) => {
  console.error(`Unhandled bot error for update ${ctx.update?.update_id}:`, err);
});

// Lightweight HTTP server for Railway health checks.
const server = createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "combo-ai-affiliate-bot" }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`Health server listening on ${port}`));

bot.launch().then(() => console.log("COMBO AI Affiliate Bot started.")).catch((err) => {
  console.error("Failed to start Telegram bot:", err);
  process.exit(1);
});

process.once("SIGINT", () => { bot.stop("SIGINT"); server.close(); });
process.once("SIGTERM", () => { bot.stop("SIGTERM"); server.close(); });
