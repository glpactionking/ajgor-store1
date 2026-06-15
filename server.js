/**
 * ================================
 * AJGOR KEY STORE - FULL SYSTEM
 * ================================
 * Product → Duration Select → Price → QR Pay → VC Verify → Key Deliver
 * Wallet Add → QR Pay → VC Verify → Balance Credit
 */

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json());

// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
const CONFIG = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || "8658966276:AAGpUJpg54hUu7-8I1tUE1dDNTMaePiRobM",
  VC_API_KEY:     process.env.VC_API_KEY     || "PAY91646C96F5A3C5427A811042",
  VC_API_URL:     "https://vcapi.vcstore.site/payment_api.php",
  UPI_ID:         process.env.UPI_ID         || "glpactionking-4@okhdfcbank",
  UPI_NAME:       "AJGOR ALI",
  ADMIN_CHAT_ID:  process.env.ADMIN_CHAT_ID  || "8013912448",
  MIN_WALLET:     10,
  MAX_WALLET:     10000,
  PORT:           process.env.PORT           || 3000,
};

// ════════════════════════════════════════
// DATABASE
// ════════════════════════════════════════
const DB_FILE = "./db.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = {
      // Products with durations
      products: [
        {
          id: 1,
          name: "Premium Key",
          description: "Full access premium key",
          durations: [
            { id: "1d",  label: "1 Day",   price: 81,   stock: 10, keys: [] },
            { id: "3d",  label: "3 Days",  price: 180,  stock: 10, keys: [] },
            { id: "7d",  label: "7 Days",  price: 360,  stock: 10, keys: [] },
            { id: "15d", label: "15 Days", price: 630,  stock: 10, keys: [] },
            { id: "30d", label: "30 Days", price: 900,  stock: 10, keys: [] },
          ]
        },
        {
          id: 2,
          name: "Basic Key",
          description: "Basic access key",
          durations: [
            { id: "1d",  label: "1 Day",   price: 50,   stock: 10, keys: [] },
            { id: "7d",  label: "7 Days",  price: 299,  stock: 10, keys: [] },
            { id: "30d", label: "30 Days", price: 799,  stock: 10, keys: [] },
          ]
        },
        {
          id: 3,
          name: "VIP Key",
          description: "VIP premium access",
          durations: [
            { id: "7d",  label: "7 Days",   price: 499,  stock: 5, keys: [] },
            { id: "30d", label: "30 Days",  price: 1499, stock: 5, keys: [] },
            { id: "lf",  label: "Lifetime", price: 2999, stock: 5, keys: [] },
          ]
        },
      ],
      users: {},
      orders: [],
      pendingPayments: {},
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ════════════════════════════════════════
// USER / WALLET
// ════════════════════════════════════════
function getUser(db, chatId) {
  const id = String(chatId);
  if (!db.users[id]) db.users[id] = { balance: 0, orders: [] };
  return db.users[id];
}
function getBalance(db, chatId) { return getUser(db, chatId).balance || 0; }
function addBalance(db, chatId, amount) {
  getUser(db, chatId).balance = +(getBalance(db, chatId) + Number(amount)).toFixed(2);
}
function deductBalance(db, chatId, amount) {
  getUser(db, chatId).balance = +(getBalance(db, chatId) - Number(amount)).toFixed(2);
}

// ════════════════════════════════════════
// UPI QR
// ════════════════════════════════════════
function makeQR(amount, txnId) {
  const upi =
    `upi://pay?pa=${CONFIG.UPI_ID}` +
    `&pn=${encodeURIComponent(CONFIG.UPI_NAME)}` +
    `&tid=${txnId}&tr=${txnId}` +
    `&tn=${encodeURIComponent("AJGOR Key Store")}` +
    `&am=${amount}&cu=INR`;
  return "https://quickchart.io/qr?text=" + encodeURIComponent(upi) + "&size=300&margin=2";
}

// ════════════════════════════════════════
// VC VERIFY
// ════════════════════════════════════════
async function vcVerify(orderId, amount) {
  try {
    const url = `${CONFIG.VC_API_URL}?api_key=${CONFIG.VC_API_KEY}&order_id=${encodeURIComponent(orderId)}&amount=${encodeURIComponent(amount)}`;
    const res = await axios.get(url, { timeout: 12000 });
    console.log(`[VC] ${orderId}:`, JSON.stringify(res.data));
    return res.data;
  } catch (e) {
    console.error("[VC]", e.message);
    return null;
  }
}

