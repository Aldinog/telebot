const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const Parser = require('rss-parser');
// Load config dari environment variable
const config = JSON.parse(process.env.CONFIG_JSON || '{}');
// Initialize bot untuk webhook
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
// RSS Parser ---
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
const detectSpam = (text, entities = null) => {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Expanded promo keywords list
  const promoKeywords = [
    'promo', 'diskon', 'jual', 'beli', 'harga', 'pembelian', 'order', 'pesan',
    'contact', 'admin', 'whatsapp', 'wa', 'telegram', 't.me', 'link',
    'ea', 'robot', 'trading', 'forex', 'profit', 'keuntungan', 'penghasilan',
    'signal', 'grup', 'join', 'bergabung', 'member', 'premium', 'vip',
    'gratis', 'free', 'bonus', 'cashback', 'rebate', 'komisi',
    'broker', 'deposit', 'withdraw', 'wd', 'dp', 'investasi', 'invest',
    'modal', 'dana', 'uang', 'income', 'menghasilkan', 'cuan',
    'strategy', 'strategi', 'indikator', 'analisa', 'teknikal', 'fundamental',
    'akun', 'cent', 'ecn', 'standart', 'bebas broker', 'support semua pair', 'sinyal',
    'update', 'super', 'logic', 'martinggle', 'recomendasi', 'instalasi', 'konsultasi',
    'pemula', 'expert', 'drowdown', 'profitable', 'ghautamafx'
  ];
  
  // Count promo keywords
  const keywordCount = promoKeywords.filter(keyword => lowerText.includes(keyword)).length;
  console.log(`Promo keyword count: ${keywordCount}`);
  
  // IMMEDIATE SPAM DETECTION CRITERIA:
  
  // 1. Any hidden link (text_link) is automatically spam unless it's in allowed domains
  if (entities && entities.length > 0) {
    for (const entity of entities) {
      if (entity.type === 'text_link' && entity.url) {
        console.log(`Found hidden link: ${entity.url}`);
        
        // Extract domain from the hidden link
        let domain = entity.url;
        if (domain.startsWith('http://') || domain.startsWith('https://')) {
          domain = domain.replace(/^https?:\/\//, '');
        }
        if (domain.startsWith('www.')) {
          domain = domain.substring(4);
        }
        domain = domain.split('/')[0];
        
        console.log(`Hidden link domain: ${domain}`);
        
        // Check if domain is in suspicious domains
        if (config.suspiciousDomains.some(suspicious => domain.includes(suspicious))) {
          console.log(`Hidden link domain ${domain} is suspicious - SPAM`);
          return true;
        }
        
        // Check if domain is NOT in allowed domains
        if (!config.allowedDomains.some(allowed => domain.includes(allowed))) {
          console.log(`Hidden link domain ${domain} not in allowed domains - SPAM`);
          return true;
        }
        
        // Even if domain is allowed, if there are promo keywords, it's spam
        if (keywordCount >= 1) {
          console.log(`Hidden link with promo keywords - SPAM`);
          return true;
        }
      }
      
      // Check for url entities (visible URLs)
      if (entity.type === 'url') {
        // Extract the URL from the text using entity offset and length
        const urlText = text.substring(entity.offset, entity.offset + entity.length);
        console.log(`Found URL entity: ${urlText}`);
        
        let domain = urlText;
        
        // Remove protocol if present
        if (domain.startsWith('http://') || domain.startsWith('https://')) {
          domain = domain.replace(/^https?:\/\//, '');
        }
        
        // Remove www. if present
        if (domain.startsWith('www.')) {
          domain = domain.substring(4);
        }
        
        // Extract domain part (before first slash)
        domain = domain.split('/')[0];
        
        console.log(`URL entity domain extracted: ${domain}`);
        
        // Check if domain is in suspicious domains
        if (config.suspiciousDomains.some(suspicious => domain.includes(suspicious))) {
          console.log(`URL entity domain ${domain} found in suspicious domains list`);
          return true;
        }
        
        // Check if domain is NOT in allowed domains
        if (!config.allowedDomains.some(allowed => domain.includes(allowed))) {
          console.log(`URL entity domain ${domain} not in allowed domains list`);
          return true;
        }
      }
      
      // Check for mention entities (@username) that might be used for promotion
      if (entity.type === 'mention') {
        const mention = text.substring(entity.offset, entity.offset + entity.length);
        console.log(`Found mention entity: ${mention}`);
        
        // If mention + any promo keyword = spam
        if (keywordCount >= 1) {
          console.log(`Mention with promo keywords - SPAM`);
          return true;
        }
      }
      
      // Check for bold, italic, or other formatting that might be used for promotion
      if (entity.type === 'bold' || entity.type === 'italic') {
        const formattedText = text.substring(entity.offset, entity.offset + entity.length);
        
        // Check if formatted text contains promo keywords
        if (promoKeywords.some(keyword => formattedText.toLowerCase().includes(keyword))) {
          console.log(`Formatted text with promo keywords - SPAM`);
          return true;
        }
      }
    }
  }
  
  // 2. Check for suspicious domains in text
  for (const domain of config.suspiciousDomains) {
    if (lowerText.includes(domain)) {
      console.log(`Suspicious domain found in text: ${domain} - SPAM`);
      return true;
    }
  }
  
  // 3. Check for URLs in text
  const urlPattern = /(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|telegram\.me\/|bit\.ly\/|goo\.gl\/|discord\.gg\/|facebook\.com\/|instagram\.com\/|twitter\.com\/)[^\s]+/g;
  const urls = text.match(urlPattern);
  
  if (urls) {
    for (const url of urls) {
      let domain = url;
      
      if (url.startsWith('http://') || url.startsWith('https://')) {
        domain = url.replace(/^https?:\/\//, '');
      }
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }
      domain = domain.split('/')[0];
      
      console.log(`Found URL: ${url}, domain: ${domain}`);
      
      // Check if domain is suspicious
      if (config.suspiciousDomains.some(suspicious => domain.includes(suspicious))) {
        console.log(`URL domain ${domain} is suspicious - SPAM`);
        return true;
      }
      
      // Check if domain is NOT in allowed domains
      if (!config.allowedDomains.some(allowed => domain.includes(allowed))) {
        console.log(`URL domain ${domain} not in allowed domains - SPAM`);
        return true;
      }
    }
  }
  
  // 4. Check for domain patterns without protocol
  const domainPattern = /\b[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}\b/g;
  const domains = text.match(domainPattern);
  
  if (domains) {
    for (const domain of domains) {
      console.log(`Found domain pattern: ${domain}`);
      
      // Check if domain is suspicious
      if (config.suspiciousDomains.some(suspicious => domain.includes(suspicious))) {
        console.log(`Domain pattern ${domain} is suspicious - SPAM`);
        return true;
      }
      
      // Check if domain is NOT in allowed domains
      if (!config.allowedDomains.some(allowed => domain.includes(allowed))) {
        console.log(`Domain pattern ${domain} not in allowed domains - SPAM`);
        return true;
      }
    }
  }
  
  // 5. AGGRESSIVE PROMO KEYWORD DETECTION
  // Lower threshold for promo keywords
  if (keywordCount >= 2) {
    console.log(`High promo keyword count (${keywordCount}) - SPAM`);
    return true;
  }
  
  // 6. SPECIFIC SPAM PATTERNS
  const spamPatterns = [
    /contact\s+(admin|wa|whatsapp|telegram)/i,
    /hubungi\s+(admin|wa|whatsapp|telegram)/i,
    /klik\s+(link|di\s+sini)/i,
    /join\s+(grup|group)/i,
    /daftar\s+(sekarang|now)/i,
    /pembelian\s+ea/i,
    /ea\s+(super|robot|trading)/i,
    /update\s+ea/i,
    /logic\s+ea/i,
    /martinggle/i,
    /support\s+semua\s+pair/i,
    /bebas\s+broker/i,
    /free\s+instalasi/i,
    /hati-hati\s+penipuan/i,
    /ghautamafx/i
  ];
  
  for (const pattern of spamPatterns) {
    if (pattern.test(lowerText)) {
      console.log(`Spam pattern matched: ${pattern} - SPAM`);
      return true;
    }
  }
  
  console.log(`Final result: NOT SPAM (keyword count: ${keywordCount})`);
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
      forex: 'https://www.investing.com/rss/news.r
