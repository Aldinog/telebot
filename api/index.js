const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const Parser = require('rss-parser');
// Load config dari environment variable
const config = JSON.parse(process.env.CONFIG_JSON || '{}');
// Initialize bot untuk webhook
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
// RSS Parser
const parser = new Parser();
// Helper functions
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
const detectSpam = (text) => {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Check for promo keywords
  const keywordCount = config.promoKeywords.filter(keyword => lowerText.includes(keyword)).length;
  if (keywordCount >= 2) return true;
  
  // Check for suspicious domains
  for (const domain of config.suspiciousDomains) {
    if (lowerText.includes(domain)) return true;
  }
  
  // Check for URLs
  const urlPattern = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlPattern);
  if (urls) {
    for (const url of urls) {
      let domain = url.replace(/^https?:\/\//, '').split('/')[0];
      domain = domain.replace('www.', 't.me', 'wa.me');
      if (!config.allowedDomains.some(allowed => domain.includes(allowed))) {
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
// News sending function with multiple fallback URLs for USD
const sendNews = async (chatId) => {
  try {
    bot.sendMessage(chatId, "📡 Mengambil berita terkini...");
    
    // Default RSS feeds (fallback if config feeds fail)
    const defaultFeeds = {
      forex: 'https://www.investing.com/rss/news.rss',
      saham: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',
      // Multiple USD feed options to try in order
      usd: [
        'https://feeds.finance.yahoo.com/rss/2.0/headline?s=USD&region=US&lang=en-US',
        'https://www.fxstreet.com/rss/news',
        'https://www.bloomberg.com/feed',
        'https://feeds.reuters.com/reuters/businessNews',
        'https://rss.cnn.com/rss/money_news_international.rss'
      ]
    };
    
    // Use feeds from config or fallback to defaults
    const forexFeedUrl = config.rssFeeds?.forex || defaultFeeds.forex;
    const stockFeedUrl = config.rssFeeds?.saham || defaultFeeds.saham;
    const usdFeedUrls = config.rssFeeds?.usd ? [config.rssFeeds.usd] : defaultFeeds.usd;
    
    console.log('Using RSS feeds:');
    console.log('Forex:', forexFeedUrl);
    console.log('Stock:', stockFeedUrl);
    console.log('USD options:', usdFeedUrls);
    
    let newsMessage = "📢 Berita Terkini:\n\n";
    
    // Try to fetch forex news
    try {
      const forexFeed = await parser.parseURL(forexFeedUrl);
      console.log('Forex feed fetched successfully, items:', forexFeed.items.length);
      const forexNews = forexFeed.items.slice(0, 2).map(item => 
        `📰 ${item.title}\n${item.link || ''}`
      ).join('\n\n');
      newsMessage += "🔹 Forex:\n" + forexNews + "\n\n";
    } catch (forexError) {
      console.error('Error fetching forex news:', forexError.message);
      newsMessage += "🔹 Forex:\n❌ Gagal mengambil berita forex\n\n";
    }
    
    // Try to fetch stock news
    try {
      const stockFeed = await parser.parseURL(stockFeedUrl);
      console.log('Stock feed fetched successfully, items:', stockFeed.items.length);
      const stockNews = stockFeed.items.slice(0, 2).map(item => 
        `📈 ${item.title}\n${item.link || ''}`
      ).join('\n\n');
      newsMessage += "🔹 Saham:\n" + stockNews + "\n\n";
    } catch (stockError) {
      console.error('Error fetching stock news:', stockError.message);
      newsMessage += "🔹 Saham:\n❌ Gagal mengambil berita saham\n\n";
    }
    
    // Try to fetch USD news - try multiple URLs until one works
    let usdSuccess = false;
    for (const usdUrl of usdFeedUrls) {
      try {
        console.log('Trying USD feed:', usdUrl);
        const usdFeed = await parser.parseURL(usdUrl);
        console.log('USD feed fetched successfully, items:', usdFeed.items.length);
        const usdNews = usdFeed.items.slice(0, 2).map(item => 
          `💵 ${item.title}\n${item.link || ''}`
        ).join('\n\n');
        newsMessage += "🔹 USD:\n" + usdNews;
        usdSuccess = true;
        break; // Exit the loop if successful
      } catch (usdError) {
        console.error(`Error fetching USD news from ${usdUrl}:`, usdError.message);
        // Continue to the next URL
      }
    }
    
    if (!usdSuccess) {
      newsMessage += "🔹 USD:\n❌ Gagal mengambil berita USD (semua URL gagal)";
    }
    
    // Send the news message
    await bot.sendMessage(chatId, newsMessage, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true 
    });
    
  } catch (error) {
    console.error('General error sending news:', error);
    bot.sendMessage(chatId, 
      "❌ Gagal mengambil berita. Silakan coba lagi nanti atau periksa konfigurasi RSS feed.\n\n" +
      "Error: " + error.message
    );
  }
};
// Alternative news function with working feeds
const sendNewsAlternative = async (chatId) => {
  try {
    bot.sendMessage(chatId, "📡 Mengambil berita terkini...");
    
    // Working RSS feeds (tested and verified)
    const workingFeeds = {
      forex: 'https://www.investing.com/rss/news.rss',
      saham: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang-en-US',
      // Multiple USD feed options with different sources
      usd: [
        'https://feeds.finance.yahoo.com/rss/2.0/headline?s=USD&region=US&lang=en-US',
        'https://www.fxstreet.com/rss/news',
        'https://www.dailyfx.com/rss',
        'https://www.forexlive.com/rss',
        'https://feeds.reuters.com/reuters/businessNews'
      ]
    };
    
    let newsMessage = "📢 Berita Terkini:\n\n";
    
    // Fetch forex news
    try {
      const forexFeed = await parser.parseURL(workingFeeds.forex);
      const forexNews = forexFeed.items.slice(0, 2).map(item => 
        `📰 ${item.title}\n${item.link}`
      ).join('\n\n');
      newsMessage += "🔹 Forex:\n" + forexNews + "\n\n";
    } catch (error) {
      console.error('Error fetching forex news:', error.message);
      newsMessage += "🔹 Forex:\n❌ Gagal mengambil berita forex\n\n";
    }
    
    // Fetch stock news
    try {
      const stockFeed = await parser.parseURL(workingFeeds.saham);
      const stockNews = stockFeed.items.slice(0, 2).map(item => 
        `📈 ${item.title}\n${item.link}`
      ).join('\n\n');
      newsMessage += "🔹 Saham:\n" + stockNews + "\n\n";
    } catch (error) {
      console.error('Error fetching stock news:', error.message);
      newsMessage += "🔹 Saham:\n❌ Gagal mengambil berita saham\n\n";
    }
    
    // Try to fetch USD news - try multiple URLs until one works
    let usdSuccess = false;
    for (const usdUrl of workingFeeds.usd) {
      try {
        console.log('Trying USD feed:', usdUrl);
        const usdFeed = await parser.parseURL(usdUrl);
        const usdNews = usdFeed.items.slice(0, 2).map(item => 
          `💵 ${item.title}\n${item.link}`
        ).join('\n\n');
        newsMessage += "🔹 USD:\n" + usdNews;
        usdSuccess = true;
        break; // Exit the loop if successful
      } catch (usdError) {
        console.error(`Error fetching USD news from ${usdUrl}:`, usdError.message);
        // Continue to the next URL
      }
    }
    
    if (!usdSuccess) {
      newsMessage += "🔹 USD:\n❌ Gagal mengambil berita USD (semua URL gagal)";
    }
    
    await bot.sendMessage(chatId, newsMessage, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true 
    });
    
  } catch (error) {
    console.error('Error in alternative news function:', error);
    bot.sendMessage(chatId, "❌ Gagal mengambil berita. Silakan coba lagi nanti.");
  }
};
// Session notification functions (extracted for reuse)
const sendSydneySession = (chatId) => {
  bot.sendMessage(chatId, 
    "🇦🇺 Sesi Sydney Dimulai!\n\n" +
    "Waktu: 05:00 - 14:00 WIB\n" +
    "Fokus: AUD, NZD pairs\n\n" +
    "Selamat bertrading! 🚀"
  );
};
const sendTokyoSession = (chatId) => {
  bot.sendMessage(chatId, 
    "🇯🇵 Sesi Tokyo Dimulai!\n\n" +
    "Waktu: 07:00 - 16:00 WIB\n" +
    "Fokus: JPY pairs\n\n" +
    "Selamat bertrading! 🚀"
  );
};
const sendLondonSession = (chatId) => {
  bot.sendMessage(chatId, 
    "🇬🇧 Sesi London Dimulai!\n\n" +
    "Waktu: 13:00 - 22:00 WIB\n" +
    "Fokus: EUR, GBP pairs\n\n" +
    "Selamat bertrading! 🚀"
  );
};
const sendNewYorkSession = (chatId) => {
  bot.sendMessage(chatId, 
    "🇺🇸 Sesi New York Dimulai!\n\n" +
    "Waktu: 20:00 - 05:00 WIB (esoknya)\n" +
    "Fokus: USD, CAD pairs\n\n" +
    "Selamat bertrading! 🚀"
  );
};
// Fungsi untuk mengirim pesan pagi
async function sendMorningMessage() {
  console.log('Sending good morning message...');
  
  for (const chatId of config.allowedGroupIds) {
    try {
      await bot.sendMessage(chatId, 
        "🌅 Selamat pagi teman-teman!\n\n" +
        "Semoga hari ini penuh berkah dan profit yang konsisten! 💰\n\n" +
        "Jangan lupa untuk selalu mengikuti rencana trading dan manajemen risiko yang baik. 📊"
      );
      console.log(`Morning message sent to chat ${chatId}`);
    } catch (error) {
      console.error(`Error sending morning message to ${chatId}:`, error);
    }
  }
}

// Fungsi untuk mengirim berita
async function sendScheduledNews() {
  console.log('Sending scheduled news...');
  
  for (const chatId of config.allowedGroupIds) {
    try {
      await sendNewsAlternative(chatId);
      console.log(`News sent to chat ${chatId}`);
    } catch (error) {
      console.error(`Error sending news to ${chatId}:`, error);
    }
  }
}

// Fungsi untuk mengirim notifikasi sesi
async function sendSessionNotification(sessionType) {
  console.log(`Sending ${sessionType} session notification...`);
  
  for (const chatId of config.allowedGroupIds) {
    try {
      switch (sessionType) {
        case 'sydney':
          await bot.sendMessage(chatId, 
            "🇦🇺 Sesi Sydney Dimulai!\n\n" +
            "Waktu: 05:00 - 14:00 WIB\n" +
            "Fokus: AUD, NZD pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
          break;
        case 'tokyo':
          await bot.sendMessage(chatId, 
            "🇯🇵 Sesi Tokyo Dimulai!\n\n" +
            "Waktu: 07:00 - 16:00 WIB\n" +
            "Fokus: JPY pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
          break;
        case 'london':
          await bot.sendMessage(chatId, 
            "🇬🇧 Sesi London Dimulai!\n\n" +
            "Waktu: 13:00 - 22:00 WIB\n" +
            "Fokus: EUR, GBP pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
          break;
        case 'newyork':
          await bot.sendMessage(chatId, 
            "🇺🇸 Sesi New York Dimulai!\n\n" +
            "Waktu: 20:00 - 05:00 WIB (esoknya)\n" +
            "Fokus: USD, CAD pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
          break;
      }
      console.log(`${sessionType} session notification sent to chat ${chatId}`);
    } catch (error) {
      console.error(`Error sending ${sessionType} session notification to ${chatId}:`, error);
    }
  }
}

// Process message function
async function processMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;
  const caption = message.caption;
  
  console.log(`Processing message from ${userId} in chat ${chatId}: ${text || caption}`);
  
  // Skip if message is from bot
  if (message.from.is_bot) return;
  
  // Handle new chat members
  if (message.new_chat_members && message.new_chat_members.length > 0) {
    console.log(`New chat members event in chat ${chatId}`);
    
    for (const member of message.new_chat_members) {
      if (!member.is_bot) {
        const username = member.username || `User_${member.id}`;
        const welcomeText = 
          `🎉 Selamat datang di grup kami, @${username}!\n\n` +
          `📌 Silakan baca peraturan grup:\n` +
          `1. Dilarang spam/promosi tanpa izin admin\n` +
          `2. Hormati semua anggota\n` +
          `3. Gunakan bahasa yang sopan\n\n` +
          `Jika ada pertanyaan, hubungi admin!`;
        
        await bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
        console.log(`Welcome message sent to @${username} in chat ${chatId}`);
      }
    }
    return; // No need to check for spam in system messages
  }
  
  // Handle commands
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
        
      case '/groupid':
        await bot.sendMessage(chatId, `🆔 ID Grup ini: ${chatId}`, { parse_mode: 'Markdown' });
        break;
        
      case '/allowgroup':
        if (await isAdmin(chatId, userId)) {
          if (config.allowedGroupIds.includes(chatId)) {
            await bot.sendMessage(chatId, "⚠️ Grup ini sudah ada di daftar izin!");
          } else {
            config.allowedGroupIds.push(chatId);
            await bot.sendMessage(chatId, `✅ Grup ini telah ditambahkan ke daftar izin!\nID Grup: ${chatId}\n\n⚠️ Catatan: Perubahan hanya disimpan di memori dan akan hilang saat redeploy.`);
          }
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
        
      case '/listgroups':
        if (await isAdmin(chatId, userId)) {
          if (config.allowedGroupIds.length > 0) {
            const groupsText = config.allowedGroupIds.map(id => `• ${id}`).join('\n');
            await bot.sendMessage(chatId, `📝 Grup yang diizinkan:\n${groupsText}`);
          } else {
            await bot.sendMessage(chatId, "📝 Tidak ada grup di daftar izin");
          }
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
        
      case '/news':
        if (await isAdmin(chatId, userId)) {
          if (!isAllowedGroup(chatId)) {
            await bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
          } else {
            await sendNewsAlternative(chatId);
          }
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
        
      case '/testusd':
        if (await isAdmin(chatId, userId)) {
          const usdFeeds = [
            { name: 'Yahoo Finance USD', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=USD&region=US&lang=en-US' },
            { name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news' },
            { name: 'DailyFX', url: 'https://www.dailyfx.com/rss' },
            { name: 'ForexLive', url: 'https://www.forexlive.com/rss' },
            { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews' }
          ];
          
          let testResults = "🧪 Hasil Test USD Feeds:\n\n";
          
          for (const feed of usdFeeds) {
            try {
              await parser.parseURL(feed.url);
              testResults += `✅ ${feed.name}: BERHASIL\n`;
            } catch (error) {
              testResults += `❌ ${feed.name}: GAGAL\n`;
            }
          }
          
          await bot.sendMessage(chatId, testResults);
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
        
      case '/session':
        if (await isAdmin(chatId, userId)) {
          if (!isAllowedGroup(chatId)) {
            await bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
          } else {
            await bot.sendMessage(chatId, 
              "📋 Sesi Trading yang tersedia:\n\n" +
              "• /session sydney - Sesi Sydney\n" +
              "• /session tokyo - Sesi Tokyo\n" +
              "• /session london - Sesi London\n" +
              "• /session newyork - Sesi New York\n\n" +
              "Silakan pilih sesi yang ingin dikirim!"
            );
          }
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
        
      case '/session sydney':
        if (await isAdmin(chatId, userId) && isAllowedGroup(chatId)) {
          await bot.sendMessage(chatId, 
            "🇦🇺 Sesi Sydney Dimulai!\n\n" +
            "Waktu: 05:00 - 14:00 WIB\n" +
            "Fokus: AUD, NZD pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
        } else if (!await isAdmin(chatId, userId)) {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        } else {
          await bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
        }
        break;
        
      case '/session tokyo':
        if (await isAdmin(chatId, userId) && isAllowedGroup(chatId)) {
          await bot.sendMessage(chatId, 
            "🇯🇵 Sesi Tokyo Dimulai!\n\n" +
            "Waktu: 07:00 - 16:00 WIB\n" +
            "Fokus: JPY pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
        } else if (!await isAdmin(chatId, userId)) {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        } else {
          await bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
        }
        break;
        
      case '/session london':
        if (await isAdmin(chatId, userId) && isAllowedGroup(chatId)) {
          await bot.sendMessage(chatId, 
            "🇬🇧 Sesi London Dimulai!\n\n" +
            "Waktu: 13:00 - 22:00 WIB\n" +
            "Fokus: EUR, GBP pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
        } else if (!await isAdmin(chatId, userId)) {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        } else {
          await bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
        }
        break;
        
      case '/session newyork':
        if (await isAdmin(chatId, userId) && isAllowedGroup(chatId)) {
          await bot.sendMessage(chatId, 
            "🇺🇸 Sesi New York Dimulai!\n\n" +
            "Waktu: 20:00 - 05:00 WIB (esoknya)\n" +
            "Fokus: USD, CAD pairs\n\n" +
            "Selamat bertrading! 🚀"
          );
        } else if (!await isAdmin(chatId, userId)) {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        } else {
          await bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
        }
        break;
        
      case '/mute':
        if (await isAdmin(chatId, userId)) {
          let targetUserId;
          let targetUsername;
          
          if (message.reply_to_message) {
            targetUserId = message.reply_to_message.from.id;
            targetUsername = message.reply_to_message.from.username || `User_${message.reply_to_message.from.id}`;
          } else if (text.includes('@')) {
            const usernameMatch = text.match(/@(\w+)/);
            if (usernameMatch) {
              targetUsername = usernameMatch[1];
              try {
                const chatMembers = await bot.getChatAdministrators(chatId);
                const admin = chatMembers.find(member => member.user.username === targetUsername);
                if (admin) {
                  targetUserId = admin.user.id;
                } else {
                  await bot.sendMessage(chatId, "❌ User tidak ditemukan di grup ini!");
                  return;
                }
              } catch (error) {
                console.error('Error finding user by username:', error);
                await bot.sendMessage(chatId, "❌ Gagal menemukan user!");
                return;
              }
            }
          } else {
            await bot.sendMessage(chatId, "❌ Balas pesan user yang ingin di-mute atau sebut username dengan format /mute @username");
            return;
          }
          
          try {
            await muteUser(chatId, targetUserId);
            await bot.sendMessage(chatId, `✅ @${targetUsername} telah di-mute selama 10 menit!`);
            await deleteMessage(chatId, message.message_id);
          } catch (error) {
            console.error('Error muting user:', error);
            await bot.sendMessage(chatId, `❌ Gagal mute user: ${error.message}`);
          }
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
        
      case '/ban':
        if (await isAdmin(chatId, userId)) {
          let targetUserId;
          let targetUsername;
          
          if (message.reply_to_message) {
            targetUserId = message.reply_to_message.from.id;
            targetUsername = message.reply_to_message.from.username || `User_${message.reply_to_message.from.id}`;
          } else if (text.includes('@')) {
            const usernameMatch = text.match(/@(\w+)/);
            if (usernameMatch) {
              targetUsername = usernameMatch[1];
              try {
                const chatMembers = await bot.getChatAdministrators(chatId);
                const admin = chatMembers.find(member => member.user.username === targetUsername);
                if (admin) {
                  targetUserId = admin.user.id;
                } else {
                  await bot.sendMessage(chatId, "❌ User tidak ditemukan di grup ini!");
                  return;
                }
              } catch (error) {
                console.error('Error finding user by username:', error);
                await bot.sendMessage(chatId, "❌ Gagal menemukan user!");
                return;
              }
            }
          } else {
            await bot.sendMessage(chatId, "❌ Balas pesan user yang ingin di-ban atau sebut username dengan format /ban @username");
            return;
          }
          
          try {
            await banUser(chatId, targetUserId);
            await bot.sendMessage(chatId, `✅ @${targetUsername} telah di-ban!`);
            await deleteMessage(chatId, message.message_id);
          } catch (error) {
            console.error('Error banning user:', error);
            await bot.sendMessage(chatId, `❌ Gagal ban user: ${error.message}`);
          }
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
        
      case '/runtasks':
        if (await isAdmin(chatId, userId)) {
          await bot.sendMessage(chatId, "🔄 Menjalankan semua scheduled tasks...");
          
          // Run all tasks
          await sendMorningMessage();
          await sendScheduledNews();
          await sendSessionNotification('sydney');
          await sendSessionNotification('tokyo');
          await sendSessionNotification('london');
          await sendSessionNotification('newyork');
          
          await bot.sendMessage(chatId, "✅ Semua scheduled tasks telah dijalankan!");
        } else {
          await bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
        }
        break;
    }
  }
  // Handle spam detection for non-command messages
  else if (text || caption) {
    const messageText = text || caption;
    
    console.log(`Checking for spam in message: ${messageText}`);
    
    // Skip if in private chat
    if (chatId === userId) {
      console.log(`Skipping spam check for private chat ${chatId}`);
      return;
    }
    
    // Check if group is allowed
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
      
      // Delete the message
      try {
        await deleteMessage(chatId, message.message_id);
        console.log(`Message ${message.message_id} deleted successfully`);
      } catch (error) {
        console.error(`Error deleting message ${message.message_id}:`, error);
      }
      
      // Mute the user for 10 minutes
      try {
        await muteUser(chatId, userId);
        console.log(`User ${userId} muted successfully`);
      } catch (error) {
        console.error(`Error muting user ${userId}:`, error);
      }
      
      // Send warning
      const username = message.from.username || `User_${message.from.id}`;
      try {
        await bot.sendMessage(chatId, 
          `⚠️ @${username} pesan dihapus dan di-mute 10 menit!\n` +
          `Alasan: Mengandung promosi/link/spam\n\n` +
          `📌 Peraturan grup:\n` +
          `• Dilarang promosi grup lain\n` +
          `• Dilarang posting link tanpa izin admin\n` +
          `• Hormati semua anggota grup`
        );
        console.log(`Warning message sent to chat ${chatId}`);
      } catch (error) {
        console.error(`Error sending warning message:`, error);
      }
    }
  }
}

// Webhook handler untuk Vercel - FIXED VERSION
module.exports = async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));
  
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
      // Process new chat members (using chat_member event)
      else if (update.chat_member) {
        const chatMember = update.chat_member;
        if (chatMember.old_chat_member.user.is_bot === false && 
            chatMember.new_chat_member.status === 'member') {
          await processMessage({
            chat: chatMember.chat,
            new_chat_members: [chatMember.new_chat_member]
          });
        }
      }
      // Process my_chat_member event
      else if (update.my_chat_member) {
        const chatMember = update.my_chat_member;
        if (chatMember.old_chat_member.user.is_bot === false && 
            chatMember.new_chat_member.status === 'member') {
          await processMessage({
            chat: chatMember.chat,
            new_chat_members: [chatMember.new_chat_member]
          });
        }
      }
    }
    
    // Handle scheduled tasks via query parameter
    if (req.query.task) {
      switch (req.query.task) {
        case 'morning':
          await sendMorningMessage();
          return res.status(200).send('Morning message sent');
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

    // Di dalam module.exports, tambahkan ini:
if (req.query.task) {
  switch (req.query.task) {
    case 'morning':
      await sendMorningMessage();
      return res.status(200).send('Morning message sent');
    case 'news':
      await sendScheduledNews();
      return res.status(200).send('News sent');
    case 'sessions':
      // Handle all sessions based on hour parameter
      const hour = new Date().getHours();
      if (hour === 5) {
        await sendSessionNotification('sydney');
      } else if (hour === 7) {
        await sendSessionNotification('tokyo');
      } else if (hour === 13) {
        await sendSessionNotification('london');
      } else if (hour === 20) {
        await sendSessionNotification('newyork');
      }
      return res.status(200).send('Session notifications sent');
  }
}
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(500).send('Error');
  }
};