// ════════════════════════════════════════
// KEY
// ════════════════════════════════════════
function autoKey(prefix) {
  const s = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix || "AJGOR"}-${s()}-${s()}-${s()}-${s()}`;
}

function pickKey(db, productId, durationId) {
  const p = db.products.find(x => x.id === productId);
  if (!p) return null;
  const d = p.durations.find(x => x.id === durationId);
  if (!d) return null;
  return d.keys && d.keys.length > 0 ? d.keys.shift() : autoKey(p.name.split(" ")[0].toUpperCase());
}

// ════════════════════════════════════════
// ADMIN NOTIFY
// ════════════════════════════════════════
function adminMsg(text) {
  if (CONFIG.ADMIN_CHAT_ID !== "YOUR_CHAT_ID") {
    bot.sendMessage(CONFIG.ADMIN_CHAT_ID, text, { parse_mode: "Markdown" }).catch(() => {});
  }
}

// ════════════════════════════════════════
// BOT
// ════════════════════════════════════════
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });
const STATE = {};

// ── MAIN MENU ────────────────────────────────
function mainMenu(chatId, name) {
  const db  = loadDB();
  const bal = getBalance(db, chatId);
  bot.sendMessage(chatId,
    `👋 *Welcome${name ? " " + name : ""}!*\n\n` +
    `🏪 *AJGOR KEY STORE*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Wallet Balance:* ₹${bal.toFixed(2)}\n` +
    `━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        [{ text: "🛒 Shop — Keys Kharido", callback_data: "shop" }],
        [
          { text: "💳 Add Wallet Balance", callback_data: "wallet_add" },
          { text: "💰 My Balance",         callback_data: "my_balance" },
        ],
        [{ text: "📦 My Orders", callback_data: "my_orders" }],
        [{ text: "💬 Support",   callback_data: "support"   }],
      ]}
    }
  );
}

// ── /start ──
bot.onText(/\/start/, msg => {
  delete STATE[msg.chat.id];
  mainMenu(msg.chat.id, msg.from.first_name);
});
bot.onText(/\/balance/, msg => {
  const db = loadDB();
  bot.sendMessage(msg.chat.id, `💰 *Balance:* ₹${getBalance(db, msg.chat.id).toFixed(2)}`, { parse_mode: "Markdown" });
});
bot.onText(/\/orders/, msg => showOrders(msg.chat.id));

// ── /admin ──
bot.onText(/\/admin/, msg => {
  if (String(msg.chat.id) !== String(CONFIG.ADMIN_CHAT_ID)) {
    bot.sendMessage(msg.chat.id, "❌ *Access Denied!*", { parse_mode: "Markdown" });
    return;
  }
  adminPanel(msg.chat.id);
});

