/**
 * Google Sheet backend for Shop Sales Tracker.
 * Install: in Google Sheet open Extensions > Apps Script, paste this file,
 * then Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 */

const SHEET_ENTRIES = 'Sales';
const SHEET_SETTINGS = 'Settings';
const SHEET_EXPENSES = 'Expenses';
const SHEET_JOBS = 'Jobs';
const JOB_FIELDS = ['design', 'order', 'shirt', 'print', 'heatpress', 'packing', 'method', 'ship'];
const JOB_HEADER = ['Job ID', 'Customer', 'Phone', 'Category', 'Printing', 'Qty', 'Expected Delivery', 'Deposit (RM)',
  'Design', 'Shirt Order', 'Shirt Status', 'Print', 'Heat Press', 'Packing', 'Post / Pickup', 'Post / Pickup Status', 'Current Status', 'Updated At'];
const EXPENSE_HEADER = ['ID', 'Date', 'Type', 'Category', 'Amount (RM)', 'Notes', 'Entered At'];
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
    const req = JSON.parse(e.postData.contents);
    switch (req.action) {
      case 'list': return json({ ok: true, entries: listEntries(), expenses: listExpenses(), jobs: listJobs(), target: getTarget() });
      case 'add': addEntry(req.entry); return json({ ok: true });
      case 'delete': deleteEntry(req.id); return json({ ok: true });
      case 'addExpense': addExpense(req.expense); return json({ ok: true });
      case 'deleteExpense': deleteRowById(SHEET_EXPENSES, req.id); return json({ ok: true });
      case 'saveJob': saveJob(req.job); return json({ ok: true });
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

function listEntries() {
  const values = sheet(SHEET_ENTRIES).getDataRange().getValues();
  const jsonCol = HEADER.length - 1;
  return values.slice(1).filter(r => r[0]).map(r => ({
    id: String(r[0]),
    date: String(r[1]),
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
  sheet(SHEET_ENTRIES).appendRow(
    [entry.id, entry.date, Number(entry.leads) || 0, Number(entry.converted) || 0, Number(entry.leads) ? (Number(entry.converted) / Number(entry.leads) * 100).toFixed(1) + '%' : '', pcs, sales, deposit, sales - deposit]
      .concat(CATEGORIES.map(c => byCat[c] || 0))
      .concat(PRINTINGS.map(p => byPrint[p] || 0))
      .concat([entry.createdAt, JSON.stringify(entry.lines)])
  );
}

function listExpenses() {
  return sheet(SHEET_EXPENSES).getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
    id: String(r[0]),
    date: String(r[1]),
    kind: ['Monthly', 'Bulanan'].includes(String(r[2])) ? 'bulanan' : 'harian',
    category: String(r[3]),
    amount: Number(r[4]) || 0,
    notes: String(r[5]),
    createdAt: String(r[6]),
  }));
}

function addExpense(x) {
  if (!x || !x.id || !x.date) throw new Error('Incomplete data');
  sheet(SHEET_EXPENSES).appendRow([x.id, x.date, x.kind === 'bulanan' ? 'Monthly' : 'Daily', x.category, Number(x.amount) || 0, x.notes || '', x.createdAt]);
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
