const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const Parser = require('rss-parser');
const cron = require('node-cron');

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
      domain = domain.replace('www.', '');
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
      saham: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',
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

// Bot handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
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
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
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
});

// Allow group command - MODIFIED FOR VERCEL
bot.onText(/\/allowgroup/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  if (config.allowedGroupIds.includes(chatId)) {
    bot.sendMessage(chatId, "⚠️ Grup ini sudah ada di daftar izin!");
    return;
  }
  
  // Add to config (in memory only for Vercel)
  config.allowedGroupIds.push(chatId);
  
  // For persistence in Vercel, you would need to use a database
  // For now, we'll just acknowledge the addition
  bot.sendMessage(chatId, `✅ Grup ini telah ditambahkan ke daftar izin!\nID Grup: ${chatId}\n\n⚠️ Catatan: Perubahan hanya disimpan di memori dan akan hilang saat redeploy.`);
});

// Remove group command - MODIFIED FOR VERCEL
bot.onText(/\/removegroup (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const groupId = parseInt(match[1]);
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  if (isNaN(groupId)) {
    bot.sendMessage(chatId, "❌ ID grup harus berupa angka!");
    return;
  }
  
  const index = config.allowedGroupIds.indexOf(groupId);
  if (index !== -1) {
    config.allowedGroupIds.splice(index, 1);
    bot.sendMessage(chatId, `✅ Grup dengan ID ${groupId} telah dihapus dari daftar izin!\n\n⚠️ Catatan: Perubahan hanya disimpan di memori dan akan hilang saat redeploy.`);
  } else {
    bot.sendMessage(chatId, `⚠️ Grup dengan ID ${groupId} tidak ada di daftar izin!`);
  }
});

// List groups command
bot.onText(/\/listgroups/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  if (config.allowedGroupIds.length > 0) {
    const groupsText = config.allowedGroupIds.map(id => `• ${id}`).join('\n');
    bot.sendMessage(chatId, `📝 Grup yang diizinkan:\n${groupsText}`);
  } else {
    bot.sendMessage(chatId, "📝 Tidak ada grup di daftar izin");
  }
});

// Group ID command
bot.onText(/\/groupid/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🆔 ID Grup ini: ${chatId}`, { parse_mode: 'Markdown' });
});

// Test individual USD feeds
bot.onText(/\/testusd/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  // Multiple USD feed options to test
  const usdFeeds = [
    { name: 'Yahoo Finance USD', url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=USD&region=US&lang=en-US' },
    { name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news' },
    { name: 'DailyFX', url: 'https://www.dailyfx.com/rss' },
    { name: 'ForexLive', url: 'https://www.forexlive.com/rss' },
    { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews' },
    { name: 'CNN Money', url: 'https://rss.cnn.com/rss/money_news_international.rss' },
    { name: 'Bloomberg', url: 'https://www.bloomberg.com/feed' },
    { name: 'Investing.com USD', url: 'https://www.investing.com/rss/news_19.rss' }
  ];
  
  let testResults = "🧪 Hasil Test USD Feeds:\n\n";
  
  for (const feed of usdFeeds) {
    try {
      console.log(`Testing ${feed.name}: ${feed.url}`);
      await parser.parseURL(feed.url);
      testResults += `✅ ${feed.name}: BERHASIL\n`;
    } catch (error) {
      testResults += `❌ ${feed.name}: GAGAL (${error.message})\n`;
    }
  }
  
  bot.sendMessage(chatId, testResults);
});

// Simple news command for testing individual feeds
bot.onText(/\/testnews (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const feedType = match[1].toLowerCase();
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  const testFeeds = {
    forex: 'https://www.investing.com/rss/news.rss',
    saham: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',
    usd: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=USD&region=US&lang=en-US'
  };
  
  if (!testFeeds[feedType]) {
    bot.sendMessage(chatId, "❌ Feed type tidak valid. Gunakan: forex, saham, atau usd");
    return;
  }
  
  try {
    bot.sendMessage(chatId, `🧪 Menguji ${feedType} feed...`);
    const feed = await parser.parseURL(testFeeds[feedType]);
    const news = feed.items.slice(0, 3).map(item => `📰 ${item.title}\n${item.link}`).join('\n\n');
    await bot.sendMessage(chatId, `✅ ${feedType.toUpperCase()} Feed berhasil:\n\n${news}`, {
      disable_web_page_preview: true
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Gagal mengambil ${feedType} feed: ${error.message}`);
  }
});