// ════════════════════════════════════════
// TEXT INPUT
// ════════════════════════════════════════
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;
  const st = STATE[chatId];
  if (!st) return;

  // ── Admin: New Product name ──
  if (st.step === "adm_new_prod_name") {
    STATE[chatId] = { step: "adm_new_prod_desc", name: text.trim() };
    bot.sendMessage(chatId, `✅ Name: *${text.trim()}*\n\n📝 Ab product description type karo:`, { parse_mode: "Markdown" });
    return;
  }

  if (st.step === "adm_new_prod_desc") {
    const db = loadDB();
    const newId = db.products.length > 0 ? Math.max(...db.products.map(p => p.id)) + 1 : 1;
    db.products.push({ id: newId, name: st.name, description: text.trim(), durations: [] });
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *Product Add Ho Gaya!*\n\n🔑 *${st.name}*\n📝 ${text.trim()}\n\nAb is product mein durations add karo.`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "➕ Duration Add Karo", callback_data: `adm_dur_add_${newId}` }],
        [{ text: "⚙️ Admin Panel",       callback_data: "adm_back"             }],
      ]}}
    );
    return;
  }

  // ── Admin: Edit Product Name ──
  if (st.step === "adm_edit_prod_name") {
    const db = loadDB();
    const p  = db.products.find(x => x.id === st.productId);
    if (!p) { bot.sendMessage(chatId, "❌ Product nahi mila."); return; }
    const oldName = p.name;
    p.name = text.trim();
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *Name Update Ho Gaya!*\n\n❌ Old: ${oldName}\n✅ New: *${p.name}*`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `adm_editprod_${st.productId}` }]] }}
    );
    return;
  }

  // ── Admin: Edit Product Description ──
  if (st.step === "adm_edit_prod_desc") {
    const db = loadDB();
    const p  = db.products.find(x => x.id === st.productId);
    if (!p) { bot.sendMessage(chatId, "❌ Product nahi mila."); return; }
    p.description = text.trim();
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *Description Update Ho Gayi!*\n\n📝 ${p.description}`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `adm_editprod_${st.productId}` }]] }}
    );
    return;
  }

  // ── Admin: New Duration - label ──
  if (st.step === "adm_new_dur_label") {
    STATE[chatId] = { ...st, step: "adm_new_dur_price", label: text.trim() };
    bot.sendMessage(chatId, `✅ Label: *${text.trim()}*\n\n💰 Ab price type karo (sirf number, e.g. 299):`, { parse_mode: "Markdown" });
    return;
  }

  if (st.step === "adm_new_dur_price") {
    const price = Number(text.trim());
    if (!price || price < 1) { bot.sendMessage(chatId, "❌ Valid price daalo (e.g. 299)"); return; }
    STATE[chatId] = { ...st, step: "adm_new_dur_stock", price };
    bot.sendMessage(chatId, `✅ Price: *₹${price}*\n\n📦 Ab stock type karo (e.g. 10):`, { parse_mode: "Markdown" });
    return;
  }

  if (st.step === "adm_new_dur_stock") {
    const stock = parseInt(text.trim());
    if (!stock || stock < 0) { bot.sendMessage(chatId, "❌ Valid stock daalo (e.g. 10)"); return; }
    const db  = loadDB();
    const p   = db.products.find(x => x.id === st.productId);
    if (!p) { bot.sendMessage(chatId, "❌ Product nahi mila."); return; }
    const durId = st.label.toLowerCase().replace(/\s+/g, "") + Date.now().toString().slice(-4);
    p.durations.push({ id: durId, label: st.label, price: st.price, stock, keys: [] });
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *Duration Add Ho Gaya!*\n\n🔑 Product: *${p.name}*\n⏱ Label: *${st.label}*\n💰 Price: *₹${st.price}*\n📦 Stock: *${stock}*`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "➕ Aur Duration Add Karo", callback_data: `adm_dur_add_${p.id}` }],
        [{ text: "🔑 Product Dekho",         callback_data: `adm_editprod_${p.id}` }],
        [{ text: "⚙️ Admin Panel",            callback_data: "adm_back"             }],
      ]}}
    );
    return;
  }

  // ── Admin: Edit Duration Price ──
  if (st.step === "adm_edit_dur_price") {
    const price = Number(text.trim());
    if (!price || price < 1) { bot.sendMessage(chatId, "❌ Valid price daalo (e.g. 299)"); return; }
    const db = loadDB();
    const p  = db.products.find(x => x.id === st.productId);
    const d  = p?.durations.find(x => x.id === st.durationId);
    if (!d) { bot.sendMessage(chatId, "❌ Duration nahi mila."); return; }
    const oldPrice = d.price;
    d.price = price;
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *Price Update Ho Gaya!*\n\n⏱ ${d.label}\n❌ Old: ₹${oldPrice}\n✅ New: *₹${price}*`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `adm_editdur_${st.productId}_${st.durationId}` }]] }}
    );
    return;
  }

  // ── Admin: Edit Duration Stock ──
  if (st.step === "adm_edit_dur_stock") {
    const stock = parseInt(text.trim());
    if (isNaN(stock) || stock < 0) { bot.sendMessage(chatId, "❌ Valid stock daalo (e.g. 10)"); return; }
    const db = loadDB();
    const p  = db.products.find(x => x.id === st.productId);
    const d  = p?.durations.find(x => x.id === st.durationId);
    if (!d) { bot.sendMessage(chatId, "❌ Duration nahi mila."); return; }
    d.stock = stock;
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *Stock Update Ho Gaya!*\n\n⏱ ${d.label}\n📦 New Stock: *${stock}*`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `adm_editdur_${st.productId}_${st.durationId}` }]] }}
    );
    return;
  }

  // ── Admin: Edit Duration Label ──
  if (st.step === "adm_edit_dur_label") {
    const db = loadDB();
    const p  = db.products.find(x => x.id === st.productId);
    const d  = p?.durations.find(x => x.id === st.durationId);
    if (!d) { bot.sendMessage(chatId, "❌ Duration nahi mila."); return; }
    const old = d.label;
    d.label = text.trim();
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *Label Update Ho Gaya!*\n\n❌ Old: ${old}\n✅ New: *${d.label}*`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `adm_editdur_${st.productId}_${st.durationId}` }]] }}
    );
    return;
  }

  // Admin: add keys
  if (st.step === "adm_typing_keys") {
    const lines = text.trim().split("\n").map(k => k.trim()).filter(k => k.length > 3);
    if (!lines.length) { bot.sendMessage(chatId, "❌ Valid keys nahi mili."); return; }
    const db = loadDB();
    const p  = db.products.find(x => x.id === st.productId);
    const d  = p?.durations.find(x => x.id === st.durationId);
    if (!d) { bot.sendMessage(chatId, "❌ Duration nahi mila."); return; }
    d.keys  = [...(d.keys || []), ...lines];
    d.stock = d.keys.length;
    saveDB(db);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ *${lines.length} keys add ho gayi!*\n🔑 *${p.name} - ${d.label}*\n📦 Stock: *${d.stock}*`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "⚙️ Admin Panel", callback_data: "adm_back" }]] }}
    );
    return;
  }

  // Admin: add balance - get user id
  if (st.step === "adm_addbal_uid") {
    STATE[chatId] = { step: "adm_addbal_amount", targetId: text.trim() };
    bot.sendMessage(chatId, `💰 Amount type karo for user \`${text.trim()}\`:`, { parse_mode: "Markdown" });
    return;
  }

  // Admin: add balance - get amount
  if (st.step === "adm_addbal_amount") {
    const amount = Number(text.trim());
    if (!amount || amount < 1) { bot.sendMessage(chatId, "❌ Valid amount daalo."); return; }
    const db = loadDB();
    addBalance(db, st.targetId, amount);
    saveDB(db);
    const newBal = getBalance(db, st.targetId);
    delete STATE[chatId];
    bot.sendMessage(chatId,
      `✅ ₹${amount} add ho gaya!\n👤 User: \`${st.targetId}\`\n💳 Balance: ₹${newBal.toFixed(2)}`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "⚙️ Admin", callback_data: "adm_back" }]] }}
    );
    bot.sendMessage(st.targetId, `🎁 *Admin ne ₹${amount} add kiya!*\n💳 Balance: ₹${newBal.toFixed(2)}`, { parse_mode: "Markdown" }).catch(() => {});
    return;
  }

  // Wallet custom amount
  if (st.step === "wallet_amount") {
    const amount = Number(text.trim());
    if (!amount || amount < CONFIG.MIN_WALLET) {
      bot.sendMessage(chatId, `❌ Minimum: *₹${CONFIG.MIN_WALLET}*`, { parse_mode: "Markdown" }); return;
    }
    if (amount > CONFIG.MAX_WALLET) {
      bot.sendMessage(chatId, `❌ Maximum: *₹${CONFIG.MAX_WALLET}*`, { parse_mode: "Markdown" }); return;
    }
    STATE[chatId] = { step: "wallet_pay", amount };
    await sendQR(chatId, amount, "wallet", null, null);
  }
});

