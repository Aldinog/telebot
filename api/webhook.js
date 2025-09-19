import { Telegraf } from "telegraf";
import { readDB, writeDB } from "../utils/db.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const GROUP_ID = process.env.GROUP_ID; // ID grup target

// =============== FITUR ADMIN (PRIVATE CHAT) =================

// Tambah pesan ke database (reply atau kirim langsung ke bot)
bot.on("message", async (ctx) => {
  if (ctx.chat.type === "private") {
    // /show list pesan
    if (ctx.message.text?.startsWith("/show")) {
      const db = readDB();
      if (db.savedMessages.length === 0) {
        return ctx.reply("📭 Belum ada pesan tersimpan.");
      }
      let list = db.savedMessages
        .map((m, i) => `${i + 1}. chat_id: ${m.chat_id}, message_id: ${m.message_id}`)
        .join("\n");
      return ctx.reply("📋 Daftar pesan:\n" + list);
    }

    // /delete <nomor>
    if (ctx.message.text?.startsWith("/delete")) {
      const parts = ctx.message.text.split(" ");
      if (parts.length < 2) return ctx.reply("⚠️ Format: /delete <nomor>");
      const index = parseInt(parts[1], 10) - 1;

      const db = readDB();
      if (index >= 0 && index < db.savedMessages.length) {
        db.savedMessages.splice(index, 1);
        writeDB(db);
        return ctx.reply("🗑 Pesan berhasil dihapus!");
      }
      return ctx.reply("⚠️ Nomor tidak valid.");
    }

    // Default → simpan pesan ke DB
    const db = readDB();
    db.savedMessages.push({
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id
    });
    writeDB(db);
    return ctx.reply("✅ Pesan berhasil disimpan!");
  }
});

// =============== CRONJOB HANDLER =================
export default async function handler(req, res) {
  const { query } = req;

  if (query.task === "sendMorning") {
    const db = readDB();
    if (db.savedMessages.length > 0) {
      const random = db.savedMessages[Math.floor(Math.random() * db.savedMessages.length)];
      await bot.telegram.copyMessage(GROUP_ID, random.chat_id, random.message_id);
    }
    res.status(200).send("✅ Morning message sent");
  } else {
    res.status(200).send("⚡ Bot webhook active");
  }
}