// Manual news command - SINGLE VERSION
bot.onText(/\/news/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  // Check if group is allowed
  if (!isAllowedGroup(chatId)) {
    bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
    return;
  }
  
  // Try the alternative news function with working feeds
  await sendNewsAlternative(chatId);
});

// Add command to check RSS feed configuration
bot.onText(/\/checkfeeds/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  let feedStatus = "📊 Status RSS Feeds:\n\n";
  
  if (config.rssFeeds) {
    feedStatus += "🔹 Konfigurasi saat ini:\n";
    feedStatus += `Forex: ${config.rssFeeds.forex || 'Tidak diatur'}\n`;
    feedStatus += `Saham: ${config.rssFeeds.saham || 'Tidak diatur'}\n`;
    feedStatus += `USD: ${config.rssFeeds.usd || 'Tidak diatur'}\n\n`;
  } else {
    feedStatus += "❌ Tidak ada konfigurasi RSS feeds di config.json\n\n";
  }
  
  feedStatus += "💡 Tips:\n";
  feedStatus += "• Gunakan /testnews forex untuk mengetes feed forex\n";
  feedStatus += "• Gunakan /testnews saham untuk mengetes feed saham\n";
  feedStatus += "• Gunakan /testnews usd untuk mengetes feed USD\n";
  feedStatus += "• Gunakan /testusd untuk mengetes semua feed USD\n";
  feedStatus += "• Pastikan URL feed valid dan dapat diakses";
  
  bot.sendMessage(chatId, feedStatus);
});

// Manual session command - FIXED VERSION
bot.onText(/\/session(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const sessionParam = match[1] ? match[1].trim().toLowerCase() : '';
  
  console.log(`Session command triggered. User: ${userId}, Chat: ${chatId}, Param: "${sessionParam}"`);
  
  // Check if user is admin
  const adminCheck = await isAdmin(chatId, userId);
  console.log(`Admin check: ${adminCheck}`);
  
  if (!adminCheck) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  // Check if group is allowed
  const groupAllowed = isAllowedGroup(chatId);
  console.log(`Group allowed: ${groupAllowed}`);
  
  if (!groupAllowed) {
    bot.sendMessage(chatId, "❌ Grup ini tidak diizinkan! Gunakan /allowgroup terlebih dahulu.");
    return;
  }
  
  // If no session parameter provided, show help
  if (!sessionParam) {
    bot.sendMessage(chatId, 
      "📋 Sesi Trading yang tersedia:\n\n" +
      "• /session sydney - Sesi Sydney\n" +
      "• /session tokyo - Sesi Tokyo\n" +
      "• /session london - Sesi London\n" +
      "• /session newyork - Sesi New York\n\n" +
      "Silakan pilih sesi yang ingin dikirim!"
    );
    return;
  }
  
  console.log(`Processing session: ${sessionParam}`);
  
  try {
    switch (sessionParam) {
      case 'sydney':
        console.log('Sending Sydney session notification');
        await bot.sendMessage(chatId, 
          "🇦🇺 Sesi Sydney Dimulai!\n\n" +
          "Waktu: 05:00 - 14:00 WIB\n" +
          "Fokus: AUD, NZD pairs\n\n" +
          "Selamat bertrading! 🚀"
        );
        break;
      case 'tokyo':
        console.log('Sending Tokyo session notification');
        await bot.sendMessage(chatId, 
          "🇯🇵 Sesi Tokyo Dimulai!\n\n" +
          "Waktu: 07:00 - 16:00 WIB\n" +
          "Fokus: JPY pairs\n\n" +
          "Selamat bertrading! 🚀"
        );
        break;
      case 'london':
        console.log('Sending London session notification');
        await bot.sendMessage(chatId, 
          "🇬🇧 Sesi London Dimulai!\n\n" +
          "Waktu: 13:00 - 22:00 WIB\n" +
          "Fokus: EUR, GBP pairs\n\n" +
          "Selamat bertrading! 🚀"
        );
        break;
      case 'newyork':
      case 'new york':
        console.log('Sending New York session notification');
        await bot.sendMessage(chatId, 
          "🇺🇸 Sesi New York Dimulai!\n\n" +
          "Waktu: 20:00 - 05:00 WIB (esoknya)\n" +
          "Fokus: USD, CAD pairs\n\n" +
          "Selamat bertrading! 🚀"
        );
        break;
      default:
        console.log(`Unknown session: ${sessionParam}`);
        bot.sendMessage(chatId, 
          "❌ Sesi tidak dikenal: " + sessionParam + "\n\n" +
          "Sesi yang tersedia:\n" +
          "• sydney\n" +
          "• tokyo\n" +
          "• london\n" +
          "• newyork\n\n" +
          "Contoh: /session sydney"
        );
    }
  } catch (error) {
    console.error('Error sending session notification:', error);
    bot.sendMessage(chatId, "❌ Terjadi kesalahan saat mengirim notifikasi sesi.");
  }
});