// ════════════════════════════════════════
// CALLBACKS
// ════════════════════════════════════════
bot.on("callback_query", async query => {
  const chatId = query.message.chat.id;
  const data   = query.data;
  const name   = query.from.first_name;
  await bot.answerCallbackQuery(query.id);

  // Main Menu
  if (data === "main_menu") {
    delete STATE[chatId];
    mainMenu(chatId, name);
  }

  // ══════════════════════════
  // SHOP — Product List
  // ══════════════════════════
  else if (data === "shop") {
    const db   = loadDB();
    const bal  = getBalance(db, chatId);
    const rows = db.products.map(p => ([{
      text: `🔑 ${p.name}`,
      callback_data: `prod_${p.id}`
    }]));
    rows.push([{ text: "🏠 Main Menu", callback_data: "main_menu" }]);

    bot.sendMessage(chatId,
      `🛒 *Select a Product:*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 Wallet: *₹${bal.toFixed(2)}*\n` +
      `━━━━━━━━━━━━━━━━━━`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } }
    );
  }

  // ══════════════════════════
  // PRODUCT → Duration list
  // ══════════════════════════
  else if (data.startsWith("prod_")) {
    const productId = parseInt(data.replace("prod_", ""));
    const db        = loadDB();
    const p         = db.products.find(x => x.id === productId);
    const bal       = getBalance(db, chatId);
    if (!p) { bot.sendMessage(chatId, "❌ Product nahi mila."); return; }

    // Duration info text
    let infoText = `🔑 *${p.name}*\n`;
    infoText += `📝 ${p.description}\n`;
    infoText += `━━━━━━━━━━━━━━━━━━\n\n`;
    p.durations.forEach(d => {
      const inStock = d.stock > 0;
      infoText += `⏱ *${d.label}*\n`;
      infoText += `💰 ₹${d.price}\n`;
      infoText += `📦 ${inStock ? "✅ In Stock" : "❌ Out of Stock"}\n\n`;
    });
    infoText += `━━━━━━━━━━━━━━━━━━\n`;
    infoText += `👇 *Select duration below:*`;

    const rows = p.durations.map(d => ([{
      text: `📦 Buy ${d.label} — ₹${d.price} ${d.stock > 0 ? "" : "❌"}`,
      callback_data: `dur_${p.id}_${d.id}`
    }]));
    rows.push([{ text: "🔙 Back to Shop", callback_data: "shop" }]);

    bot.sendMessage(chatId, infoText, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: rows }
    });
  }

  // ══════════════════════════
  // DURATION SELECTED → Payment method
  // ══════════════════════════
  else if (data.startsWith("dur_")) {
    const parts      = data.split("_");
    const productId  = parseInt(parts[1]);
    const durationId = parts[2];
    const db         = loadDB();
    const p          = db.products.find(x => x.id === productId);
    const d          = p?.durations.find(x => x.id === durationId);
    const bal        = getBalance(db, chatId);

    if (!p || !d) { bot.sendMessage(chatId, "❌ Nahi mila."); return; }
    if (d.stock <= 0) {
      bot.sendMessage(chatId,
        `❌ *Out of Stock!*\n\n*${p.name} - ${d.label}* abhi available nahi.\nDusra duration try karo.`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `prod_${p.id}` }]] }}
      ); return;
    }

    // Payment method
    const rows = [[{ text: `💳 UPI/QR se Pay — ₹${d.price}`, callback_data: `pay_upi_${p.id}_${d.id}` }]];
    if (bal >= d.price) {
      rows.push([{ text: `💰 Wallet se Pay — Balance: ₹${bal.toFixed(2)}`, callback_data: `pay_wal_${p.id}_${d.id}` }]);
    }
    rows.push([{ text: "🔙 Back", callback_data: `prod_${p.id}` }]);

    bot.sendMessage(chatId,
      `🔑 *${p.name}*\n` +
      `⏱ Duration: *${d.label}*\n` +
      `💰 Price: *₹${d.price}*\n` +
      `📦 Stock: ${d.stock}\n` +
      `💳 Wallet: ₹${bal.toFixed(2)}\n\n` +
      `👇 *Payment method choose karo:*`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } }
    );
  }

  // ══════════════════════════
  // PAY via UPI QR
  // ══════════════════════════
  else if (data.startsWith("pay_upi_")) {
    const parts      = data.split("_");
    const productId  = parseInt(parts[2]);
    const durationId = parts[3];
    const db         = loadDB();// DATABASE
// ════════════════════════════════════════
const DB_FILE = "./db.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = {
      products: [
        { id: 1, name: "Premium Key - 1 Month",  price: 299,  stock: 10, keys: [] },
        { id: 2, name: "Premium Key - 3 Month",  price: 799,  stock: 10, keys: [] },
        { id: 3, name: "Premium Key - Lifetime", price: 1999, stock: 5,  keys: [] },
        { id: 4, name: "Bulk Pack - 10 Keys",    price: 2499, stock: 20, keys: [] },
      ],
      users: {},
      orders: [],
      pendingPayments: {},
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ════════════════════════════════════════
// USER / WALLET
// ════════════════════════════════════════
function getUser(db, chatId) {
  const id = String(chatId);
  if (!db.users[id]) db.users[id] = { balance: 0, orders: [] };
  return db.users[id];
}
function getBalance(db, chatId) {
  return getUser(db, chatId).balance || 0;
}
function addBalance(db, chatId, amount) {
  getUser(db, chatId).balance = +(getBalance(db, chatId) + Number(amount)).toFixed(2);
}
function deductBalance(db, chatId, amount) {
  getUser(db, chatId).balance = +(getBalance(db, chatId) - Number(amount)).toFixed(2);
}

// ════════════════════════════════════════
// UPI QR GENERATOR
// ════════════════════════════════════════
function makeQR(amount, txnId) {
  const upiStr =
    `upi://pay?pa=${CONFIG.UPI_ID}` +
    `&pn=${encodeURIComponent(CONFIG.UPI_NAME)}` +
    `&tid=${txnId}&tr=${txnId}` +
    `&tn=${encodeURIComponent("AJGOR Key Store")}` +
    `&am=${amount}&cu=INR`;
  return "https://quickchart.io/qr?text=" + encodeURIComponent(upiStr) + "&size=300&margin=2";
}

// ════════════════════════════════════════
// VC PAYMENT VERIFY
// ════════════════════════════════════════
async function vcVerify(orderId, amount) {
  try {
    const url =
      `${CONFIG.VC_API_URL}` +
      `?api_key=${CONFIG.VC_API_KEY}` +
      `&order_id=${encodeURIComponent(orderId)}` +
      `&amount=${encodeURIComponent(amount)}`;
    const res = await axios.get(url, { timeout: 12000 });
    console.log(`[VC] ${orderId}:`, JSON.stringify(res.data));
    return res.data;
  } catch (e) {
    console.error("[VC Error]", e.message);
    return null;
  }
}

// ════════════════════════════════════════
// KEY
// ════════════════════════════════════════
function autoKey() {
  const s = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return `AJGOR-${s()}-${s()}-${s()}-${s()}`;
}
function pickKey(db, productId) {
  const p = db.products.find(x => x.id === productId);
  if (!p) return null;
  return p.keys && p.keys.length > 0 ? p.keys.shift() : autoKey();
}

// ════════════════════════════════════════
// ADMIN NOTIFY
// ════════════════════════════════════════
function adminMsg(text) {
  if (CONFIG.ADMIN_CHAT_ID !== "YOUR_CHAT_ID") {
    bot.sendMessage(CONFIG.ADMIN_CHAT_ID, text, { parse_mode: "Markdown" }).catch(() => {});
  }
}

// ════════════════════════════════════════
// BOT
// ════════════════════════════════════════
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });
const STATE = {}; // per-user state

