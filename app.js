// Rekod Jualan Kedai — data disimpan dalam localStorage, dan (pilihan) disegerakkan
// ke Google Sheet melalui Google Apps Script (lihat apps-script/Code.gs).

const CATEGORIES = ['Baju Pekerja', 'Baju Family Day', 'Baju Sukan', 'Baju Birthday'];
const PRINTINGS = ['DTF', 'Sublimation'];

const LS_ENTRIES = 'sales.entries';
const LS_SETTINGS = 'sales.settings';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const rm = n => 'RM ' + (Number(n) || 0).toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage penuh / disekat */ }
}

let entries = load(LS_ENTRIES, []);
let settings = load(LS_SETTINGS, { target: 0, syncUrl: '' });

// ---------- Sync (Google Apps Script) ----------

async function remote(payload) {
  // text/plain mengelakkan CORS preflight yang tidak disokong oleh Apps Script.
  const res = await fetch(settings.syncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Ralat server');
  return data;
}

function setSyncStatus(text, isErr = false) {
  const el = $('#sync-status');
  el.textContent = text;
  el.style.color = isErr ? 'var(--danger)' : '';
}

async function pull() {
  if (!settings.syncUrl) { setSyncStatus('Mod luar talian (data dalam peranti ini)'); return; }
  setSyncStatus('Memuat data…');
  try {
    const data = await remote({ action: 'list' });
    entries = data.entries;
    if (data.target != null) settings.target = Number(data.target) || 0;
    save(LS_ENTRIES, entries);
    save(LS_SETTINGS, settings);
    setSyncStatus('Disegerakkan ' + new Date().toLocaleTimeString('ms-MY'));
  } catch (e) {
    setSyncStatus('Gagal segerak: ' + e.message, true);
  }
  renderAll();
}

// ---------- Kiraan ----------

function entryTotals(e) {
  return e.lines.reduce((t, l) => ({ pcs: t.pcs + Number(l.qty), sales: t.sales + Number(l.amount) }), { pcs: 0, sales: 0 });
}

function summarize(list) {
  const out = { sales: 0, pcs: 0, ws: 0, byCategory: {}, byPrinting: {} };
  CATEGORIES.forEach(c => out.byCategory[c] = { pcs: 0, sales: 0 });
  PRINTINGS.forEach(p => out.byPrinting[p] = { pcs: 0, sales: 0 });
  for (const e of list) {
    out.ws += Number(e.ws) || 0;
    for (const l of e.lines) {
      const qty = Number(l.qty) || 0, amt = Number(l.amount) || 0;
      out.pcs += qty;
      out.sales += amt;
      (out.byCategory[l.category] ??= { pcs: 0, sales: 0 });
      out.byCategory[l.category].pcs += qty;
      out.byCategory[l.category].sales += amt;
      (out.byPrinting[l.printing] ??= { pcs: 0, sales: 0 });
      out.byPrinting[l.printing].pcs += qty;
      out.byPrinting[l.printing].sales += amt;
    }
  }
  return out;
}

// ---------- Dashboard ----------

function renderDashboard() {
  const date = $('#dash-date').value || todayStr();
  const month = date.slice(0, 7);

  const day = summarize(entries.filter(e => e.date === date));
  $('#d-sales').textContent = rm(day.sales);
  $('#d-pcs').textContent = day.pcs;
  $('#d-ws').textContent = day.ws;

  const mon = summarize(entries.filter(e => e.date.startsWith(month)));
  const target = Number(settings.target) || 0;
  const balance = Math.max(target - mon.sales, 0);

  const [y, m, d] = date.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = daysInMonth - d + 1; // termasuk hari dipilih

  $('#m-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('ms-MY', { month: 'long', year: 'numeric' });
  $('#m-target').textContent = target ? rm(target) : 'Belum ditetapkan';
  $('#m-sales').textContent = rm(mon.sales);
  $('#m-balance').textContent = target ? (balance ? rm(balance) : 'Target tercapai!') : '-';
  $('#m-days').textContent = daysLeft;
  $('#m-perday').textContent = target ? rm(balance / daysLeft) : '-';

  const pct = target ? Math.min(mon.sales / target * 100, 100) : 0;
  const bar = $('#m-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('done', pct >= 100);
  $('#m-pct').textContent = target ? `${(mon.sales / target * 100).toFixed(1)}% daripada target` : 'Tetapkan target di tab Tetapan.';

  const rows = obj => Object.entries(obj).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="num">${v.pcs}</td><td class="num">${rm(v.sales)}</td></tr>`).join('');
  $('#t-category tbody').innerHTML = rows(mon.byCategory);
  $('#t-printing tbody').innerHTML = rows(mon.byPrinting);
}

// ---------- Borang key in ----------

function addLine() {
  const node = $('#line-tpl').content.firstElementChild.cloneNode(true);
  $('[name=category]', node).innerHTML = CATEGORIES.map(c => `<option>${c}</option>`).join('');
  $('[name=printing]', node).innerHTML = PRINTINGS.map(p => `<option>${p}</option>`).join('');
  $('.remove', node).addEventListener('click', () => {
    if ($$('#lines .line').length > 1) node.remove();
    updateFormTotal();
  });
  $('#lines').appendChild(node);
}

function readLines() {
  return $$('#lines .line').map(n => ({
    category: $('[name=category]', n).value,
    printing: $('[name=printing]', n).value,
    qty: Number($('[name=qty]', n).value) || 0,
    amount: Number($('[name=amount]', n).value) || 0,
  }));
}

function updateFormTotal() {
  const t = entryTotals({ lines: readLines() });
  $('#f-pcs').textContent = t.pcs;
  $('#f-sales').textContent = rm(t.sales);
}

function resetForm(keep) {
  const f = $('#entry-form');
  f.reset();
  f.date.value = keep?.date || todayStr();
  f.staff.value = keep?.staff || '';
  $('#lines').innerHTML = '';
  addLine();
  updateFormTotal();
}

function renderStaffList() {
  const names = [...new Set(entries.map(e => e.staff))].sort();
  $('#staff-list').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

async function onSubmitEntry(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#form-msg');
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
    date: f.date.value,
    staff: f.staff.value.trim(),
    ws: Number(f.ws.value) || 0,
    lines: readLines(),
    createdAt: new Date().toISOString(),
  };

  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  try {
    if (settings.syncUrl) await remote({ action: 'add', entry });
    entries.push(entry);
    save(LS_ENTRIES, entries);
    msg.className = 'msg ok';
    msg.textContent = `Disimpan: ${rm(entryTotals(entry).sales)} oleh ${entry.staff}`;
    resetForm({ date: entry.date, staff: entry.staff });
    renderAll();
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'Gagal simpan: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- Sejarah ----------

function monthEntries() {
  const month = $('#hist-month').value || todayStr().slice(0, 7);
  return entries
    .filter(e => e.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function renderHistory() {
  const list = monthEntries();
  const tbody = $('#t-history tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Tiada rekod untuk bulan ini.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(e => {
    const t = entryTotals(e);
    const detail = e.lines.map(l => `${l.qty} × ${esc(l.category)} (${esc(l.printing)}) ${rm(l.amount)}`).join('<br>');
    return `<tr>
      <td>${e.date}</td><td>${esc(e.staff)}</td><td class="num">${e.ws}</td>
      <td class="num">${t.pcs}</td><td class="num">${rm(t.sales)}</td>
      <td class="muted">${detail}</td>
      <td><button class="danger" data-del="${esc(e.id)}">Padam</button></td>
    </tr>`;
  }).join('');
}

async function onDelete(id) {
  const e = entries.find(x => x.id === id);
  if (!e || !confirm(`Padam rekod ${e.date} oleh ${e.staff}?`)) return;
  try {
    if (settings.syncUrl) await remote({ action: 'delete', id });
    entries = entries.filter(x => x.id !== id);
    save(LS_ENTRIES, entries);
    renderAll();
  } catch (err) {
    alert('Gagal padam: ' + err.message);
  }
}

function exportCsv() {
  const header = ['Tarikh', 'Staff', 'WS Masuk', 'Kategori', 'Printing', 'Kuantiti', 'Jumlah (RM)'];
  const rows = [header];
  for (const e of monthEntries().reverse()) {
    e.lines.forEach((l, i) => rows.push([e.date, e.staff, i === 0 ? e.ws : 0, l.category, l.printing, l.qty, l.amount]));
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `jualan-${$('#hist-month').value}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Tetapan ----------

async function onSubmitSettings(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#settings-msg');
  const urlChanged = f.syncUrl.value.trim() !== settings.syncUrl;
  settings.target = Number(f.target.value) || 0;
  settings.syncUrl = f.syncUrl.value.trim();
  save(LS_SETTINGS, settings);
  try {
    if (settings.syncUrl && !urlChanged) await remote({ action: 'setTarget', target: settings.target });
    msg.className = 'msg ok';
    msg.textContent = 'Tetapan disimpan.';
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = 'Disimpan dalam peranti, tetapi gagal hantar ke server: ' + e.message;
  }
  if (urlChanged) await pull(); else renderAll();
}

// ---------- Init ----------

function renderAll() {
  renderDashboard();
  renderHistory();
  renderStaffList();
  const f = $('#settings-form');
  f.target.value = settings.target || '';
  f.syncUrl.value = settings.syncUrl || '';
}

function showTab(name) {
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'dashboard' && settings.syncUrl) pull();
}

$$('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#dash-date').value = todayStr();
$('#dash-date').addEventListener('change', renderDashboard);
$('#hist-month').value = todayStr().slice(0, 7);
$('#hist-month').addEventListener('change', renderHistory);
$('#add-line').addEventListener('click', () => { addLine(); updateFormTotal(); });
$('#lines').addEventListener('input', updateFormTotal);
$('#entry-form').addEventListener('submit', onSubmitEntry);
$('#settings-form').addEventListener('submit', onSubmitSettings);
$('#export-csv').addEventListener('click', exportCsv);
$('#t-history').addEventListener('click', ev => {
  const id = ev.target.dataset?.del;
  if (id) onDelete(id);
});

resetForm();
renderAll();
pull();