// Also add a simple handler for just /session without parameters
bot.onText(/^\/session$/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  bot.sendMessage(chatId, 
    "📋 Sesi Trading yang tersedia:\n\n" +
    "• /session sydney - Sesi Sydney\n" +
    "• /session tokyo - Sesi Tokyo\n" +
    "• /session london - Sesi London\n" +
    "• /session newyork - Sesi New York\n\n" +
    "Silakan pilih sesi yang ingin dikirim!"
  );
});

// Mute command
bot.onText(/\/mute/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  let targetUserId;
  let targetUsername;
  
  if (msg.reply_to_message) {
    targetUserId = msg.reply_to_message.from.id;
    targetUsername = msg.reply_to_message.from.username || `User_${msg.reply_to_message.from.id}`;
  } else if (msg.text.includes('@')) {
    const usernameMatch = msg.text.match(/@(\w+)/);
    if (usernameMatch) {
      targetUsername = usernameMatch[1];
      // Get user ID from username (requires additional API call)
      try {
        const chatMembers = await bot.getChatAdministrators(chatId);
        const admin = chatMembers.find(member => member.user.username === targetUsername);
        if (admin) {
          targetUserId = admin.user.id;
        } else {
          bot.sendMessage(chatId, "❌ User tidak ditemukan di grup ini!");
          return;
        }
      } catch (error) {
        console.error('Error finding user by username:', error);
        bot.sendMessage(chatId, "❌ Gagal menemukan user!");
        return;
      }
    }
  } else {
    bot.sendMessage(chatId, "❌ Balas pesan user yang ingin di-mute atau sebut username dengan format /mute @username");
    return;
  }
  
  try {
    await muteUser(chatId, targetUserId);
    bot.sendMessage(chatId, `✅ @${targetUsername} telah di-mute selama 10 menit!`);
    // Delete the command message
    deleteMessage(chatId, msg.message_id);
  } catch (error) {
    console.error('Error muting user:', error);
    bot.sendMessage(chatId, `❌ Gagal mute user: ${error.message}`);
  }
});

// Ban command
bot.onText(/\/ban/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!await isAdmin(chatId, userId)) {
    bot.sendMessage(chatId, "❌ Hanya admin yang bisa menggunakan perintah ini!");
    return;
  }
  
  let targetUserId;
  let targetUsername;
  
  if (msg.reply_to_message) {
    targetUserId = msg.reply_to_message.from.id;
    targetUsername = msg.reply_to_message.from.username || `User_${msg.reply_to_message.from.id}`;
  } else if (msg.text.includes('@')) {
    const usernameMatch = msg.text.match(/@(\w+)/);
    if (usernameMatch) {
      targetUsername = usernameMatch[1];
      // Get user ID from username (requires additional API call)
      try {
        const chatMembers = await bot.getChatAdministrators(chatId);
        const admin = chatMembers.find(member => member.user.username === targetUsername);
        if (admin) {
          targetUserId = admin.user.id;
        } else {
          bot.sendMessage(chatId, "❌ User tidak ditemukan di grup ini!");
          return;
        }
      } catch (error) {
        console.error('Error finding user by username:', error);
        bot.sendMessage(chatId, "❌ Gagal menemukan user!");
        return;
      }
    }
  } else {
    bot.sendMessage(chatId, "❌ Balas pesan user yang ingin di-ban atau sebut username dengan format /ban @username");
    return;
  }
  
  try {
    await banUser(chatId, targetUserId);
    bot.sendMessage(chatId, `✅ @${targetUsername} telah di-ban!`);
    // Delete the command message
    deleteMessage(chatId, msg.message_id);
  } catch (error) {
    console.error('Error banning user:', error);
    bot.sendMessage(chatId, `❌ Gagal ban user: ${error.message}`);
  }
});