// ── MAIN MENU ────────────────────────────────
function mainMenu(chatId, name) {
  const db = loadDB();
  const bal = getBalance(db, chatId);
  bot.sendMessage(chatId,
    `👋 *Welcome${name ? " " + name : ""}!*\n\n` +
    `🏪 *AJGOR KEY STORE*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Balance:* ₹${bal.toFixed(2)}\n` +
    `━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        [{ text: "🛒 Buy Key (Direct)", callback_data: "shop" }],
        [
          { text: "💳 Add Wallet Balance", callback_data: "wallet_add" },
          { text: "💰 My Balance",         callback_data: "my_balance" },
        ],
        [{ text: "📦 My Orders", callback_data: "my_orders" }],
        [{ text: "💬 Support",   callback_data: "support"   }],
      ]}
    }
  );
}

bot.onText(/\/start/, msg => {
  delete STATE[msg.chat.id];
  mainMenu(msg.chat.id, msg.from.first_name);
});
bot.onText(/\/balance/, msg => {
  const db = loadDB();
  bot.sendMessage(msg.chat.id,
    `💰 *Balance:* ₹${getBalance(db, msg.chat.id).toFixed(2)}`,
    { parse_mode: "Markdown" }
  );
});
bot.onText(/\/orders/, msg => showOrders(msg.chat.id));

// ── TEXT INPUT ───────────────────────────────
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text   = msg.text;
  if (!text || text.startsWith("/")) return;

  const st = STATE[chatId];
  if (!st) return;

  // Wallet: waiting for custom amount
  if (st.step === "wallet_amount") {
    const amount = Number(text.trim());
    if (!amount || amount < CONFIG.MIN_WALLET) {
      bot.sendMessage(chatId, `❌ Minimum: *₹${CONFIG.MIN_WALLET}*`, { parse_mode: "Markdown" });
      return;
    }
    if (amount > CONFIG.MAX_WALLET) {
      bot.sendMessage(chatId, `❌ Maximum: *₹${CONFIG.MAX_WALLET}*`, { parse_mode: "Markdown" });
      return;
    }
    STATE[chatId] = { step: "wallet_pay", amount };
    await sendQR(chatId, amount, "wallet", null);
  }
});

// ── CALLBACKS ────────────────────────────────
bot.on("callback_query", async query => {
  const chatId = query.message.chat.id;
  const data   = query.data;
  const name   = query.from.first_name;
  await bot.answerCallbackQuery(query.id);

  // ── Main Menu ──
  if (data === "main_menu") {
    delete STATE[chatId];
    mainMenu(chatId, name);
  }

  // ════════════════════════════
  // SHOP — DIRECT BUY
  // ════════════════════════════
  else if (data === "shop") {
    const db  = loadDB();
    const bal = getBalance(db, chatId);

    const rows = db.products.map(p => [{
      text: `🔑 ${p.name}  ₹${p.price}  ${bal >= p.price ? "✅" : "❌"}`,
      callback_data: `product_${p.id}`
    }]);
    rows.push([{ text: "🏠 Main Menu", callback_data: "main_menu" }]);

    bot.sendMessage(chatId,
      `🛒 *Shop*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 Wallet Balance: *₹${bal.toFixed(2)}*\n\n` +
      `✅ Wallet se kharid sakte ho\n` +
      `❌ Wallet balance kam hai\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `👇 Product select karo:`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } }
    );
  }

  // ── Product selected ──
  else if (data.startsWith("product_")) {
    const productId = parseInt(data.replace("product_", ""));
    const db        = loadDB();
    const p         = db.products.find(x => x.id === productId);
    const bal       = getBalance(db, chatId);

    if (!p) { bot.sendMessage(chatId, "❌ Product nahi mila."); return; }
    if (p.stock <= 0) {
      bot.sendMessage(chatId, "❌ *Out of Stock!*\nDusra product try karo.",
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🛒 Shop", callback_data: "shop" }]] }}
      ); return;
    }

    // Payment method choose karo
    const rows = [[{ text: `💳 UPI QR se Pay (₹${p.price})`, callback_data: `pay_direct_${p.id}` }]];
    if (bal >= p.price) {
      rows.push([{ text: `💰 Wallet se Pay (Balance: ₹${bal.toFixed(2)})`, callback_data: `pay_wallet_${p.id}` }]);
    }
    rows.push([{ text: "🔙 Back", callback_data: "shop" }]);

    bot.sendMessage(chatId,
      `🔑 *${p.name}*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 Price: *₹${p.price}*\n` +
      `📦 Stock: ${p.stock}\n` +
      `💳 Wallet: ₹${bal.toFixed(2)}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `Payment method choose karo:`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: rows } }
    );
  }

  // ── DIRECT BUY via UPI QR ──
  // QR generate hoga product price ka, pay karo, VC verify, key mile
  else if (data.startsWith("pay_direct_")) {
    const productId = parseInt(data.replace("pay_direct_", ""));
    const db        = loadDB();
    const p         = db.products.find(x => x.id === productId);
    if (!p) { bot.sendMessage(chatId, "❌ Product nahi mila."); return; }

    STATE[chatId] = { step: "direct_pay", productId: p.id };
    await sendQR(chatId, p.price, "direct_buy", p.id);
  }

  // ── WALLET SE BUY ──
  else if (data.startsWith("pay_wallet_")) {
    const productId = parseInt(data.replace("pay_wallet_", ""));
    const db        = loadDB();
    const p         = db.products.find(x => x.id === productId);
    const bal       = getBalance(db, chatId);

    if (!p || bal < p.price) {
      bot.sendMessage(chatId, "❌ Balance kam hai ya product nahi mila.");
      return;
    }

    // Seedha key do — no payment needed
    await deliverFromWallet(chatId, p.id, db);
  }

  // ════════════════════════════
  // WALLET ADD
  // ════════════════════════════
  else if (data === "wallet_add") {
    bot.sendMessage(chatId,
      `💳 *Wallet Mein Balance Add Karo*\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `Min: ₹${CONFIG.MIN_WALLET}  ·  Max: ₹${CONFIG.MAX_WALLET}\n\n` +
      `Quick amount select karo ya type karo:`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [
            { text: "₹100",  callback_data: "w_100"  },
            { text: "₹200",  callback_data: "w_200"  },
            { text: "₹299",  callback_data: "w_299"  },
          ],
          [
            { text: "₹500",  callback_data: "w_500"  },
            { text: "₹799",  callback_data: "w_799"  },
            { text: "₹1000", callback_data: "w_1000" },
          ],
          [
            { text: "₹1999", callback_data: "w_1999" },
            { text: "₹2499", callback_data: "w_2499" },
            { text: "Custom Amount ✏️", callback_data: "w_custom" },
          ],
          [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
        ]}
      }
    );
  }

  // ── Quick wallet amounts ──
  else if (data.startsWith("w_")) {
    const val = data.replace("w_", "");
    if (val === "custom") {
      STATE[chatId] = { step: "wallet_amount" };
      bot.sendMessage(chatId, "✏️ *Amount type karo (₹):*", { parse_mode: "Markdown" });
    } else {
      const amount = parseInt(val);
      STATE[chatId] = { step: "wallet_pay", amount };
      await sendQR(chatId, amount, "wallet", null);
    }
  }

  // ── Check Payment ──
  else if (data.startsWith("check_")) {
    const txnId = data.replace("check_", "");
    await handleVerify(chatId, txnId);
  }

  // ── My Balance ──
  else if (data === "my_balance") {
    const db  = loadDB();
    const bal = getBalance(db, chatId);
    bot.sendMessage(chatId,
      `💰 *Tumhara Wallet Balance*\n\n` +
      `*₹${bal.toFixed(2)}*`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "💳 Add Balance", callback_data: "wallet_add" }],
          [{ text: "🏠 Main Menu",   callback_data: "main_menu"  }],
        ]}
      }
    );
  }

  // ── My Orders ──
  else if (data === "my_orders") {
    showOrders(chatId);
  }

  // ── Support ──
  else if (data === "support") {
    bot.sendMessage(chatId,
      `💬 *Support*\n\nAdmin se contact karo:\n👤 @AJGOROP`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }}
    );
  }

  // ── Cancel ──
  else if (data === "cancel") {
    delete STATE[chatId];
    bot.sendMessage(chatId, "❌ Cancel ho gaya.",
      { reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }}
    );
  }
});

