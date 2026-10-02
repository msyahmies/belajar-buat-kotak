// Rekod Jualan Kedai — data disimpan dalam localStorage, dan (pilihan) disegerakkan
// ke Google Sheet melalui Google Apps Script (lihat apps-script/Code.gs).

const CATEGORIES = ['Baju Pekerja', 'Baju Family Day', 'Baju Sukan', 'Baju Birthday'];
const PRINTINGS = ['DTF', 'Sublimation'];
const SOURCES = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Walk-in', 'Referral', 'Customer Lama', 'Lain-lain'];

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
  const out = { sales: 0, pcs: 0, ws: 0, leads: 0, converted: 0, deposit: 0, byCategory: {}, byPrinting: {}, bySource: {} };
  CATEGORIES.forEach(c => out.byCategory[c] = { pcs: 0, sales: 0 });
  PRINTINGS.forEach(p => out.byPrinting[p] = { pcs: 0, sales: 0 });
  for (const e of list) {
    out.ws += Number(e.ws) || 0;
    out.leads += Number(e.leads) || 0;
    out.converted += Number(e.converted) || 0;
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
      out.deposit += Number(l.deposit) || 0;
      const src = l.source || 'Tiada';
      (out.bySource[src] ??= { orders: 0, sales: 0 });
      out.bySource[src].orders += 1;
      out.bySource[src].sales += amt;
    }
  }
  return out;
}

// ---------- Dashboard ----------

const convRate = s => s.leads ? (s.converted / s.leads * 100).toFixed(1) + '%' : '-';

