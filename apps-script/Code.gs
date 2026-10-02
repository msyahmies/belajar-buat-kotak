/**
 * Backend Google Sheet untuk Rekod Jualan Kedai.
 * Pasang: Extensions > Apps Script dalam Google Sheet, tampal fail ini,
 * kemudian Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 */

const SHEET_ENTRIES = 'Rekod';
const SHEET_SETTINGS = 'Tetapan';
const CATEGORIES = ['Baju Pekerja', 'Baju Family Day', 'Baju Sukan', 'Baju Birthday'];
const PRINTINGS = ['DTF', 'Sublimation'];

const HEADER = ['ID', 'Tarikh', 'Staff', 'WS Masuk', 'Jumlah Pcs', 'Jumlah (RM)']
  .concat(CATEGORIES.map(c => c + ' (pcs)'))
  .concat(PRINTINGS.map(p => p + ' (pcs)'))
  .concat(['Masa Key In', 'Butiran (JSON)']);

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const req = JSON.parse(e.postData.contents);
    switch (req.action) {
      case 'list': return json({ ok: true, entries: listEntries(), target: getTarget() });
      case 'add': addEntry(req.entry); return json({ ok: true });
      case 'delete': deleteEntry(req.id); return json({ ok: true });
      case 'setTarget': setTarget(req.target); return json({ ok: true });
      default: return json({ ok: false, error: 'Tindakan tidak sah' });
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
    if (name === SHEET_ENTRIES) {
      sh.appendRow(HEADER);
      sh.setFrozenRows(1);
      sh.getRange('B:B').setNumberFormat('@'); // simpan tarikh sebagai teks yyyy-mm-dd
    } else {
      sh.appendRow(['Target Bulanan (RM)', 0]);
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
    staff: String(r[2]),
    ws: Number(r[3]) || 0,
    createdAt: String(r[jsonCol - 1]),
    lines: JSON.parse(r[jsonCol] || '[]'),
  }));
}

function addEntry(entry) {
  if (!entry || !entry.id || !entry.date || !Array.isArray(entry.lines)) throw new Error('Data tidak lengkap');
  let pcs = 0, sales = 0;
  const byCat = {}, byPrint = {};
  entry.lines.forEach(l => {
    const q = Number(l.qty) || 0;
    pcs += q;
    sales += Number(l.amount) || 0;
    byCat[l.category] = (byCat[l.category] || 0) + q;
    byPrint[l.printing] = (byPrint[l.printing] || 0) + q;
  });
  sheet(SHEET_ENTRIES).appendRow(
    [entry.id, entry.date, entry.staff, Number(entry.ws) || 0, pcs, sales]
      .concat(CATEGORIES.map(c => byCat[c] || 0))
      .concat(PRINTINGS.map(p => byPrint[p] || 0))
      .concat([entry.createdAt, JSON.stringify(entry.lines)])
  );
}

function deleteEntry(id) {
  const sh = sheet(SHEET_ENTRIES);
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
