/**
 * Google Sheet backend for Shop Sales Tracker.
 * Install: in Google Sheet open Extensions > Apps Script, paste this file,
 * then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 */

const TIME_ZONE = 'Asia/Kuala_Lumpur';
const SHEET_ENTRIES = 'Sales';
const SHEET_SETTINGS = 'Settings';
const SHEET_EXPENSES = 'Expenses';
const SHEET_JOBS = 'Jobs';
const JOB_FIELDS = ['design', 'order', 'shirt', 'print', 'heatpress', 'packing', 'method', 'ship'];
const JOB_HEADER = ['Job ID', 'Customer', 'Phone', 'Category', 'Printing', 'Qty', 'Expected Delivery', 'Deposit (RM)',
  'Design', 'Shirt Order', 'Shirt Status', 'Print', 'Heat Press', 'Packing', 'Post / Pickup', 'Post / Pickup Status', 'Current Status', 'Updated At'];
const EXPENSE_HEADER = ['ID', 'Date', 'Type', 'Category', 'Amount (RM)', 'Notes', 'Entered At', 'Receipt'];
const CATEGORIES = ['Work Shirt', 'Family Day Shirt', 'Sports Shirt', 'Birthday Shirt'];
const PRINTINGS = ['DTF', 'Sublimation'];

const HEADER = ['ID', 'Date', 'Leads In', 'Leads Converted', '% Leads Converted', 'Total Pcs', 'Total (RM)', 'Deposit (RM)', 'Balance (RM)']
  .concat(CATEGORIES.map(c => c + ' (pcs)'))
  .concat(PRINTINGS.map(p => p + ' (pcs)'))
  .concat(['Entered At', 'Details (JSON)']);

// Opening the /exec URL in a browser shows this, to confirm the right code is deployed.
function doGet() {
  return json({ ok: true, message: 'Shop Sales Tracker is connected', sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Keep the sheet on Kuala Lumpur time (GMT+8) so dates are read back correctly.
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSpreadsheetTimeZone() !== TIME_ZONE) ss.setSpreadsheetTimeZone(TIME_ZONE);
    const req = JSON.parse(e.postData.contents);
    switch (req.action) {
      case 'list': return json({ ok: true, entries: listEntries(), expenses: listExpenses(), jobs: listJobs(), overhead: getOverhead(), target: getTarget() });
      case 'add': addEntry(req.entry); return json({ ok: true });
      case 'delete': deleteEntry(req.id); return json({ ok: true });
      case 'addExpense': addExpense(req.expense); return json({ ok: true });
      case 'deleteExpense': deleteRowById(SHEET_EXPENSES, req.id); return json({ ok: true });
      case 'saveJob': saveJob(req.job); return json({ ok: true });
      case 'setOverhead': setOverhead(req.overhead); return json({ ok: true });
      case 'setTarget': setTarget(req.target); return json({ ok: true });
      default: return json({ ok: false, error: 'Invalid action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === SHEET_ENTRIES || name === SHEET_EXPENSES || name === SHEET_JOBS) {
      sh.appendRow(name === SHEET_ENTRIES ? HEADER : name === SHEET_EXPENSES ? EXPENSE_HEADER : JOB_HEADER);
      sh.setFrozenRows(1);
      sh.getRange('B:B').setNumberFormat('@'); // keep dates as yyyy-mm-dd text
      if (name === SHEET_JOBS) sh.getRange('C:C').setNumberFormat('@'); // keep the phone's leading 0
    } else {
      sh.appendRow(['Monthly Target (RM)', 0]);
    }
  }
  return sh;
}

// Sheets can turn a typed date into a Date value; always hand back yyyy-mm-dd text.
function dateText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

// Keep the date column as plain text so new rows are not converted.
function appendWithTextDate(sh, row) {
  sh.getRange('B:B').setNumberFormat('@');
  sh.appendRow(row);
}

function listEntries() {
  const values = sheet(SHEET_ENTRIES).getDataRange().getValues();
  const jsonCol = HEADER.length - 1;
  return values.slice(1).filter(r => r[0]).map(r => ({
    id: String(r[0]),
    date: dateText(r[1]),
    leads: Number(r[2]) || 0,
    converted: Number(r[3]) || 0,
    createdAt: String(r[jsonCol - 1]),
    lines: JSON.parse(r[jsonCol] || '[]'),
  }));
}

function addEntry(entry) {
  if (!entry || !entry.id || !entry.date || !Array.isArray(entry.lines)) throw new Error('Incomplete data');
  let pcs = 0, sales = 0, deposit = 0;
  const byCat = {}, byPrint = {};
  entry.lines.forEach(l => {
    const q = Number(l.qty) || 0;
    pcs += q;
    sales += Number(l.amount) || 0;
    deposit += Number(l.deposit) || 0;
    byCat[l.category] = (byCat[l.category] || 0) + q;
    byPrint[l.printing] = (byPrint[l.printing] || 0) + q;
  });
  appendWithTextDate(sheet(SHEET_ENTRIES),
    [entry.id, entry.date, Number(entry.leads) || 0, Number(entry.converted) || 0, Number(entry.leads) ? (Number(entry.converted) / Number(entry.leads) * 100).toFixed(1) + '%' : '', pcs, sales, deposit, sales - deposit]
      .concat(CATEGORIES.map(c => byCat[c] || 0))
      .concat(PRINTINGS.map(p => byPrint[p] || 0))
      .concat([entry.createdAt, JSON.stringify(entry.lines)])
  );
}

function listExpenses() {
  return sheet(SHEET_EXPENSES).getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
    id: String(r[0]),
    date: dateText(r[1]),
    kind: ['Monthly', 'Bulanan'].includes(String(r[2])) ? 'bulanan' : 'harian',
    category: String(r[3]),
    amount: Number(r[4]) || 0,
    notes: String(r[5]),
    createdAt: String(r[6]),
    receipt: String(r[7] || ''),
  }));
}