// ════════════════════════════════════════
// SEND UPI QR
// type = "direct_buy" | "wallet"
// ════════════════════════════════════════
async function sendQR(chatId, amount, type, productId) {
  const txnId  = "ORD" + Date.now();
  const qrUrl  = makeQR(amount, txnId);

  // Save pending
  const db = loadDB();
  db.pendingPayments[txnId] = {
    chatId:    String(chatId),
    amount,
    type,                      // "direct_buy" or "wallet"
    productId: productId || null,
    createdAt: new Date().toISOString(),
  };
  saveDB(db);

  if (STATE[chatId]) STATE[chatId].txnId = txnId;

  const label = type === "direct_buy"
    ? "🔑 *Direct Key Purchase*"
    : "💳 *Wallet Top-Up*";

  await bot.sendPhoto(chatId, qrUrl, {
    caption:
      `╔══════════════════╗\n` +
      `   💳 *AJGOR PAYMENT*\n` +
      `╚══════════════════╝\n\n` +
      `${label}\n` +
      `💰 *Amount:* ₹${amount}\n` +
      `🆔 *Order ID:* \`${txnId}\`\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📱 *UPI ID:* \`${CONFIG.UPI_ID}\`\n\n` +
      `⚠️ Exactly *₹${amount}* pay karo.\n` +
      `Pay karne ke baad *Check Payment* dabao.\n` +
      `━━━━━━━━━━━━━━━━━━`,
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [
      [{ text: "✅ Check Payment", callback_data: `check_${txnId}` }],
      [{ text: "❌ Cancel",        callback_data: "cancel"          }],
    ]}
  });
}

