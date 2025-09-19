/* api/index.js (updated) */
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

// Load config dari environment variable
const config = JSON.parse(process.env.CONFIG_JSON || '{}');

// Initialize bot untuk webhook (tidak polling)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// RSS Parser
const parser = new Parser();

// --- DB helpers (file JSON) ---
const DB_PATH = path.resolve('./data/savedMessages.json');

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      // create minimal
      const init = { savedMessages: [], pendingAdds: [] };
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
      return init;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error readDB:', err);
    return { savedMessages: [], pendingAdds: [] };
  }
}

function writeDB(obj) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(obj, null, 2));
    return true;
  } catch (err) {
    console.error('Error writeDB:', err);
    return false;
  }
}

// --- Allowed usernames helper ---
let allowedUsernames = [];
if (Array.isArray(config.allowedUsernames) && config.allowedUsernames.length > 0) {
  allowedUsernames = config.allowedUsernames.map(u => u.toLowerCase());
} else if (process.env.ALLOWED_USERNAMES) {
  allowedUsernames = process.env.ALLOWED_USERNAMES.split(',').map(u => u.trim().toLowerCase());
}

const isAllowedUser = (username) => {
  if (!username) return false;
  return allowedUsernames.includes(username.toLowerCase());
};

// --- existing helpers (unchanged) ---
const isAllowedGroup = (chatId) => {
  return config.allowedGroupIds.includes(chatId);
};
const isAdmin = async (chatId, userId) => {
  try {
    const chatMember = await bot.getChatMember(chatId, userId);
    return chatMember.status === 'administrator' || chatMember.status === 'creator';
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};
// ... detectSpam, muteUser, banUser, deleteMessage (keep yours) ...
const detectSpam = (text) => {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  const keywordCount = (config.promoKeywords||[]).filter(keyword => lowerText.includes(keyword)).length;
  if (keywordCount >= 2) return true;
  for (const domain of (config.suspiciousDomains||[])) {
    if (lowerText.includes(domain)) return true;
  }
  const urlPattern = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlPattern);
  if (urls) {
    for (const url of urls) {
      let domain = url.replace(/^https?:\/\//, '').split('/')[0];
      domain = domain.replace('www.', '');
      if (!(config.allowedDomains||[]).some(allowed => domain.includes(allowed))) {
        return true;
      }
    }
  }
  return false;
};
const muteUser = async (chatId, userId, durationMinutes = 10) => {
  try {
    await bot.restrictChatMember(chatId, userId, {
      can_send_messages: false,
      until_date: Math.floor(Date.now() / 1000) + (durationMinutes * 60)
    });
    console.log(`User ${userId} muted for ${durationMinutes} minutes in chat ${chatId}`);
  } catch (error) {
    console.error('Error muting user:', error);
  }
};
const banUser = async (chatId, userId) => {
  try {
    await bot.banChatMember(chatId, userId);
    console.log(`User ${userId} banned from chat ${chatId}`);
  } catch (error) {
    console.error('Error banning user:', error);
  }
};
const deleteMessage = async (chatId, messageId) => {
  try {
    await bot.deleteMessage(chatId, messageId);
    console.log(`Message ${messageId} deleted in chat ${chatId}`);
  } catch (error) {
    console.error('Error deleting message:', error);
  }
};

// -------------- NEW: Save message helper ----------------
function makePreviewFromMessage(msg) {
  // msg is full Telegram message object
  try {
    if (msg.text) {
      return { type: 'text', preview: msg.text.slice(0, 120) };
    }
    if (msg.animation) return { type: 'gif', preview: '[GIF]' };
    if (msg.sticker) return { type: 'sticker', preview: `[Sticker: ${msg.sticker.emoji || ''}]` };
    if (msg.photo) return { type: 'photo', preview: '[Photo]' };
    if (msg.video) return { type: 'video', preview: '[Video]' };
    if (msg.document) return { type: 'document', preview: '[Document]' };
    return { type: 'other', preview: '[Media]' };
  } catch (e) {
    return { type: 'other', preview: '[Media]' };
  }
}

// Save a message reference to DB (source chat id + message id)
function saveMessageReference(sourceChatId, sourceMessageId, msgObj, ownerUsername) {
  const db = readDB();
  const previewObj = makePreviewFromMessage(msgObj || {});
  const entry = {
    id: Date.now() + '_' + Math.floor(Math.random()*9000+1000), // unique id string
    source_chat_id: sourceChatId,
    source_message_id: sourceMessageId,
    type: previewObj.type,
    preview: previewObj.preview,
    owner: ownerUsername || null,
    created_at: new Date().toISOString()
  };
  db.savedMessages.push(entry);
  writeDB(db);
  return entry;
}

// Remove saved entry by index (1-based) or by id
function deleteSavedByIndex(index1based) {
  const db = readDB();
  const idx = index1based - 1;
  if (idx < 0 || idx >= db.savedMessages.length) return null;
  const removed = db.savedMessages.splice(idx, 1)[0];
  writeDB(db);
  return removed;
}

// -------------- New: send random scheduled message -------------
async function sendRandomScheduledMessageToAllGroups() {
  console.log('Sending random scheduled message to allowed groups...');
  const db = readDB();
  if (!db.savedMessages || db.savedMessages.length === 0) {
    console.log('No saved messages to send.');
    return;
  }
  const random = db.savedMessages[Math.floor(Math.random() * db.savedMessages.length)];
  for (const chatId of config.allowedGroupIds) {
    try {
      // copyMessage(targetChatId, fromChatId, messageId)
      await bot.copyMessage(chatId, random.source_chat_id, random.source_message_id);
      console.log(`Copied message ${random.source_message_id} from ${random.source_chat_id} to ${chatId}`);
    } catch (err) {
      console.error(`Error copying message to ${chatId}:`, err);
    }
  }
}

// ----------------- Process incoming message (extend existing) -----------------
async function processMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const username = (message.from.username || '').toLowerCase();
  const text = message.text;
  const caption = message.caption;

  console.log(`Processing message from ${userId} (${username}) in chat ${chatId}: ${text || caption}`);

  // Skip if message is from bot
  if (message.from.is_bot) return;

  // If private chat: handle admin commands for scheduling
  if (message.chat.type === 'private') {
    // check allowed username
    if (!isAllowedUser(username)) {
      // ignore silently or optionally send message
      // return to avoid giving info to unauthorized users
      return;
    }

    // COMMAND: /add -> initiate pending add
    if (text && text.trim().toLowerCase() === '/add') {
      const db = readDB();
      // add a pendingAdd record; next message from this user will be captured
      db.pendingAdds = db.pendingAdds || [];
      // remove existing pending for this username if any (so only latest counts)
      db.pendingAdds = db.pendingAdds.filter(p => p.username !== username);
      db.pendingAdds.push({ username, chat_id: chatId, ts: Date.now() });
      writeDB(db);
      await bot.sendMessage(chatId, '📥 Silakan kirim pesan yang ingin disimpan (teks, GIF, stiker, dsb.).');
      return;
    }

    // If user has pendingAdd and the message is not a command -> save it
    if (text || message.animation || message.sticker || message.photo || message.video || message.document) {
      const db = readDB();
      const pending = (db.pendingAdds || []).find(p => p.username === username);
      if (pending) {
        // save this message
        const saved = saveMessageReference(pending.chat_id, message.message_id, message, username);
        // remove pending
        db.pendingAdds = db.pendingAdds.filter(p => p.username !== username);
        writeDB(db);
        await bot.sendMessage(chatId, `✅ Pesan berhasil disimpan (ID: ${saved.id}).`);
        return;
      }
    }

    // COMMAND: /listsch -> list saved messages (with previews)
    if (text && text.trim().toLowerCase() === '/listsch') {
      const db = readDB();
      const list = db.savedMessages || [];
      if (list.length === 0) {
        await bot.sendMessage(chatId, '📭 Belum ada pesan tersimpan.');
        return;
      }
      // build message in chunks
      const lines = list.map((m, i) => `${i+1}. [${m.type}] ${m.preview} (saved by: ${m.owner || '-'}) (id: ${m.id})`);
      // Telegram message length limit -> send in chunks if needed
      let chunk = '';
      for (const l of lines) {
        if ((chunk + '\n' + l).length > 3000) {
          await bot.sendMessage(chatId, chunk);
          chunk = l;
        } else {
          chunk = chunk ? chunk + '\n' + l : l;
        }
      }
      if (chunk) await bot.sendMessage(chatId, chunk);
      return;
    }

    // COMMAND: /delsch <nomor> -> delete by 1-based index
    if (text && text.trim().toLowerCase().startsWith('/delsch')) {
      const parts = text.trim().split(/\s+/);
      if (parts.length < 2) {
        await bot.sendMessage(chatId, '⚠️ Format: /delsch <nomor>');
        return;
      }
      const num = parseInt(parts[1], 10);
      if (Number.isNaN(num)) {
        await bot.sendMessage(chatId, '⚠️ Nomor tidak valid.');
        return;
      }
      const removed = deleteSavedByIndex(num);
      if (removed) {
        await bot.sendMessage(chatId, `🗑 Pesan nomor ${num} berhasil dihapus.`);
      } else {
        await bot.sendMessage(chatId, `⚠️ Tidak ditemukan pesan nomor ${num}.`);
      }
      return;
    }

    // If reached here and it's a command we don't handle -> ignore (or respond)
    // Avoid interfering with other bot commands; return to let other parts handle if needed.
    return;
  } // end private chat handling

  // ------------ existing group logic continues unchanged ------------

  // Handle new chat members
  if (message.new_chat_members && message.new_chat_members.length > 0) {
    console.log(`New chat members event in chat ${chatId}`);
    for (const member of message.new_chat_members) {
      if (!member.is_bot) {
        const usernameNew = member.username || `User_${member.id}`;
        const welcomeText =
          `🎉 Selamat datang di grup kami, @${usernameNew}!\n\n` +
          `📌 Silakan baca peraturan grup:\n` +
          `1. Dilarang spam/promosi tanpa izin admin\n` +
          `2. Hormati semua anggota\n` +
          `3. Gunakan bahasa yang sopan\n\n` +
          `Jika ada pertanyaan, hubungi admin!`;
        await bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
        console.log(`Welcome message sent to @${usernameNew} in chat ${chatId}`);
      }
    }
    return;
  }

  // Handle commands in groups (existing code paths)
  if (text && text.startsWith('/')) {
    const command = text.split(' ')[0].toLowerCase();
    switch (command) {
      case '/start':
        await bot.sendMessage(chatId,
          "🤖 Bot Trading Aktif!\n\n" +
          "Fitur:\n" +
          "- Anti-spam otomatis\n" +
          "- Welcome member baru\n" +
          "- Mute member (/mute)\n" +
          "- Ban member (/ban)\n" +
          "- Berita otomatis jam 9 pagi\n" +
          "- Notifikasi sesi trading\n\n" +
          "Gunakan /help untuk bantuan"
        );
        break;

      case '/help':
        await bot.sendMessage(chatId,
          "📋 Panduan Bot:\n\n" +
          "🔧 Perintah Admin:\n" +
          "/mute - Balas pesan user atau sebut username untuk mute 10 menit\n" +
          "/ban - Balas pesan user atau sebut username untuk ban\n" +
          "/allowgroup - Tambah grup saat ini ke daftar izin\n" +
          "/removegroup <group_id> - Hapus grup dari daftar izin\n" +
          "/listgroups - Lihat daftar grup yang diizinkan\n" +
          "/groupid - Tampilkan ID grup saat ini\n" +
          "/news - Kirim berita terkini (manual)\n" +
          "/session <nama_sesi> - Kirim notifikasi pembukaan sesi\n\n" +
          "🛡️ Fitur Otomatis:\n" +
          "- Hapus spam/promosi/link dan mute 10 menit\n" +
          "- Welcome member baru\n" +
          "- Sapaan selamat pagi jam 7 WIB\n" +
          "- Berita forex/saham/USD jam 9 pagi\n" +
          "- Notifikasi sesi trading\n\n" +
          "💡 Contoh penggunaan /session:\n" +
          "/session sydney\n" +
          "/session tokyo\n" +
          "/session london\n" +
          "/session newyork"
        );
        break;

      // Keep the rest of your group commands unchanged; included only selected ones here to keep file readable.
      // For brevity, I'm not repeating every case; keep your existing code for /groupid, /allowgroup, /listgroups, /news, /session, /mute, /ban, /runtasks etc.
      default:
        // fall back to previous command handling in your original file...
        break;
    }
  } else if (text || caption) {
    // group spam detection logic (unchanged)
    const messageText = text || caption;
    console.log(`Checking for spam in message: ${messageText}`);

    // Skip if in private chat (handled earlier)
    // Skip if group not allowed
    if (!isAllowedGroup(chatId)) {
      console.log(`Skipping spam check for non-allowed group ${chatId}`);
      return;
    }

    // Skip if user is admin
    const isAdminUser = await isAdmin(chatId, userId);
    if (isAdminUser) {
      console.log(`Skipping spam check for admin user ${userId} in chat ${chatId}`);
      return;
    }

    // Check for spam
    const isSpam = detectSpam(messageText);
    console.log(`Spam detection result for message: ${isSpam}`);

    if (isSpam) {
      console.log(`Deleting spam message ${message.message_id} from user ${userId} in chat ${chatId}`);

      try {
        await deleteMessage(chatId, message.message_id);
      } catch (error) {
        console.error(`Error deleting message ${message.message_id}:`, error);
      }

      try {
        await muteUser(chatId, userId);
      } catch (error) {
        console.error(`Error muting user ${userId}:`, error);
      }

      const usernameWarn = message.from.username || `User_${message.from.id}`;
      try {
        await bot.sendMessage(chatId,
          `⚠️ @${usernameWarn} pesan dihapus dan di-mute 10 menit!\n` +
          `Alasan: Mengandung promosi/link/spam\n\n` +
          `📌 Peraturan grup:\n` +
          `• Dilarang promosi grup lain\n` +
          `• Dilarang posting link tanpa izin admin\n` +
          `• Hormati semua anggota grup`
        );
      } catch (error) {
        console.error(`Error sending warning message:`, error);
      }
    }
  }
}

