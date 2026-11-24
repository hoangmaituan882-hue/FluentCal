import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const raw = JSON.parse(
  readFileSync(resolve(root, 'node_modules/@iconify-json/solar/icons.json'), 'utf8'),
);
const icons = raw.icons;

/**
 * FluentCal icon name -> Solar base name (prefers -line-duotone / -broken / -linear).
 * Solar icons use 24x24 viewBox with squircle rounded curves and breathing room.
 */
const MAP = {
  chevronLeft: 'alt-arrow-left',
  chevronRight: 'alt-arrow-right',
  chevronUp: 'alt-arrow-up',
  chevronDown: 'alt-arrow-down',
  add: 'add',
  addCircle: 'add-circle',
  plus: 'add',
  remove: 'minus',
  delete: 'trash-bin-minimalistic',
  edit: 'pen-new-square',
  compose: 'pen-new-square',
  settings: 'settings',
  search: 'magnifer',
  calendar: 'calendar',
  calendarDay: 'calendar-date',
  calendarWeek: 'calendar-minimalistic',
  pin: 'pin',
  unpin: 'pin-circle',
  lock: 'lock-keyhole',
  unlock: 'lock-keyhole-unlocked',
  more: 'menu-dots',
  close: 'close',
  checkMark: 'check-read',
  check: 'check-circle',
  clock: 'clock-circle',
  alarm: 'alarm',
  alarmOff: 'bell-off',
  notification: 'bell',
  repeat: 'repeat',
  flag: 'flag',
  inbox: 'inbox-line',
  color: 'pallete-2',
  palette: 'pallete-2',
  today: 'sun-2',
  filter: 'filter',
  sync: 'refresh-circle',
  cloud: 'cloud',
  key: 'key',
  save: 'diskette',
  folder: 'folder-with-files',
  openFile: 'folder-open',
  download: 'download-minimalistic',
  upload: 'upload-minimalistic',
  info: 'info-circle',
  about: 'info-circle',
  warning: 'danger-triangle',
  error: 'danger-circle',
  completed: 'check-circle',
  link: 'link-minimalistic-2',
  dependency: 'link-circle',
  list: 'list',
  checklist: 'checklist-minimalistic',
  board: 'widget-2',
  eye: 'eye',
  eyeOff: 'eye-closed',
  brightness: 'sun-2',
  sun: 'sun-2',
  moon: 'moon-stars',
  contrast: 'contrast',
  back: 'arrow-left',
  forward: 'arrow-right',
  copy: 'copy',
  cut: 'scissors',
  paste: 'clipboard-text',
  undo: 'undo-left-round',
  redo: 'undo-right-round',
  zoomIn: 'magnifer-zoom-in',
  zoomOut: 'magnifer-zoom-out',
  keyboard: 'keyboard',
  power: 'power',
  window: 'window-frame',
  desktop: 'monitor',
  layers: 'layers',
  tag: 'tag',
  group: 'widget-add',
  home: 'home-2',
  help: 'question-circle',
  font: 'text-square',
  mouse: 'mouse-minimalistic',
  data: 'database',
  history: 'history',
  timer: 'stopwatch',
  sliders: 'tuning-2',
  chart: 'chart-2',
  globe: 'global',
  sort: 'sort-vertical',
  switchArrows: 'transfer-horizontal',
  star: 'star',
  starFill: 'star',
  checkboxEmpty: 'stop',
  checkboxFill: 'check-square',
  statusCircle: 'record-circle',
  statusCircleInner: 'record-minimalistic',
  statusCircleRing: 'record',
  statusInfo: 'info-circle',
  statusCheck: 'check-circle',
  statusExclamation: 'danger-circle',
  statusX: 'close-circle',
  statusTriangle: 'danger-triangle',
  sidebar: 'panel-left',
  panelRight: 'panel-right',
  gantt: 'align-left',
  milestone: 'flag-2',
  note: 'document-text',
  flame: 'fire',
  sparkles: 'stars-minimalistic',
  subscription: 'card-2',
  wallet: 'wallet-money',
  bill: 'bill-list',
  crown: 'crown',
};

// Group custom icon catalog mapped to Solar line-duotone icons
const GROUP_MAP = {
  page: 'document-text',
  arrow: 'round-arrow-right',
  padlock: 'lock-keyhole',
  check: 'check-circle',
  cross: 'close-circle',
  info: 'info-circle',
  question: 'question-circle',
  design: 'ruler-pen',
  vector: 'pen-2',
  images: 'gallery',
  table: 'widget-4',
  presentation: 'presentation-graph',
  blueprint: 'ruler-angular',
  swatches: 'pallete-2',
  barChart: 'chart-2',
  lineChart: 'graph-up',
  pieChart: 'pie-chart-2',
  junk: 'archive-minimalistic',
};

function resolveSolar(base, preferredStyles) {
  for (const st of preferredStyles) {
    const key = `${base}-${st}`;
    if (icons[key]?.body) return { key, body: icons[key].body };
  }
  // Fallback exact match
  if (icons[base]?.body) return { key: base, body: icons[base].body };
  return null;
}

const missing = [];
const solarLinear = {};
const solarDuotone = {};

for (const [name, base] of Object.entries(MAP)) {
  // For minimal glyphs like add/close/more/chevrons, prefer crisp 'linear'; for richer symbols, 'broken' or 'linear'
  const preferLinear = new Set([
    'chevronLeft', 'chevronRight', 'chevronUp', 'chevronDown',
    'add', 'plus', 'close', 'more', 'back', 'forward', 'checkMark', 'search', 'sort',
  ]);
  const primary = resolveSolar(
    base,
    name === 'starFill'
      ? ['bold', 'bold-duotone', 'linear']
      : preferLinear.has(name)
        ? ['linear', 'broken', 'line-duotone']
        : ['line-duotone', 'broken', 'linear'],
  );
  const active = resolveSolar(base, ['bold-duotone', 'line-duotone', 'bold', 'linear']);
  if (!primary) {
    missing.push(`${name} -> ${base}`);
  } else {
    solarLinear[name] = primary.body;
    if (active && active.body !== primary.body) {
      solarDuotone[name] = active.body;
    }
  }
}

const solarGroup = {};
for (const [name, base] of Object.entries(GROUP_MAP)) {
  const res = resolveSolar(base, ['line-duotone', 'broken', 'linear']);
  if (!res) {
    missing.push(`group:${name} -> ${base}`);
  } else {
    solarGroup[name] = res.body;
  }
}

if (missing.length) {
  console.error('Missing Solar icons:', missing);
  process.exit(1);
}

const out = `// Auto-generated from @iconify-json/solar (CC BY 4.0 / 480 Design).
// Run \`node scripts/gen-solar-icons.mjs\` after changing icon mappings.
// Zero runtime network requests; all SVGs use a 24x24 viewBox with squircle breathing room.

export const SOLAR_ICONS: Record<string, string> = ${JSON.stringify(solarLinear, null, 2)};

export const SOLAR_ACTIVE_ICONS: Record<string, string> = ${JSON.stringify(solarDuotone, null, 2)};

export const SOLAR_GROUP_ICONS: Record<string, string> = ${JSON.stringify(solarGroup, null, 2)};
`;

writeFileSync(resolve(root, 'src/fluent/solarIcons.ts'), out, 'utf8');
console.log(
  `Generated src/fluent/solarIcons.ts: ${Object.keys(solarLinear).length} icons, ${Object.keys(solarDuotone).length} active duotone variants, ${Object.keys(solarGroup).length} group icons.`,
);