function addExpense(x) {
  if (!x || !x.id || !x.date) throw new Error('Incomplete data');
  appendWithTextDate(sheet(SHEET_EXPENSES), [x.id, x.date, x.kind === 'bulanan' ? 'Monthly' : 'Daily', x.category, Number(x.amount) || 0, x.notes || '', x.createdAt]);
}

// Jobs are keyed "<sale id>:<row index>"; returns { key: { deposit, design, ... } }.
function listJobs() {
  const out = {};
  sheet(SHEET_JOBS).getDataRange().getValues().slice(1).filter(r => r[0]).forEach(r => {
    const job = { deposit: Number(r[7]) || 0, updatedAt: String(r[17]) };
    JOB_FIELDS.forEach((f, i) => { if (r[8 + i] !== '') job[f] = String(r[8 + i]); });
    out[String(r[0])] = job;
  });
  return out;
}

function saveJob(job) {
  if (!job || !job.id) throw new Error('Incomplete data');
  const row = [job.id, job.customer || '', job.phone || '', job.category || '', job.printing || '', Number(job.qty) || 0,
    job.delivery || '', Number(job.deposit) || 0].concat(JOB_FIELDS.map(f => job[f] || '')).concat([job.status || '', job.updatedAt || '']);
  const sh = sheet(SHEET_JOBS);
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === String(job.id)) { sh.getRange(i + 1, 1, 1, row.length).setValues([row]); return; }
  }
  sh.appendRow(row);
}

function deleteEntry(id) {
  deleteRowById(SHEET_ENTRIES, id);
}

function deleteRowById(name, id) {
  const sh = sheet(name);
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (let i = ids.length - 1; i >= 1; i--) {
    if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 1); return; }
  }
}

