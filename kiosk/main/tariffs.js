// Tarifas: exportar e importar precios en CSV (separado por «;», se abre directamente en Excel).
//   tipo;id;nombre;ancho_mm;alto_mm;precio;tramos;fotos;formato
//   copia;10x15;10 x 15 cm;102;152;0,35;50:0,30|100:0,25;;
//   carnet;eu-pass;Pasaporte UE;35;45;8;;;
//   lote;lot4;Lote 4 fotos;;;6;;4;eu-pass
import fsp from 'node:fs/promises';
import { getSettings, saveSettings } from './config.js';

const HEAD = ['tipo', 'id', 'nombre', 'ancho_mm', 'alto_mm', 'precio', 'tramos', 'fotos', 'formato'];
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
const fmt = (v) => (v === undefined || v === null || v === '' ? '' : String(v).replace('.', ','));
const cell = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

export function tariffsToCsv(s = getSettings()) {
  const rows = [HEAD];
  for (const z of s.printSizes) rows.push(['copia', z.id, z.name, z.w, z.h, fmt(z.price), (z.tiers || []).map((t) => `${t.from}:${fmt(t.price)}`).join('|'), '', '']);
  for (const p of s.idPresets) rows.push(['carnet', p.id, p.name, p.w, p.h, fmt(p.price), '', '', '']);
  for (const l of s.idLots) rows.push(['lote', l.id, l.name, '', '', fmt(l.price), '', l.photos, l.presetId || '']);
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Aplica un CSV de tarifas sobre los ajustes: actualiza por id y añade los nuevos. */
export function applyTariffsCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) throw new Error('El archivo está vacío');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  if (head[0] !== 'tipo' || !head.includes('precio')) throw new Error('No es un archivo de tarifas válido (falta la cabecera tipo;id;nombre;…;precio)');
  const col = (r, name) => r[head.indexOf(name)]?.trim();
  const s = structuredClone(getSettings());
  const summary = { updated: 0, added: 0, skipped: 0 };
  for (const r of rows.slice(1)) {
    const tipo = col(r, 'tipo')?.toLowerCase();
    const id = col(r, 'id') || `t${Date.now()}${summary.added}`;
    const price = num(col(r, 'precio'));
    if (price === undefined) { summary.skipped++; continue; }
    const name = col(r, 'nombre');
    const w = num(col(r, 'ancho_mm')), h = num(col(r, 'alto_mm'));
    const upsert = (list, obj, required) => {
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) { list[i] = { ...list[i], ...Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== '')) }; summary.updated++; }
      else if (required.every((k) => obj[k] !== undefined && obj[k] !== '')) { list.push(obj); summary.added++; }
      else summary.skipped++;
    };
    if (tipo === 'copia') {
      const tiers = (col(r, 'tramos') || '').split('|').map((t) => t.split(':')).filter((t) => t.length === 2)
        .map(([from, p]) => ({ from: parseInt(from, 10), price: num(p) })).filter((t) => t.from > 0 && t.price !== undefined);
      upsert(s.printSizes, { id, name, w, h, price, tiers, ...(s.printSizes.some((x) => x.id === id) ? {} : { printers: [], useDriverPaper: false }) }, ['name', 'w', 'h']);
    } else if (tipo === 'carnet') {
      upsert(s.idPresets, { id, name, w, h, price, ...(s.idPresets.some((x) => x.id === id) ? {} : { region: 'Otros', headMin: (h || 45) * 0.7, headMax: (h || 45) * 0.8, crownMm: (h || 45) * 0.08 }) }, ['name', 'w', 'h']);
    } else if (tipo === 'lote') {
      upsert(s.idLots, { id, name, price, photos: num(col(r, 'fotos')), presetId: col(r, 'formato') || '' }, ['name', 'photos']);
    } else summary.skipped++;
  }
  saveSettings(s);
  return summary;
}

export async function exportTariffs(file) { await fsp.writeFile(file, tariffsToCsv(), 'utf8'); }
export async function importTariffs(file) { return applyTariffsCsv(await fsp.readFile(file, 'utf8')); }
