process.env.ADMIN_ID = "100";
const { Telegram } = require("telegraf");
const { bot, WELCOME_TEXT, NETWORK_TEXT, welcomeKeyboard, dashboardKeyboard, networkKeyboard, getState, SECURITY_COMPLETE_TEXT, NETWORK_GRID_TEXT, securityCompleteKeyboard, SOL_PRICE, MOCK_TRADERS, swapPairKeyboard, withdrawTokenKeyboard, stakeTokenKeyboard, copyTradersKeyboard, copyTradeKeyboard, dcaKeyboard, buyTokenKeyboard, sellTokenKeyboard, alertsKeyboard, ETH_PRICE, backKeyboard, registeredUsers } = require("./src/index");

let msgId = 0;
const calls = [];

const proto = Telegram.prototype;
proto.callApi = async function (method, payload) {
  calls.push({ method, payload });
  switch (method) {
    case "getMe":
      return { id: 1, is_bot: true, first_name: "Test", username: "testbot" };
    case "sendMessage":
      return { message_id: ++msgId, chat: { id: payload.chat_id, type: "private" }, date: 0, text: payload.text };
    case "sendPhoto":
      return {
        message_id: ++msgId,
        chat: { id: payload.chat_id, type: "private" },
        date: 0,
        photo: [{ file_id: "file_" + msgId, file_unique_id: "fu_" + msgId, width: 640, height: 480 }],
      };
    case "answerCallbackQuery":
    case "editMessageMedia":
    case "editMessageReplyMarkup":
    case "deleteMessage":
      return true;
    default:
      return true;
  }
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function last() {
  return calls[calls.length - 1];
}
function lastMethod() {
  return last()?.method;
}
function lastCaption() {
  const c = last();
  if (!c) return undefined;
  if (c.method === "sendPhoto") return c.payload?.caption;
  if (c.method === "editMessageMedia") return c.payload?.media?.caption;
  if (c.method === "sendMessage") return c.payload?.text;
  return undefined;
}
function lastKeyboard() {
  const c = last();
  if (!c) return undefined;
  return c.payload?.reply_markup;
}
function lastPhoto() {
  const c = last();
  if (!c) return undefined;
  if (c.method === "sendPhoto") return c.payload?.photo;
  if (c.method === "editMessageMedia") return c.payload?.media?.media;
  return undefined;
}

function reset() {
  calls.length = 0;
  msgId = 0;
}

function userMessage(text, chatId = 100) {
  return {
    message_id: ++msgId,
    from: { id: chatId, is_bot: false, first_name: "T", username: "t" },
    chat: { id: chatId, first_name: "T", username: "t", type: "private" },
    date: 0,
    text,
    entities: text.startsWith("/") ? [{ offset: 0, length: text.length, type: "bot_command" }] : [],
  };
}

let pass = 0;
let fail = 0;
function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log("PASS:", name);
  } else {
    fail++;
    console.log("FAIL:", name);
    console.log("  expected:", e);
    console.log("  actual:  ", a);
  }
}
function assertTruthy(name, val) {
  if (val) {
    pass++;
    console.log("PASS:", name);
  } else {
    fail++;
    console.log("FAIL:", name, "\n  expected truthy, got:", JSON.stringify(val).slice(0, 160));
  }
}