// ════════════════════════════════════════
// VC VERIFY HANDLER
// ════════════════════════════════════════
async function handleVerify(chatId, txnId) {
  const db      = loadDB();
  const pending = db.pendingPayments[txnId];

  if (!pending) {
    bot.sendMessage(chatId, "❌ Order nahi mila. /start se try karo.",
      { reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }}
    ); return;
  }

  await bot.sendMessage(chatId, "🔍 *Payment verify ho raha hai...*", { parse_mode: "Markdown" });

  const result = await vcVerify(txnId, pending.amount);

  if (!result) {
    bot.sendMessage(chatId,
      "⚠️ *Gateway Error*\n\nServer se response nahi mila. Thodi der baad try karo.",
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "✅ Retry", callback_data: `check_${txnId}` }]
      ]}}
    );
    adminMsg(`⚠️ *VC Gateway Error*\nOrder: \`${txnId}\`\nUser: \`${chatId}\``);
    return;
  }

  const amountCredited = Number(result.amount_credited || result.amount || pending.amount);

  if (result.status === "success") {
    // ── Payment confirmed ──
    delete db.pendingPayments[txnId];

    if (pending.type === "direct_buy") {
      // Key deliver karo
      await deliverKeyAfterPayment(chatId, pending.productId, amountCredited, txnId, db);
    } else {
      // Wallet credit karo
      addBalance(db, chatId, amountCredited);
      saveDB(db);
      const newBal = getBalance(db, chatId);
      delete STATE[chatId];

      await bot.sendMessage(chatId,
        `🎉 *Payment Successful!*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🆔 *Order ID:* \`${txnId}\`\n` +
        `💰 *Added:* ₹${amountCredited}\n` +
        `💳 *New Balance:* ₹${newBal.toFixed(2)}\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ Wallet credit ho gaya!\nAb keys kharido.`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [
            [{ text: "🛒 Shop — Key Kharido", callback_data: "shop"      }],
            [{ text: "🏠 Main Menu",           callback_data: "main_menu" }],
          ]}
        }
      );

      adminMsg(
        `🟢 *Wallet Top-Up!*\n\n` +
        `👤 User: \`${chatId}\`\n` +
        `🆔 Order: \`${txnId}\`\n` +
        `💰 Amount: ₹${amountCredited}\n` +
        `💳 New Balance: ₹${newBal.toFixed(2)}`
      );
    }

  } else {
    // Payment nahi hua
    bot.sendMessage(chatId,
      `❌ *Payment Confirm Nahi Hua*\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🆔 *Order ID:* \`${txnId}\`\n` +
      `📌 *Status:* ${result.message || "Pending"}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `Pehle exactly *₹${pending.amount}* pay karo,\nphir Check Payment dabao.`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
          [{ text: "✅ Dobara Check Karo", callback_data: `check_${txnId}` }],
          [{ text: "❌ Cancel",            callback_data: "cancel"          }],
        ]}
      }
    );
  }
}

// ════════════════════════════════════════
// KEY DELIVERY — after direct UPI payment
// ════════════════════════════════════════
async function deliverKeyAfterPayment(chatId, productId, amount, txnId, db) {
  const p = db.products.find(x => x.id === productId);

  if (!p || p.stock <= 0) {
    bot.sendMessage(chatId,
      "❌ *Stock khatam!*\nAdmin se contact karo refund ke liye.",
      { parse_mode: "Markdown" }
    );
    adminMsg(`⚠️ *STOCK KHATAM!*\nProduct ID: ${productId}\nUser: \`${chatId}\`\nOrder: \`${txnId}\``);
    return;
  }

  const key = pickKey(db, productId);
  p.stock   = Math.max(0, p.stock - 1);

  const orderId = "KEY" + Date.now();
  db.orders.push({
    id: orderId, chatId: String(chatId),
    productName: p.name, key,
    amount, txnId,
    date: new Date().toISOString().split("T")[0],
    method: "UPI Direct",
  });
  getUser(db, chatId).orders.push(orderId);
  delete STATE[chatId];
  saveDB(db);

  await bot.sendMessage(chatId,
    `✅ *Payment Verified! Key Deliver Ho Gayi!*\n\n` +
    `🔑 *${p.name}*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `🗝️ *Tumhari Key:*\n` +
    `\`${key}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 Paid: ₹${amount}\n` +
    `📋 Order: \`${orderId}\`\n` +
    `📅 Date: ${new Date().toISOString().split("T")[0]}\n\n` +
    `🔒 Key copy karke safe rakho!`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        [{ text: "🛒 Aur Kharido", callback_data: "shop"      }],
        [{ text: "🏠 Main Menu",   callback_data: "main_menu" }],
      ]}
    }
  );

  adminMsg(
    `💰 *NAYA SALE! (UPI Direct)*\n\n` +
    `🔑 ${p.name}\n` +
    `💵 ₹${amount}\n` +
    `👤 User: \`${chatId}\`\n` +
    `📋 Order: \`${orderId}\`\n` +
    `🗝️ Key: \`${key}\``
  );
}