function renderDashboard() {
  const date = $('#dash-date').value || todayStr();
  const month = date.slice(0, 7);

  const day = summarize(entries.filter(e => e.date === date));
  $('#d-pcs').textContent = day.pcs;
  $('#d-ws').textContent = day.ws;
  $('#d-leads').textContent = day.leads;
  $('#d-conv').textContent = day.converted;
  $('#d-rate').textContent = convRate(day);

  const mon = summarize(entries.filter(e => e.date.startsWith(month)));
  const target = Number(settings.target) || 0;
  const balance = Math.max(target - mon.sales, 0);

  const [y, m, d] = date.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysLeft = daysInMonth - d + 1; // termasuk hari dipilih

  $('#m-label').textContent = new Date(y, m - 1, 1).toLocaleDateString('ms-MY', { month: 'long', year: 'numeric' });
  $('#m-target').textContent = target ? rm(target) : 'Belum ditetapkan';
  $('#m-sales').textContent = rm(mon.sales);
  $('#m-leads').textContent = mon.leads;
  $('#m-conv').textContent = mon.converted;
  $('#m-rate').textContent = convRate(mon);
  $('#m-deposit').textContent = rm(mon.deposit);
  $('#m-owed').textContent = rm(mon.sales - mon.deposit);
  $('#m-days').textContent = daysLeft;
  $('#m-balance').textContent = !target ? '-' : balance ? rm(balance) : 'Target tercapai!';
  $('#m-balance-sub').textContent = target ? `daripada target ${rm(target)}` : 'Tetapkan target di tab Tetapan';

  // Target harian = baki target pada awal hari dipilih, dibahagi baki hari (termasuk hari ini).
  const salesBefore = summarize(entries.filter(e => e.date.startsWith(month) && e.date < date)).sales;
  const dailyTarget = target ? Math.max(target - salesBefore, 0) / daysLeft : 0;
  const dayBalance = Math.max(dailyTarget - day.sales, 0);
  const ratio = dailyTarget ? day.sales / dailyTarget : 1;

  $('#d-sales').textContent = rm(day.sales);
  $('#d-sales-sub').textContent = `${day.pcs} pcs · ${day.converted} order convert`
    + (dailyTarget ? ` · ${Math.round(ratio * 100)}% daripada target hari ini` : '');
  $('#d-target').textContent = target ? rm(dailyTarget) : '-';
  $('#d-target-sub').textContent = target ? `${daysLeft} hari lagi bulan ini` : '';
  $('#d-balance').textContent = !target ? '-' : dayBalance ? rm(dayBalance) : 'Target hari ini tercapai!';
  $('#d-balance-sub').textContent = !target ? '' : ratio >= 1 ? 'Syabas!' : ratio >= 2 / 3 ? 'Hampir capai' : 'Perlu usaha lagi';
  const card = $('#d-balance-card');
  card.classList.toggle('c-green', !!target && ratio >= 1);
  card.classList.toggle('c-yellow', !!target && ratio >= 2 / 3 && ratio < 1);
  card.classList.toggle('c-red', !!target && ratio < 2 / 3);

  const pct = target ? Math.min(mon.sales / target * 100, 100) : 0;
  const bar = $('#m-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('done', pct >= 100);
  $('#m-pct').textContent = target ? `${(mon.sales / target * 100).toFixed(1)}% daripada target` : 'Tetapkan target di tab Tetapan.';

  const rows = obj => Object.entries(obj).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="num">${v.pcs}</td><td class="num">${rm(v.sales)}</td></tr>`).join('');
  $('#t-category tbody').innerHTML = rows(mon.byCategory);
  $('#t-printing tbody').innerHTML = rows(mon.byPrinting);
  const sources = Object.entries(mon.bySource).sort((a, b) => b[1].sales - a[1].sales);
  $('#t-source tbody').innerHTML = sources.length
    ? sources.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.orders}</td><td class="num">${rm(v.sales)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">Tiada order lagi.</td></tr>';
}

// ---------- Borang key in ----------

function addLine() {
  const node = $('#line-tpl').content.firstElementChild.cloneNode(true);
  $('[name=category]', node).innerHTML = CATEGORIES.map(c => `<option>${c}</option>`).join('');
  $('[name=printing]', node).innerHTML = PRINTINGS.map(p => `<option>${p}</option>`).join('');
  $('[name=source]', node).innerHTML = SOURCES.map(s => `<option>${s}</option>`).join('');
  $('.remove', node).addEventListener('click', () => {
    if ($$('#lines .line').length > 1) node.remove();
    updateFormTotal();
  });
  $('#lines').appendChild(node);
}

function readLines() {
  return $$('#lines .line').map(n => ({
    customer: $('[name=customer]', n).value.trim(),
    phone: $('[name=phone]', n).value.trim(),
    category: $('[name=category]', n).value,
    printing: $('[name=printing]', n).value,
    qty: Number($('[name=qty]', n).value) || 0,
    amount: Number($('[name=amount]', n).value) || 0,
    deposit: Number($('[name=deposit]', n).value) || 0,
    source: $('[name=source]', n).value,
    delivery: $('[name=delivery]', n).value,
    notes: $('[name=notes]', n).value.trim(),
  }));
}

function updateFormTotal() {
  const t = entryTotals({ lines: readLines() });
  $('#f-pcs').textContent = t.pcs;
  $('#f-sales').textContent = rm(t.sales);
  for (const n of $$('#lines .line')) {
    const bal = (Number($('[name=amount]', n).value) || 0) - (Number($('[name=deposit]', n).value) || 0);
    const out = $('[name=balance]', n);
    out.value = rm(bal);
    out.classList.toggle('neg', bal < 0);
  }
}

function resetForm(keep) {
  const f = $('#entry-form');
  f.reset();
  f.date.value = keep?.date || todayStr();
  $('#lines').innerHTML = '';
  addLine();
  updateFormTotal();
}

async function onSubmitEntry(ev) {
  ev.preventDefault();
  const f = ev.target;
  const msg = $('#form-msg');
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
    date: f.date.value,
    ws: Number(f.ws.value) || 0,
    leads: Number(f.leads.value) || 0,
    converted: Number(f.converted.value) || 0,
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
    msg.textContent = `Disimpan: ${rm(entryTotals(entry).sales)} untuk ${entry.date}`;
    resetForm({ date: entry.date });
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

function lineDetail(l) {
  const parts = [
    `${l.customer ? `<b>${esc(l.customer)}</b>` : ''}${l.phone ? ` (${esc(l.phone)})` : ''}`,
    `${l.qty} × ${esc(l.category)} (${esc(l.printing)})`,
    `Total ${rm(l.amount)} · Deposit ${rm(l.deposit)} · Baki ${rm((Number(l.amount) || 0) - (Number(l.deposit) || 0))}`,
  ];
  if (l.source) parts.push(`Source: ${esc(l.source)}`);
  if (l.delivery) parts.push(`Delivery: ${esc(l.delivery)}`);
  if (l.notes) parts.push(`Notes: ${esc(l.notes)}`);
  return parts.filter(Boolean).join('<br>');
}

function renderHistory() {
  const list = monthEntries();
  const tbody = $('#t-history tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Tiada rekod untuk bulan ini.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(e => {
    const t = entryTotals(e);
    const detail = e.lines.map(lineDetail).join('<hr>');
    return `<tr>
      <td>${e.date}</td><td class="num">${e.ws}</td><td class="num">${e.leads || 0}</td><td class="num">${e.converted || 0}</td>
      <td class="num">${t.pcs}</td><td class="num">${rm(t.sales)}</td>
      <td class="muted">${detail}</td>
      <td><button class="danger" data-del="${esc(e.id)}">Padam</button></td>
    </tr>`;
  }).join('');
}

async function onDelete(id) {
  const e = entries.find(x => x.id === id);
  if (!e || !confirm(`Padam rekod ${e.date} (${rm(entryTotals(e).sales)})?`)) return;
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
  const header = ['Tarikh', 'WS Masuk', 'Lead Masuk', 'Lead Convert', 'Nama Customer', 'No Telefon', 'Kategori', 'Printing', 'Kuantiti', 'Total (RM)', 'Deposit (RM)', 'Baki (RM)', 'Lead Source', 'Expected Delivery', 'Notes'];
  const rows = [header];
  // No telefon ditulis sebagai ="012..." supaya Excel tidak buang 0 di depan.
  for (const e of monthEntries().reverse()) {
    e.lines.forEach((l, i) => rows.push([e.date, i === 0 ? e.ws : 0, i === 0 ? e.leads || 0 : 0, i === 0 ? e.converted || 0 : 0, l.customer || '', l.phone ? `="${l.phone}"` : '', l.category, l.printing, l.qty, l.amount, l.deposit || 0, (Number(l.amount) || 0) - (Number(l.deposit) || 0), l.source || '', l.delivery || '', l.notes || '']));
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