function getTarget() {
  return Number(sheet(SHEET_SETTINGS).getRange('B1').getValue()) || 0;
}

function setTarget(target) {
  sheet(SHEET_SETTINGS).getRange('B1').setValue(Number(target) || 0);
}

// Monthly overhead (rent, salary, bills, other items, estimated margin) lives in Settings!B2 as JSON.
function getOverhead() {
  try { return JSON.parse(sheet(SHEET_SETTINGS).getRange('B2').getValue() || 'null'); } catch (err) { return null; }
}

function setOverhead(overhead) {
  sheet(SHEET_SETTINGS).getRange('A2:B2').setValues([['Monthly Overhead (JSON)', JSON.stringify(overhead || {})]]);
}


// ---------- Telegram: send a receipt photo to your bot, it lands in Expenses ----------
//
// One-time setup (see README):
//   1. Create a bot with @BotFather in Telegram and copy its token.
//   2. In Apps Script: Project Settings > Script properties > add TELEGRAM_TOKEN = <token>.
//   3. Choose setupTelegram in the function list at the top and press Run, then allow access.
//   4. Open your bot in Telegram and send /start. The first chat to do so becomes the owner.
// After that, every minute the script picks up new messages from the bot.

const TG_CATEGORY_WORDS = [
  ['DTF Sticker / Film', ['dtf', 'sticker', 'film']],
  ['Sublimation Paper & Ink', ['sublimation', 'sublim', 'kertas']],
  ['Blank Shirts', ['baju', 'shirt', 'tshirt', 't-shirt', 'jersey', 'kain']],
  ['Ink', ['ink', 'dakwat']],
  ['Plastic / Packaging', ['plastik', 'plastic', 'packaging', 'kotak', 'box', 'bubble']],
  ['Delivery / Postage', ['pos', 'poslaju', 'j&t', 'jnt', 'courier', 'kurier', 'ninja', 'lalamove', 'delivery', 'grab']],
  ['Advertising / Ads', ['iklan', 'ads', 'boost', 'facebook', 'fb', 'tiktok', 'meta']],
  ['Machine Maintenance', ['mesin', 'machine', 'repair', 'servis', 'service', 'baiki']],
];
const TG_HELP = 'Send a photo of the receipt with a caption, for example:\n' +
  '• DTF 150 supplier Ali\n• baju 400\n• plastik RM35.50\n\n' +
  'No photo? Just type it, e.g. "poslaju 12". If you forget the amount I will ask for it.';

function tgToken() {
  return PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
}

function tg(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + tgToken() + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true,
  });
  return JSON.parse(res.getContentText());
}

function tgSend(chatId, text) {
  tg('sendMessage', { chat_id: chatId, text: text });
}

// Run once from the Apps Script editor.
function setupTelegram() {
  if (!tgToken()) throw new Error('Add TELEGRAM_TOKEN in Project Settings > Script properties first.');
  const me = tg('getMe');
  if (!me.ok) throw new Error('Telegram rejected the token: ' + me.description);
  tg('deleteWebhook', {});
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkTelegram').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkTelegram').timeBased().everyMinutes(1).create();
  receiptFolder();
  Logger.log('Telegram is ready. Open @' + me.result.username + ' in Telegram and send /start');
}

// Runs every minute: fetch new bot messages and turn them into expenses.
function checkTelegram() {
  if (!tgToken()) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const res = tg('getUpdates', { offset: Number(props.getProperty('TG_OFFSET')) || 0, timeout: 0, allowed_updates: ['message'] });
    (res.result || []).forEach(u => {
      props.setProperty('TG_OFFSET', String(u.update_id + 1)); // never handle the same message twice
      if (!u.message) return;
      try { handleTelegram(u.message); } catch (err) { tgSend(u.message.chat.id, 'Sorry, that did not save: ' + err); }
    });
  } finally {
    lock.releaseLock();
  }
}