// ════════════════════════════════════════
// KEY DELIVERY — from wallet
// ════════════════════════════════════════
async function deliverFromWallet(chatId, productId, db) {
  const p   = db.products.find(x => x.id === productId);
  const bal = getBalance(db, chatId);

  if (!p || p.stock <= 0) {
    bot.sendMessage(chatId, "❌ *Out of Stock!*", { parse_mode: "Markdown" });
    return;
  }
  if (bal < p.price) {
    bot.sendMessage(chatId, "❌ *Balance Kam Hai!*", { parse_mode: "Markdown" });
    return;
  }

  const key = pickKey(db, productId);
  deductBalance(db, chatId, p.price);
  p.stock = Math.max(0, p.stock - 1);

  const orderId = "KEY" + Date.now();
  db.orders.push({
    id: orderId, chatId: String(chatId),
    productName: p.name, key,
    amount: p.price,
    date: new Date().toISOString().split("T")[0],
    method: "Wallet",
  });
  getUser(db, chatId).orders.push(orderId);
  saveDB(db);

  const newBal = getBalance(db, chatId);

  await bot.sendMessage(chatId,
    `✅ *Purchase Successful!*\n\n` +
    `🔑 *${p.name}*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `🗝️ *Tumhari Key:*\n` +
    `\`${key}\`\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 Deducted: ₹${p.price}\n` +
    `💳 Remaining Balance: ₹${newBal.toFixed(2)}\n` +
    `📋 Order: \`${orderId}\`\n\n` +
    `🔒 Key copy karke safe rakho!`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        [{ text: "🛒 Aur Kharido", callback_data: "shop"      }],
        [{ text: "🏠 Main Menu",   callback_data: "main_menu" }],
      ]}
    }
  );

  adminMsg(
    `💰 *NAYA SALE! (Wallet)*\n\n` +
    `🔑 ${p.name}\n` +
    `💵 ₹${p.price}\n` +
    `👤 User: \`${chatId}\`\n` +
    `📋 Order: \`${orderId}\`\n` +
    `🗝️ Key: \`${key}\``
  );
}

// ════════════════════════════════════════
// SHOW ORDERS
// ════════════════════════════════════════
function showOrders(chatId) {
  const db       = loadDB();
  const myOrders = db.orders.filter(o => o.chatId === String(chatId));

  if (myOrders.length === 0) {
    bot.sendMessage(chatId,
      "📦 *Koi order nahi mila.*\n\n/start se keys kharido!",
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🛒 Shop", callback_data: "shop" }]] }}
    ); return;
  }

  let msg = `📦 *Tumhare Orders (Last 5):*\n\n`;
  myOrders.slice(-5).reverse().forEach((o, i) => {
    msg += `${i + 1}. *${o.productName}*\n`;
    msg += `   🗝️ \`${o.key}\`\n`;
    msg += `   💰 ₹${o.amount} · 📅 ${o.date} · ${o.method || "UPI"}\n\n`;
  });

  bot.sendMessage(chatId, msg, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "main_menu" }]] }
  });
}

// ════════════════════════════════════════
// EXPRESS
// ════════════════════════════════════════
app.get("/", (req, res) => res.json({ status: "✅ AJGOR Key Store Running", uptime: process.uptime() }));

app.listen(CONFIG.PORT, () => {
  console.log("═══════════════════════════════");
  console.log("   AJGOR KEY STORE STARTED ✅  ");
  console.log("═══════════════════════════════");
  console.log(`Port    : ${CONFIG.PORT}`);
  console.log(`UPI ID  : ${CONFIG.UPI_ID}`);
  console.log(`VC API  : ${CONFIG.VC_API_URL}`);
  console.log("Bot     : Polling started...");
  console.log("═══════════════════════════════");
});
