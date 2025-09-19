import fs from "fs";
import path from "path";

const dbPath = path.resolve("./data/messages.json");

export function readDB() {
  try {
    const raw = fs.readFileSync(dbPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Gagal baca DB:", err);
    return { savedMessages: [] };
  }
}

export function writeDB(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("❌ Gagal tulis DB:", err);
  }
}
