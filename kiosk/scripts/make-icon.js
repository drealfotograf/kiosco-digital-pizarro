#!/usr/bin/env node
// Genera build/icon.png (256x256) desde el logo SVG del kiosco.
// Uso: node scripts/make-icon.js
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'build');
mkdirSync(out, { recursive: true });

const svg = `<svg width="256" height="256" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="120" rx="18" fill="#1a1a2e"/>
  <g stroke="#e0e0e0" stroke-width="3" fill="none" stroke-linecap="square">
    <path d="M14 38V14h24M82 14h24v24M14 82v24h24M82 106h24V82"/>
  </g>
  <text x="60" y="75" text-anchor="middle" font-family="sans-serif" font-weight="300" font-size="46" fill="#e0e0e0">P</text>
</svg>`;

await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(path.join(out, 'icon.png'));
console.log('build/icon.png creado (256x256)');