async function run() {
  reset();
  await bot.handleUpdate({ update_id: 1, message: userMessage("/start") });
  assertEq("welcome method", lastMethod(), "sendPhoto");
  assertEq("welcome caption", lastCaption(), WELCOME_TEXT);
  assertEq("welcome keyboard", lastKeyboard(), welcomeKeyboard().reply_markup);
  assertTruthy("welcome sent as photo", lastPhoto());

  reset();
  await bot.handleUpdate({ update_id: 2, message: userMessage("✨ Generate Wallet") });
  assertEq("network method", lastMethod(), "sendPhoto");
  assertEq("network caption", lastCaption(), NETWORK_TEXT);
  assertEq("network keyboard", lastKeyboard(), networkKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 3, message: userMessage("🟣 Solana") });
  const st = getState({ chat: { id: 100 } });
  assertEq("wallet caption", lastCaption(), "✅ **Solana Wallet Assigned!**\n\n🟣 **Solana**\n`" + st.address + "`\n_(Tap to Copy)_\n\nFund this wallet to start trading.");

  await delay(1700);
  reset();

  await bot.handleUpdate({ update_id: 4, message: userMessage("user@example.com") });
  assertEq("email caption", lastCaption(),
    "✅ **Email saved securely**\n\n📧 `user@example.com`\n\n🔐 **Now set your 4-digit PIN for withdrawals.**\n\n" +
    "_Enter a 4-digit number (message will be auto-deleted for security):_");

  reset();
  await bot.handleUpdate({ update_id: 5, message: userMessage("1234") });
  assertEq("pin confirm caption", lastCaption(), "🔐 **Confirm your PIN by typing it again:**\n\n_(Auto-deleted after you send)_");

  reset();
  await bot.handleUpdate({ update_id: 6, message: userMessage("1234") });
  const secState = getState({ chat: { id: 100 } });
  assertEq("security complete caption", lastCaption(), SECURITY_COMPLETE_TEXT(secState));
  assertEq("security complete keyboard", lastKeyboard(), securityCompleteKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 7, message: userMessage("🚀 Enter Dashboard") });
  assertEq("dashboard caption", lastCaption(), NETWORK_GRID_TEXT(secState));
  assertEq("dashboard keyboard", lastKeyboard(), dashboardKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 8, message: userMessage("💰 Buy") });
  assertEq("buy method", lastMethod(), "sendPhoto");
  const buyState = getState({ chat: { id: 100 } });
  const buySolUsd = buyState.solBalance * SOL_PRICE;
  const buyEthUsd = buyState.ethBalance * ETH_PRICE;
  assertEq("buy caption", lastCaption(),
    "💰 *Buy Tokens*\n\n" +
    `🟣 SOL: $${buySolUsd.toFixed(2)}\n` +
    `🔵 ETH: $${buyEthUsd.toFixed(2)}\n\n` +
    "Select token:");
  assertEq("buy keyboard", lastKeyboard(), buyTokenKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 9, message: userMessage("📊 Signal Strength") });
  assertEq("signal method", lastMethod(), "sendPhoto");
  assertEq("signal caption", String(lastCaption()).slice(0, 20), "📊 *Signal Strength*");

  reset();
  await bot.handleUpdate({ update_id: 10, message: userMessage("🔄 Swap") });
  assertEq("swap method", lastMethod(), "sendPhoto");
  assertEq("swap caption", lastCaption(), "🔄 *Swap*\n\nSelect pair:\n\nSOL → ETH\nETH → SOL");
  assertEq("swap keyboard", lastKeyboard(), swapPairKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 11, message: userMessage("SOL → ETH") });
  const swState = getState({ chat: { id: 100 } });
  const solUsd = swState.solBalance * SOL_PRICE;
  assertEq("swap sol-eth caption", lastCaption(),
    "🔄 *Swap SOL → ETH*\n\n" +
    `💵 Your SOL balance: $${solUsd.toFixed(2)}\n` +
    `⛽️ Gas requirement: $${(solUsd * 0.10).toFixed(2)} in ETH (10% of your SOL balance)\n` +
    "💵 Your ETH balance: $0.00\n\n" +
    "✅ Gas requirement met\n\n" +
    "Enter amount in USD:");

  reset();
  await bot.handleUpdate({ update_id: 12, message: userMessage("99999") });
  assertEq("insufficient caption", lastCaption(),
    "❌ *Insufficient SOL balance.*\n\n" +
    `💵 You have: $${solUsd.toFixed(2)}\n` +
    "💵 Required: $99999.00\n\n" +
    "Please enter a lower amount.");

  reset();
  await bot.handleUpdate({ update_id: 14, message: userMessage("💸 Withdraw") });
  assertEq("withdraw method", lastMethod(), "sendPhoto");
  assertEq("withdraw caption", lastCaption(), "💸 *Withdraw*\n\nSelect token:\n\nsol\neth");
  assertEq("withdraw keyboard", lastKeyboard(), withdrawTokenKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 18, message: userMessage("💎 Stake") });
  assertEq("stake method", lastMethod(), "sendPhoto");
  assertEq("stake caption", lastCaption(), "📊 *Staking*\n\n🟣 SOL 5.5% APY\n🔵 ETH 4.2% APY\n\nSelect token:\n\nsol\neth");
  assertEq("stake keyboard", lastKeyboard(), stakeTokenKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 22, message: userMessage("👥 Copy Trade") });
  assertEq("copy method", lastMethod(), "sendPhoto");
  const expectedTraders = MOCK_TRADERS.map((t, i) =>
    `${i + 1}. ${t.avatar} ${t.name.replace(/@/g, "").replace(/_/g, "\\_")} — ${t.trade.token} ${t.trade.action === "BUY" ? "↑" : "↓"} ${t.timeframe}`
  ).join("\n");
  assertEq("copy caption", lastCaption(),
    "👥 *Copy Trading*\n\nFollow traders and mirror their trades:\n\n" +
    expectedTraders +
    "\n\nSelect a trader to copy:");
  assertEq("copy keyboard", lastKeyboard(), copyTradersKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 23, message: userMessage(`${MOCK_TRADERS[0].avatar} ${MOCK_TRADERS[0].name}`) });
  const t1 = MOCK_TRADERS[0];
  assertEq("trader1 detail caption", lastCaption(),
    `👥 *${t1.name.replace(/@/g, "").replace(/_/g, "\\_")}*\n\n` +
    `📊 *Trade: ${t1.trade.action} ${t1.trade.token}*\n` +
    `💰 Amount: $${t1.trade.amount.toFixed(2)}\n` +
    `⚡ Entry: $${t1.trade.entry.toFixed(4)}\n` +
    `🎯 Target: $${t1.trade.target.toFixed(2)}\n` +
    `🛑 Stop Loss: $${t1.trade.stopLoss.toFixed(2)}\n\n` +
    `_Timeframe: ${t1.timeframe}_`);
  assertEq("trader1 keyboard", lastKeyboard(), copyTradeKeyboard(t1.id).reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 24, message: userMessage("📋 Copy This Trade") });
  assertEq("copy confirm caption", lastCaption(),
    "✅ *Trade Copied!*\n\n" +
    `📊 *Copied: ${t1.trade.action} ${t1.trade.token}*\n` +
    `💰 Amount: $${t1.trade.amount.toFixed(2)}\n` +
    `⚡ Entry: $${t1.trade.entry.toFixed(4)}\n` +
    `🎯 Target: $${t1.trade.target.toFixed(2)}\n` +
    `🛑 Stop Loss: $${t1.trade.stopLoss.toFixed(2)}\n\n` +
    `_You are now copying ${t1.name.replace(/@/g, "").replace(/_/g, "\\_")}'s trade._\n\n` +
    "_Copy trading is simulated in this mock._");

  reset();
  await bot.handleUpdate({ update_id: 25, message: userMessage("💳 Balance") });
  const balState = getState({ chat: { id: 100 } });
  const balSolUsd = balState.solBalance * SOL_PRICE;
  assertEq("balance caption", lastCaption(),
    "💳 *Balance*\n\n" +
    `🟣 SOL: $${balSolUsd.toFixed(2)} (≈ ${balState.solBalance.toFixed(4)} SOL)\n` +
    "🔵 ETH: $0.00 (≈ 0 ETH)\n\n" +
    `💎 Total: $${(balSolUsd + balState.usdcBalance).toFixed(2)}`);

  reset();
  await bot.handleUpdate({ update_id: 26, message: userMessage("💳 Deposit") });
  assertEq("deposit caption", lastCaption(),
    "💳 *Deposit*\n\n" +
    "Send funds to the addresses below.\n\n" +
    "🟣 SOL\n" +
    "`" + balState.address + "`\n" +
    "_(Tap to Copy)_\n\n" +
    "🔵 ETH\n" +
    "0x2f769C7250ef361E9468291eBcCE39E331047ab7\n" +
    "_(Tap to Copy)_");

  reset();
  await bot.handleUpdate({ update_id: 27, message: userMessage("📊 DCA") });
  assertEq("dca caption", lastCaption(),
    "📊 *DCA*\n\nSelect an option:\n\nNew DCA\nMy DCA plans");
  assertEq("dca keyboard", lastKeyboard(), dcaKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 28, message: userMessage("New DCA") });
  assertEq("dca new caption", lastCaption(),
    "📊 *New DCA*\n\n" +
    "Step 1/3: Enter amount in USD\n\n" +
    "💳 DCA will debit from: 🟣 Solana (SOL)\n" +
    `💵 Available: $${balSolUsd.toFixed(2)}`);

  reset();
  await bot.handleUpdate({ update_id: 29, message: userMessage("My DCA plans") });
  assertEq("dca plans caption", lastCaption(),
    "📋 *My DCA Plans*\n\nNo active plans.");

  reset();
  await bot.handleUpdate({ update_id: 30, message: userMessage("🔔 Alerts") });
  assertEq("alerts caption", lastCaption(), "🔔 *Notifications ON*\n\nTap the button below to turn OFF notifications.");
  assertEq("alerts keyboard", lastKeyboard(), alertsKeyboard(getState({ chat: { id: 100 } })).reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 301, message: userMessage("🔕 Notifications OFF") });
  assertEq("alerts toggled caption", lastCaption(), "🔔 *Notifications OFF*\n\nTap the button below to turn ON notifications.");

  reset();
  await bot.handleUpdate({ update_id: 31, message: userMessage("🧾 Trades") });
  assertEq("trades caption", lastCaption(), "📜 *Trades*\n\nNo recent trades.");

  reset();
  await bot.handleUpdate({ update_id: 33, message: userMessage("📜 History") });
  assertEq("history caption", lastCaption(), "📋 *Withdrawal History*\n\nNo withdrawals yet.");

  reset();
  await bot.handleUpdate({ update_id: 34, message: userMessage("👥 Referral") });
  assertEq("referral caption", lastCaption(),
    "👥 *Referral*\n\n" +
    "🔑 Your code: 8c6615f0\n\n" +
    "💎 Tier 1: 35%\n" +
    "💎 Tier 2: 25%");

  reset();
  await bot.handleUpdate({ update_id: 35, message: userMessage("🎟️ Support") });
  assertEq("support caption", lastCaption(),
    "🎟️ Support\n\n" +
    "📱 Telegram: @tradebots_support");
  assertEq("support keyboard", lastKeyboard(), backKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 36, message: userMessage("📈 Portfolio") });
  assertEq("portfolio caption", lastCaption(),
    "📈 *Portfolio*\n\n" +
    `🟣 SOL — $${balSolUsd.toFixed(2)} (≈ ${balState.solBalance.toFixed(4)} SOL)\n` +
    "🔵 ETH — $0.00 (≈ 0 ETH)\n" +
    `💎 Total: $${(balSolUsd + balState.usdcBalance).toFixed(2)}\n`);

  reset();
  await bot.handleUpdate({ update_id: 37, message: userMessage("⚙️ Settings") });
  assertEq("settings caption starts with", String(lastCaption()).slice(0, 12), "⚙️ *Settings");

  reset();
  await bot.handleUpdate({ update_id: 38, message: userMessage("🏠 Main Menu") });
  assertEq("main menu caption", lastCaption(), "🏠 **Main Menu**\n\nAccount & trading options:");

  reset();
  await bot.handleUpdate({ update_id: 39, message: userMessage("🔁 Restart") });
  assertEq("restart caption", lastCaption(), WELCOME_TEXT);

  reset();
  await bot.handleUpdate({ update_id: 40, message: userMessage("✨ Generate Wallet") });

  reset();
  await bot.handleUpdate({ update_id: 41, message: userMessage("🟣 Solana") });

  await delay(1700);
  reset();

  await bot.handleUpdate({ update_id: 42, message: userMessage("test2@example.com") });
  assertEq("email saved caption", lastCaption(),
    "✅ **Email saved securely**\n\n📧 `test2@example.com`\n\n🔐 **Now set your 4-digit PIN for withdrawals.**\n\n" +
    "_Enter a 4-digit number (message will be auto-deleted for security):_");

  reset();
  await bot.handleUpdate({ update_id: 43, message: userMessage("5678") });
  assertEq("pin confirm caption", lastCaption(), "🔐 **Confirm your PIN by typing it again:**\n\n_(Auto-deleted after you send)_");

  reset();
  await bot.handleUpdate({ update_id: 44, message: userMessage("5678") });
  assertEq("security complete caption", lastCaption(), SECURITY_COMPLETE_TEXT(getState({ chat: { id: 100 } })));

  reset();
  await bot.handleUpdate({ update_id: 45, message: userMessage("🚀 Enter Dashboard") });
  assertEq("dashboard re-caption", lastCaption(), NETWORK_GRID_TEXT(getState({ chat: { id: 100 } })));
  assertEq("dashboard keyboard", lastKeyboard(), dashboardKeyboard().reply_markup);

  reset();
  await bot.handleUpdate({ update_id: 60, message: userMessage("⚙️ Settings") });

  reset();
  await bot.handleUpdate({ update_id: 70, message: userMessage("🔔 Alerts") });

  reset();
  await bot.handleUpdate({ update_id: 71, message: userMessage("🔙 Back") });
  assertEq("back from alerts caption", lastCaption(), NETWORK_GRID_TEXT(getState({ chat: { id: 100 } })));

  reset();
  await bot.handleUpdate({ update_id: 999, message: userMessage("/admin", 999) });
  assertEq("admin unauthorized", lastCaption(), "❌ You are not authorized to view this page.");

  reset();
  await bot.handleUpdate({ update_id: 1000, message: userMessage("/admin", 100) });
  const adminMsg = String(lastCaption());
  assertEq("admin authorized", adminMsg.includes("Registered Users") || adminMsg.includes("Mock User") || adminMsg.includes("@mockuser"), true);

  reset();
  await bot.handleUpdate({ update_id: 1001, callback_query: { from: { id: 100 }, message: { message_id: 1, chat: { id: 100 } }, data: "admin:toggle:slippage:999001" } });
  assertEq("admin toggle slippage", String(lastCaption()).includes("Slippage"), true);

  reset();
  await bot.handleUpdate({ update_id: 1002, callback_query: { from: { id: 100 }, message: { message_id: 1, chat: { id: 100 } }, data: "admin:toggle:autobuy:999001" } });
  assertEq("admin toggle autobuy", String(lastCaption()).includes("Auto-buy"), true);

  reset();
  await bot.handleUpdate({ update_id: 1003, callback_query: { from: { id: 100 }, message: { message_id: 1, chat: { id: 100 } }, data: "admin:toggle:mev:999001" } });
  assertEq("admin toggle mev", String(lastCaption()).includes("MEV Protection"), true);

  reset();
  await bot.handleUpdate({ update_id: 1004, callback_query: { from: { id: 100 }, message: { message_id: 1, chat: { id: 100 } }, data: "admin:remove:999001" } });
  assertEq("admin remove user", String(lastCaption()).includes("removed"), true);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error("TEST ERROR:", e); process.exit(2); });