function handleTelegram(msg) {
  const props = PropertiesService.getScriptProperties();
  const chatId = String(msg.chat.id);
  const owner = props.getProperty('TG_OWNER');
  const text = (msg.caption || msg.text || '').trim();

  if (/^\/start/.test(text)) {
    if (!owner) props.setProperty('TG_OWNER', chatId);
    if (!owner || owner === chatId) tgSend(chatId, 'Hi! I save your receipts to Shop Sales Tracker > Expenses.\n\n' + TG_HELP);
    else tgSend(chatId, 'This bot is private.');
    return;
  }
  if (chatId !== owner) { tgSend(chatId, 'This bot is private.'); return; }

  const date = Utilities.formatDate(new Date(msg.date * 1000), TIME_ZONE, 'yyyy-MM-dd');
  const photo = msg.photo ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg.document && /^(image\/|application\/pdf)/.test(msg.document.mime_type || '') ? msg.document : null;
  const pending = JSON.parse(props.getProperty('TG_PENDING') || 'null');

  if (photo || doc) {
    const receipt = saveReceipt((photo || doc).file_id, date, doc ? doc.file_name : 'receipt.jpg');
    const parsed = parseExpense(text);
    if (parsed.amount) { saveTelegramExpense(chatId, date, parsed, receipt); return; }
    props.setProperty('TG_PENDING', JSON.stringify({ date: date, text: text, receipt: receipt }));
    tgSend(chatId, 'Receipt saved. How much was it? Reply with the amount, e.g. 150 or "DTF 150".');
    return;
  }

  const parsed = parseExpense(pending ? (pending.text + ' ' + text).trim() : text);
  if (!parsed.amount) { tgSend(chatId, TG_HELP); return; }
  props.deleteProperty('TG_PENDING');
  saveTelegramExpense(chatId, pending ? pending.date : date, parsed, pending ? pending.receipt : '');
}

// "DTF 150 supplier Ali" -> { amount: 150, category: 'DTF Sticker / Film', notes: 'DTF 150 supplier Ali' }
function parseExpense(text) {
  const t = String(text || '');
  const m = t.match(/rm\s*(\d+(?:[.,]\d{1,2})?)/i) || t.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)(?=\s|$)/);
  const amount = m ? Number(m[1].replace(',', '.')) : 0;
  const lower = ' ' + t.toLowerCase() + ' ';
  const hit = TG_CATEGORY_WORDS.find(([, words]) => words.some(w => lower.indexOf(w) !== -1));
  return { amount: amount, category: hit ? hit[0] : 'Other Operation Cost', notes: t };
}

function saveTelegramExpense(chatId, date, parsed, receipt) {
  const sh = sheet(SHEET_EXPENSES);
  if (!sh.getRange(1, 8).getValue()) sh.getRange(1, 8).setValue('Receipt');
  appendWithTextDate(sh, [Utilities.getUuid(), date, 'Daily', parsed.category, parsed.amount, parsed.notes + ' (Telegram)', new Date().toISOString(), receipt || '']);
  tgSend(chatId, '✅ Saved to Expenses\n' + parsed.category + ': RM' + parsed.amount.toFixed(2) + ' on ' + date +
    (receipt ? '\nReceipt saved in Google Drive.' : '') + '\n\nWrong category or amount? Delete it in the app (Expenses tab) and send again.');
}

function receiptFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('TG_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) { /* folder deleted: make a new one */ } }
  const folder = DriveApp.createFolder('Shop Sales Tracker Receipts');
  props.setProperty('TG_FOLDER', folder.getId());
  return folder;
}

function saveReceipt(fileId, date, name) {
  const file = tg('getFile', { file_id: fileId });
  if (!file.ok) throw new Error('could not download the photo from Telegram');
  const blob = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + tgToken() + '/' + file.result.file_path).getBlob();
  return receiptFolder().createFile(blob.setName(date + ' ' + name)).getUrl();
}
