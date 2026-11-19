import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { renderIconPng } from './render-logo-png.mjs';

const root = new URL('../', import.meta.url);
const ink = '#173F32';
const paper = '#F6F3E8';
const depth = 3;
const radians = Math.PI / 180;
const forks = [
  { at: 1, angle: 79, length: 0.61, radius: 0.66 },
  { at: 0.86, angle: -26, length: 0.80, radius: 0.73 },
];

// Model space is y-up. Angles are in degrees and lengths use the initial trunk as one unit.
function branchFrame(x, y, length, angle, wind, t) {
  const a = angle * radians;
  const dx = Math.cos(a) + 2 * wind * t;
  const dy = Math.sin(a);
  const speed = Math.hypot(dx, dy);
  return {
    x: x + length * t * (Math.cos(a) + wind * t),
    y: y + length * t * dy,
    nx: -dy / speed,
    ny: dx / speed,
    heading: Math.atan2(dy, dx) / radians,
  };
}

function needlePad(x, y, length) {
  const width = 2.2 * (0.58 + 0.75 * length);
  const height = 0.59 * (0.74 + 0.46 * length);
  const upper = [], lower = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const arc = 2.6 * u ** 0.53 * (1 - u) ** 1.18;
    const offset = width * (u - 0.47);
    const mid = y + 0.06 * offset;
    upper.push([x + offset, mid + height * arc * (1 - 0.08 * Math.sin(2 * Math.PI * u) ** 2)]);
    lower.push([x + offset, mid - 0.21 * height * arc]);
  }
  return upper.concat(lower.reverse());
}

function grow(polygons, x, y, length, angle, radius, level) {
  const trunk = level === 0;
  const frame = t => branchFrame(x, y, length, angle, trunk ? 0.73 : 0.17, t);
  const left = [], right = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const p = frame(t);
    const halfWidth = radius * (1 - 0.44 * t + (trunk ? 1.12 * (1 - t) ** 5 : 0));
    const acrossX = halfWidth * p.nx;
    const acrossY = halfWidth * p.ny * (trunk ? Math.min(1, 4 * t) : 1);
    left.push([p.x + acrossX, p.y + acrossY]);
    right.push([p.x - acrossX, p.y - acrossY]);
  }
  polygons.push(left.concat(right.reverse()));
  const tip = frame(1);
  // Round the joint so a bifurcation has no exposed stroke endpoints.
  polygons.push(Array.from({ length: 18 }, (_, j) => {
    const a = -2 * Math.PI * j / 18;
    return [tip.x + 0.56 * radius * Math.cos(a), tip.y + 0.56 * radius * Math.sin(a)];
  }));
  if (level === depth) {
    polygons.push(needlePad(tip.x, tip.y, length));
    return;
  }
  for (const fork of forks) {
    const p = frame(fork.at);
    const childAngle = 0.87 * (p.heading + fork.angle) + 0.13 * 16;
    grow(polygons, p.x, p.y, length * fork.length, childAngle, radius * fork.radius, level + 1);
  }
}

function geometry() {
  const polygons = [];
  grow(polygons, 0, 0, 1, 113, 0.14, 0);
  const points = polygons.flat();
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.max(...ys), bottom = Math.min(...ys);
  const scale = 224 / (right - left);
  const point = ([x, y]) => [round((x - left) * scale), round((top - y) * scale)].join(' ');
  const path = polygons.map(vertices => 'M' + vertices.map(point).join('L') + 'Z').join('\n');
  return { path, height: round((top - bottom) * scale) };
}

function round(value) { return Number(value.toFixed(2)); }

function artwork() {
  const { path, height } = geometry();
  const silhouette = `<path fill="${ink}" d="${path}"/>`;
  const header = '<svg xmlns="http://www.w3.org/2000/svg" role="img"';
  const master = `${header} viewBox="-4 -4 232 ${round(height + 8)}"><title>Praxis · Windswept pine</title>\n${silhouette}\n</svg>\n`;
  const tile = `${header} viewBox="0 0 256 256"><title>Praxis</title>\n<rect width="256" height="256" rx="48" fill="${paper}"/>\n<g transform="translate(16 ${round((256 - height) / 2)})">${silhouette}</g>\n</svg>\n`;
  const files = new Map([['docs/brand/praxis-pine.svg', Buffer.from(master)], ['public/praxis.svg', Buffer.from(tile)]]);
  for (const size of [180, 192, 512]) files.set(`public/praxis-${size}.png`, renderIconPng(tile, size));
  return files;
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== '--check')) throw new Error('Usage: node scripts/generate-logo.mjs [--check]');
const check = args[0] === '--check';
const changed = [];
for (const [name, content] of artwork()) {
  const file = new URL(name, root);
  const current = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (current?.equals(content)) continue;
  changed.push(name);
  if (!check) {
    await mkdir(new URL('.', file), { recursive: true });
    await writeFile(file, content);
  }
}
if (check && changed.length) throw new Error('Run npm run logo:generate to update: ' + changed.join(', '));
console.log(check ? 'All five logo assets match the mathematical generator.' : `Updated ${changed.length} logo assets.`);