// Handle new chat members (welcome)
bot.on('new_chat_members', async (msg) => {
  const chatId = msg.chat.id;
  
  for (const member of msg.new_chat_members) {
    if (!member.is_bot) {
      const username = member.username || `User_${member.id}`;
      const welcomeText = 
        `🎉 Selamat datang di grup kami, @${username}!\n\n` +
        `📌 Silakan baca peraturan grup:\n` +
        `1. Dilarang spam/promosi tanpa izin admin\n` +
        `2. Hormati semua anggota\n` +
        `3. Gunakan bahasa yang sopan\n\n` +
        `Jika ada pertanyaan, hubungi admin!`;
      
      bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
    }
  }
});

// Handle all messages for spam detection
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Skip if message is from bot or in private chat
  if (msg.from.is_bot || chatId === userId) {
    return;
  }
  
  // Check if group is allowed
  if (!isAllowedGroup(chatId)) {
    return;
  }
  
  // Skip if user is admin
  if (await isAdmin(chatId, userId)) {
    return;
  }
  
  // Check for spam/promo/link
  let text = msg.text;
  if (msg.caption) {
    text = msg.caption;
  }
  
  if (detectSpam(text)) {
    // Delete the message
    deleteMessage(chatId, msg.message_id);
    
    // Mute the user for 10 minutes
    muteUser(chatId, userId);
    
    // Send warning
    const username = msg.from.username || `User_${msg.from.id}`;
    bot.sendMessage(chatId, 
      `⚠️ @${username} pesan dihapus dan di-mute 10 menit!\n` +
      `Alasan: Mengandung promosi/link/spam\n\n` +
      `📌 Peraturan grup:\n` +
      `• Dilarang promosi grup lain\n` +
      `• Dilarang posting link tanpa izin admin\n` +
      `• Hormati semua anggota grup`
    );
  }
});

// Webhook handler untuk Vercel - FIXED VERSION
module.exports = async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));
  
  try {
    // Handle update dari Telegram
    if (req.body) {
      // Process the update manually
      const update = req.body;
      
      // Trigger the appropriate event based on the update type
      if (update.message) {
        bot.emit('message', update.message);
      } else if (update.edited_message) {
        bot.emit('edited_message', update.edited_message);
      } else if (update.channel_post) {
        bot.emit('channel_post', update.channel_post);
      } else if (update.edited_channel_post) {
        bot.emit('edited_channel_post', update.edited_channel_post);
      } else if (update.callback_query) {
        bot.emit('callback_query', update.callback_query);
      } else if (update.inline_query) {
        bot.emit('inline_query', update.inline_query);
      } else if (update.chosen_inline_result) {
        bot.emit('chosen_inline_result', update.chosen_inline_result);
      } else if (update.shipping_query) {
        bot.emit('shipping_query', update.shipping_query);
      } else if (update.pre_checkout_query) {
        bot.emit('pre_checkout_query', update.pre_checkout_query);
      } else if (update.poll) {
        bot.emit('poll', update.poll);
      } else if (update.poll_answer) {
        bot.emit('poll_answer', update.poll_answer);
      } else if (update.my_chat_member) {
        bot.emit('my_chat_member', update.my_chat_member);
      } else if (update.chat_member) {
        bot.emit('chat_member', update.chat_member);
      } else if (update.chat_join_request) {
        bot.emit('chat_join_request', update.chat_join_request);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling update:', error);
    res.status(500).send('Error');
  }
};