// Webhook handler untuk Vercel - gunakan processMessage
module.exports = async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body ? req.body : {query: req.query}, null, 2));

  try {
    // Handle update dari Telegram
    if (req.body) {
      const update = req.body;

      // Process message
      if (update.message) {
        await processMessage(update.message);
      }
      // Process edited message
      else if (update.edited_message) {
        await processMessage(update.edited_message);
      }
      // Process chat_member events (kept)
      else if (update.chat_member) {
        const chatMember = update.chat_member;
        if (chatMember.old_chat_member && chatMember.old_chat_member.user &&
            chatMember.old_chat_member.user.is_bot === false &&
            chatMember.new_chat_member && chatMember.new_chat_member.status === 'member') {
          await processMessage({
            chat: chatMember.chat,
            new_chat_members: [chatMember.new_chat_member]
          });
        }
      } else if (update.my_chat_member) {
        const chatMember = update.my_chat_member;
        if (chatMember.old_chat_member && chatMember.old_chat_member.user &&
            chatMember.old_chat_member.user.is_bot === false &&
            chatMember.new_chat_member && chatMember.new_chat_member.status === 'member') {
          await processMessage({
            chat: chatMember.chat,
            new_chat_members: [chatMember.new_chat_member]
          });
        }
      }
    }

    // Handle scheduled tasks via query parameter
    if (req.query && req.query.task) {
      switch (req.query.task) {
        case 'morning':
          await sendRandomScheduledMessageToAllGroups();
          return res.status(200).send('Morning random message sent');
        case 'news':
          await sendScheduledNews();
          return res.status(200).send('News sent');
        case 'sydney':
          await sendSessionNotification('sydney');
          return res.status(200).send('Sydney session notification sent');
        case 'tokyo':
          await sendSessionNotification('tokyo');
          return res.status(200).send('Tokyo session notification sent');
        case 'london':
          await sendSessionNotification('london');
          return res.status(200).send('London session notification sent');
        case 'newyork':
          await sendSessionNotification('newyork');
          return res.status(200).send('New York session notification sent');
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(500).send('Error');
  }
};
