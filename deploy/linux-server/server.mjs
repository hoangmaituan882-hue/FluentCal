import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(ROOT_DIR, 'public'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DATA_FILE = path.join(DATA_DIR, 'fluentcal-data.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'web-settings.json');
const ACCOUNT_FILE = path.join(DATA_DIR, 'account.json');
const CONFLICTS_FILE = path.join(DATA_DIR, 'conflicts.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8080);
const AUTH_USER = (process.env.AUTH_USER || 'fluentcal').trim();
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const COOKIE_NAME = 'fc_session';
const MAX_BODY = 20 * 1024 * 1024;
const SYNCED = ['tasks', 'groups', 'dayMarks'];
const BACKUP_KEEP = 20;

if (!AUTH_PASSWORD) {
  console.error('[fluentcal-server] ERROR: AUTH_PASSWORD is required.');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function loadOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* ignore */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

const SESSION_SECRET = loadOrCreateSecret();

// Serialized write queue so /api/* and /dav/* never race on fluentcal-data.json
let queue = Promise.resolve();
function serialized(fn) {
  const next = queue.then(fn, fn);
  queue = next.then(() => {}, () => {});
  return next;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function emptyView() {
  return {
    tasks: {},
    groups: {},
    dayMarks: {},
    meta: { tasks: {}, groups: {}, dayMarks: {} },
  };
}

function normalizeView(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const metaSrc = src.meta && typeof src.meta === 'object' ? src.meta : {};
  const view = {
    tasks: src.tasks && typeof src.tasks === 'object' && !Array.isArray(src.tasks) ? clone(src.tasks) : {},
    groups: src.groups && typeof src.groups === 'object' && !Array.isArray(src.groups) ? clone(src.groups) : {},
    dayMarks: src.dayMarks && typeof src.dayMarks === 'object' && !Array.isArray(src.dayMarks) ? clone(src.dayMarks) : {},
    meta: { tasks: {}, groups: {}, dayMarks: {} },
  };
  for (const col of SYNCED) {
    const stamps = metaSrc[col];
    if (stamps && typeof stamps === 'object' && !Array.isArray(stamps)) {
      for (const [id, ts] of Object.entries(stamps)) {
        if (typeof ts === 'number' && Number.isFinite(ts) && ts >= 0) view.meta[col][id] = ts;
      }
    }
  }
  return view;
}

function pruneView(view, now = Date.now()) {
  for (const col of SYNCED) {
    const stamps = view.meta[col];
    for (const [id, ts] of Object.entries(stamps)) {
      if (!(id in view[col]) && ts < now - 60 * 86_400_000) delete stamps[id];
    }
  }
  return view;
}

/** Exact last-write-wins + tombstone merge matching src-tauri/src/merge.rs and sync-model.ts. */
function mergeCloud(ours, theirs) {
  for (const col of SYNCED) {
    const local = ours[col];
    const remote = theirs[col];
    const stamps = ours.meta[col];
    const other = theirs.meta[col];
    for (const id of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(stamps), ...Object.keys(other)])) {
      const a = stamps[id] ?? 0;
      const b = other[id] ?? 0;
      if (b > a || (a === 0 && b === 0 && !(id in local) && id in remote)) {
        if (id in remote) local[id] = clone(remote[id]);
        else delete local[id];
        stamps[id] = b;
      }
    }
  }
  return pruneView(ours);
}

function decodeCloudFile(text) {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) return null;
  const parsed = JSON.parse(clean);
  if (parsed?.app !== 'FluentCal' || !Number.isInteger(parsed.format) || parsed.format < 1 || parsed.format > 1) {
    throw new Error('Invalid FluentCal cloud file format');
  }
  return {
    view: pruneView(normalizeView(parsed.data)),
    device: typeof parsed.device === 'string' ? parsed.device : null,
    savedAt: Number.isSafeInteger(parsed.savedAt) ? parsed.savedAt : null,
  };
}

function encodeCloudFile(view, device = 'SERVER', savedAt = Date.now()) {
  return JSON.stringify({
    app: 'FluentCal',
    format: 1,
    device,
    savedAt,
    data: normalizeView(view),
  });
}

function computeEtag(buf) {
  return `"${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}"`;
}

async function readCloudFile() {
  try {
    const buf = await fsp.readFile(DATA_FILE);
    const parsed = decodeCloudFile(buf.toString('utf8'));
    if (!parsed) return null;
    return { buf, etag: computeEtag(buf), ...parsed };
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeAtomic(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, filePath);
}

let lastBackupAt = 0;
async function maybeBackup(prevBuf) {
  if (!prevBuf || Date.now() - lastBackupAt < 60_000) return;
  lastBackupAt = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fsp.writeFile(path.join(BACKUP_DIR, `fluentcal-${stamp}.json`), prevBuf);
  const files = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort();
  if (files.length > BACKUP_KEEP) {
    for (const old of files.slice(0, files.length - BACKUP_KEEP)) {
      await fsp.unlink(path.join(BACKUP_DIR, old)).catch(() => {});
    }
  }
}

async function writeCloudFile(text) {
  let prev = null;
  try {
    prev = await fsp.readFile(DATA_FILE);
  } catch {
    /* first write */
  }
  await maybeBackup(prev);
  await writeAtomic(DATA_FILE, text);
  const buf = Buffer.from(text, 'utf8');
  return { buf, etag: computeEtag(buf) };
}

async function readSettings() {
  try {
    const raw = await fsp.readFile(SETTINGS_FILE, 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function defaultAccount() {
  return {
    username: AUTH_USER,
    displayName: AUTH_USER,
    title: '个人云端工作台',
    passNumber: 'FC-01',
    avatarColor: '#10A37F',
    passwordSalt: null,
    passwordHash: null,
    devices: [],
  };
}

let cachedAccount = null;
function loadAccountSync() {
  if (cachedAccount) return cachedAccount;
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'));
    cachedAccount = { ...defaultAccount(), ...parsed, username: AUTH_USER };
  } catch {
    cachedAccount = defaultAccount();
  }
  return cachedAccount;
}

async function saveAccount(next) {
  cachedAccount = { ...defaultAccount(), ...next, username: AUTH_USER };
  await writeAtomic(ACCOUNT_FILE, JSON.stringify(cachedAccount, null, 2));
  return cachedAccount;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPassword(user, password) {
  const acc = loadAccountSync();
  if (!safeEqual(user, acc.username)) return false;
  if (acc.passwordSalt && acc.passwordHash) {
    const { hash } = hashPassword(password, acc.passwordSalt);
    return safeEqual(hash, acc.passwordHash);
  }
  return safeEqual(password, AUTH_PASSWORD);
}

function detectPlatform(deviceName, ua = '') {
  const s = `${deviceName} ${ua}`;
  if (/win|pc|desktop/i.test(s)) return 'Windows';
  if (/ipad/i.test(s)) return 'iPad';
  if (/iphone/i.test(s)) return 'iPhone';
  if (/android/i.test(s)) return 'Android';
  if (/mac/i.test(s)) return 'macOS';
  return 'Web';
}

async function touchDevice(deviceName, ua = '', isSync = false) {
  const name = String(deviceName || 'Web Browser').trim().slice(0, 64) || 'Web Browser';
  const acc = clone(loadAccountSync());
  const nowTs = Date.now();
  const list = Array.isArray(acc.devices) ? acc.devices : [];
  const idx = list.findIndex((d) => d.name === name);
  const entry = {
    id: idx >= 0 ? list[idx].id : crypto.createHash('sha1').update(name).digest('hex').slice(0, 10),
    name,
    platform: detectPlatform(name, ua),
    lastSeenAt: nowTs,
    lastSyncAt: isSync ? nowTs : (idx >= 0 ? list[idx].lastSyncAt ?? null : null),
  };
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  acc.devices = list.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)).slice(0, 12);
  await saveAccount(acc);
}

async function readConflicts() {
  try {
    const raw = await fsp.readFile(CONFLICTS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeConflicts(list) {
  await writeAtomic(CONFLICTS_FILE, JSON.stringify(list.slice(0, 60), null, 2));
}

function canonicalStr(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalStr).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalStr(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

function detectServerConflicts(serverView, clientView, baseStamps, clientDevice, serverDevice) {
  if (!baseStamps || typeof baseStamps !== 'object') return [];
  const out = [];
  const detectedAt = Date.now();
  const FIELD_MAP = {
    title: '标题', name: '名称', note: '备注', start: '开始日期', end: '截止日期',
    time: '时刻', done: '完成状态', status: '状态', priority: '优先级',
    progress: '进度', groupId: '分组', color: '主题色', habit: '习惯记录', subscription: '订阅信息',
  };
  for (const col of SYNCED) {
    const sCol = serverView[col] || {};
    const cCol = clientView[col] || {};
    const sMeta = serverView.meta?.[col] || {};
    const cMeta = clientView.meta?.[col] || {};
    const bMeta = baseStamps[col] || {};
    const ids = new Set([...Object.keys(sCol), ...Object.keys(cCol), ...Object.keys(sMeta), ...Object.keys(cMeta)]);
    for (const id of ids) {
      const sTs = sMeta[id] ?? 0;
      const cTs = cMeta[id] ?? 0;
      const bTs = bMeta[id] ?? 0;
      if (!sTs || !cTs || sTs === cTs) continue;
      if (!(sTs > bTs && cTs > bTs)) continue;
      const sVal = id in sCol ? sCol[id] : null;
      const cVal = id in cCol ? cCol[id] : null;
      if (canonicalStr(sVal) === canonicalStr(cVal)) continue;
      if (sVal === null && cVal === null) continue;
      const sample = cVal || sVal || {};
      const itemKind = col === 'groups'
        ? 'group'
        : col === 'dayMarks'
          ? 'dayMark'
          : sample.habitOnly || sample.habit
            ? 'habit'
            : sample.subscriptionOnly || sample.subscription
              ? 'subscription'
              : sample.countdownOnly
                ? 'countdown'
                : 'task';
      const title = col === 'tasks'
        ? (cVal?.title || sVal?.title || `事项 ${id.slice(0, 6)}`)
        : col === 'groups'
          ? (cVal?.name || sVal?.name || `分组 ${id.slice(0, 6)}`)
          : `日期色彩 · ${id}`;
      let changedFields = ['内容变更'];
      if (cVal === null) changedFields = ['本机删除 / 云端修改'];
      else if (sVal === null) changedFields = ['本机修改 / 云端删除'];
      else if (col === 'dayMarks') changedFields = ['标记颜色'];
      else {
        const diff = [];
        for (const k of new Set([...Object.keys(cVal), ...Object.keys(sVal)])) {
          if (k === 'updatedAt' || k === 'createdAt' || k === 'order') continue;
          if (canonicalStr(cVal[k]) !== canonicalStr(sVal[k])) diff.push(FIELD_MAP[k] || k);
        }
        if (diff.length) changedFields = diff.slice(0, 5);
      }
      out.push({
        id: `${col}:${id}:${cTs}:${sTs}`,
        collection: col,
        itemId: id,
        itemKind,
        title,
        detectedAt,
        localDevice: clientDevice || '本机',
        remoteDevice: serverDevice || '云端其他设备',
        localUpdatedAt: cTs,
        remoteUpdatedAt: sTs,
        localValue: cVal !== null ? clone(cVal) : null,
        remoteValue: sVal !== null ? clone(sVal) : null,
        changedFields,
        autoWinner: sTs > cTs ? 'remote' : 'local',
      });
    }
  }
  return out;
}

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) delete target[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// Auth helpers
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function signSession(user, exp) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.indexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.u || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function checkBasicAuth(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const raw = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
    const sep = raw.indexOf(':');
    if (sep < 0) return false;
    const user = raw.slice(0, sep);
    const pass = raw.slice(sep + 1);
    return verifyPassword(user, pass);
  } catch {
    return false;
  }
}

function isAuthedApi(req) {
  const cookies = parseCookies(req);
  if (verifySession(cookies[COOKIE_NAME])) return true;
  if (checkBasicAuth(req)) return true;
  return false;
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || !!req.socket.encrypted;
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) {
      const err = new Error('Payload too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  const safePath = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let target = path.join(PUBLIC_DIR, safePath);
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat;
  try {
    stat = await fsp.stat(target);
    if (stat.isDirectory()) {
      target = path.join(target, 'index.html');
      stat = await fsp.stat(target);
    }
  } catch {
    if (!path.extname(target)) {
      target = path.join(PUBLIC_DIR, 'index.html');
      try {
        stat = await fsp.stat(target);
      } catch {
        res.writeHead(404).end('Not Found');
        return;
      }
    } else {
      res.writeHead(404).end('Not Found');
      return;
    }
  }
  const ext = path.extname(target).toLowerCase();
  const isImmutable = target.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).pipe(res);
}

// Normalize WebDAV ETag header comparison (handles strong "..." or Cloudflare-weakened W/"...")
function stripWeak(tag) {
  return String(tag || '').trim().replace(/^W\//i, '');
}

async function handleWebDav(req, res, pathname) {
  if (!checkBasicAuth(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="FluentCal WebDAV"',
      'Cache-Control': 'no-store, no-transform',
    });
    res.end('Unauthorized');
    return;
  }
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') {
    res.writeHead(200, {
      Allow: 'OPTIONS, GET, HEAD, PUT, MKCOL',
      DAV: '1',
      'Cache-Control': 'no-store, no-transform',
    });
    res.end();
    return;
  }
  if (method === 'MKCOL') {
    // Directories are virtualized around the single fluentcal-data.json file.
    res.writeHead(201, { 'Cache-Control': 'no-store, no-transform' });
    res.end();
    return;
  }
  // Accept /dav/fluentcal-data.json or /dav/<folder>/fluentcal-data.json
  const fileMatch = pathname.endsWith('/fluentcal-data.json');
  if (!fileMatch) {
    res.writeHead(method === 'GET' || method === 'HEAD' ? 404 : 405, { 'Cache-Control': 'no-store, no-transform' });
    res.end('Not Found');
    return;
  }

  if (method === 'GET' || method === 'HEAD') {
    const file = await serialized(() => readCloudFile());
    if (!file) {
      res.writeHead(404, { 'Cache-Control': 'no-store, no-transform' });
      res.end('Not Found');
      return;
    }
    const inm = req.headers['if-none-match'];
    if (inm && stripWeak(inm) === stripWeak(file.etag)) {
      res.writeHead(304, {
        ETag: file.etag,
        'Cache-Control': 'no-store, no-transform',
      });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': file.buf.length,
      ETag: file.etag,
      'Cache-Control': 'no-store, no-transform',
    });
    res.end(method === 'HEAD' ? undefined : file.buf);
    return;
  }

  if (method === 'PUT') {
    const body = await readBody(req);
    const text = body.toString('utf8');
    let parsedDav = null;
    try {
      parsedDav = decodeCloudFile(text);
    } catch {
      res.writeHead(400, { 'Cache-Control': 'no-store, no-transform' });
      res.end('Invalid FluentCal sync payload');
      return;
    }
    const ifMatch = req.headers['if-match'];
    const ifNoneMatch = req.headers['if-none-match'];
    const result = await serialized(async () => {
      const current = await readCloudFile();
      if (ifNoneMatch === '*' && current) return { status: 412 };
      if (ifMatch) {
        if (!current || stripWeak(ifMatch) !== stripWeak(current.etag)) return { status: 412 };
      }
      const written = await writeCloudFile(text);
      await touchDevice(parsedDav?.device || 'Desktop / WebDAV', req.headers['user-agent'] || '', true);
      return { status: current ? 204 : 201, etag: written.etag };
    });
    if (result.status === 412) {
      res.writeHead(412, { 'Cache-Control': 'no-store, no-transform' });
      res.end('Precondition Failed');
      return;
    }
    res.writeHead(result.status, {
      ETag: result.etag,
      'Cache-Control': 'no-store, no-transform',
    });
    res.end();
    return;
  }

  res.writeHead(405, { Allow: 'OPTIONS, GET, HEAD, PUT, MKCOL' });
  res.end('Method Not Allowed');
}

async function handleApi(req, res, pathname) {
  const method = req.method.toUpperCase();
  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/login' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const user = typeof body.user === 'string' && body.user.trim() ? body.user.trim() : AUTH_USER;
    const password = typeof body.password === 'string' ? body.password : '';
    if (!verifyPassword(user, password)) {
      return sendJson(res, 401, { error: '账号或密码错误，请重新核验工牌凭证' });
    }
    await serialized(() => touchDevice(body.device || 'Web Browser', req.headers['user-agent'] || '', false));
    const exp = Date.now() + 30 * 86_400_000;
    const token = signSession(AUTH_USER, exp);
    const flags = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${30 * 86400}`];
    if (isHttps(req)) flags.push('Secure');
    return sendJson(res, 200, { ok: true, user: AUTH_USER }, { 'Set-Cookie': flags.join('; ') });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    const flags = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (isHttps(req)) flags.push('Secure');
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': flags.join('; ') });
  }
  if (pathname === '/api/me' && method === 'GET') {
    return sendJson(res, 200, { authenticated: isAuthedApi(req), user: isAuthedApi(req) ? AUTH_USER : null });
  }

  if (!isAuthedApi(req)) {
    return sendJson(res, 401, { error: '未登录或会话已过期' });
  }

  if (pathname === '/api/account' && method === 'GET') {
    const payload = await serialized(async () => {
      const acc = loadAccountSync();
      const file = await readCloudFile();
      const conflicts = await readConflicts();
      let backupCount = 0;
      try {
        backupCount = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).length;
      } catch {
        backupCount = 0;
      }
      return {
        username: acc.username,
        displayName: acc.displayName,
        title: acc.title,
        passNumber: acc.passNumber,
        avatarColor: acc.avatarColor,
        devices: acc.devices || [],
        backupCount,
        lastSyncAt: file?.savedAt ?? null,
        lastSyncDevice: file?.device ?? null,
        conflictCount: conflicts.length,
      };
    });
    return sendJson(res, 200, payload);
  }

  if (pathname === '/api/account' && method === 'PATCH') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const result = await serialized(async () => {
      const acc = clone(loadAccountSync());
      if (typeof body.displayName === 'string' && body.displayName.trim()) {
        acc.displayName = body.displayName.trim().slice(0, 32);
      }
      if (typeof body.title === 'string') {
        acc.title = body.title.trim().slice(0, 48) || '个人云端工作台';
      }
      if (typeof body.passNumber === 'string' && body.passNumber.trim()) {
        acc.passNumber = body.passNumber.trim().slice(0, 16);
      }
      if (typeof body.avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.avatarColor.trim())) {
        acc.avatarColor = body.avatarColor.trim().toUpperCase();
      }
      if (typeof body.newPassword === 'string' && body.newPassword.length > 0) {
        if (body.newPassword.length < 6) {
          return { status: 400, data: { ok: false, error: '新密码至少需要 6 位字符' } };
        }
        if (!verifyPassword(acc.username, String(body.currentPassword || ''))) {
          return { status: 403, data: { ok: false, error: '当前密码不正确' } };
        }
        const hashed = hashPassword(body.newPassword);
        acc.passwordSalt = hashed.salt;
        acc.passwordHash = hashed.hash;
      }
      const saved = await saveAccount(acc);
      const file = await readCloudFile();
      const conflicts = await readConflicts();
      let backupCount = 0;
      try {
        backupCount = (await fsp.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).length;
      } catch {
        backupCount = 0;
      }
      return {
        status: 200,
        data: {
          ok: true,
          account: {
            username: saved.username,
            displayName: saved.displayName,
            title: saved.title,
            passNumber: saved.passNumber,
            avatarColor: saved.avatarColor,
            devices: saved.devices || [],
            backupCount,
            lastSyncAt: file?.savedAt ?? null,
            lastSyncDevice: file?.device ?? null,
            conflictCount: conflicts.length,
          },
        },
      };
    });
    return sendJson(res, result.status, result.data);
  }

  if (pathname === '/api/conflicts' && method === 'GET') {
    const conflicts = await serialized(() => readConflicts());
    return sendJson(res, 200, { conflicts });
  }

  if (pathname.startsWith('/api/conflicts/') && pathname.endsWith('/resolve') && method === 'POST') {
    const id = decodeURIComponent(pathname.slice('/api/conflicts/'.length, -'/resolve'.length));
    const remaining = await serialized(async () => {
      const list = await readConflicts();
      const next = list.filter((c) => c.id !== id);
      await writeConflicts(next);
      return next;
    });
    return sendJson(res, 200, { ok: true, conflicts: remaining });
  }

  if (pathname === '/api/doc' && method === 'GET') {
    const payload = await serialized(async () => {
      const file = await readCloudFile();
      const settings = await readSettings();
      const conflicts = await readConflicts();
      return {
        view: file ? file.view : emptyView(),
        etag: file ? file.etag : null,
        savedAt: file ? file.savedAt : null,
        device: file ? file.device : null,
        settings,
        conflicts,
      };
    });
    return sendJson(res, 200, payload);
  }

  if (pathname === '/api/sync' && method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const incoming = normalizeView(body.view);
    const device = typeof body.device === 'string' && body.device.trim() ? body.device.trim().slice(0, 64) : 'iPad Web';
    const result = await serialized(async () => {
      const current = await readCloudFile();
      const base = current ? current.view : emptyView();
      const detected = current
        ? detectServerConflicts(base, incoming, body.baseStamps, device, current.device)
        : [];
      let allConflicts = await readConflicts();
      if (detected.length) {
        const byItem = new Map(allConflicts.map((c) => [`${c.collection}:${c.itemId}`, c]));
        for (const c of detected) byItem.set(`${c.collection}:${c.itemId}`, c);
        allConflicts = [...byItem.values()].sort((a, b) => (b.detectedAt || 0) - (a.detectedAt || 0));
        await writeConflicts(allConflicts);
      }
      const merged = mergeCloud(clone(base), incoming);
      const changed = !current || JSON.stringify(base) !== JSON.stringify(merged);
      await touchDevice(device, req.headers['user-agent'] || '', true);
      if (changed) {
        const savedAt = Date.now();
        const written = await writeCloudFile(encodeCloudFile(merged, device, savedAt));
        return { view: merged, etag: written.etag, savedAt, device, conflicts: allConflicts };
      }
      return { view: merged, etag: current.etag, savedAt: current.savedAt, device: current.device, conflicts: allConflicts };
    });
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/settings' && method === 'PATCH') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const patch = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch) ? body.patch : {};
    const next = await serialized(async () => {
      const current = await readSettings();
      deepMerge(current, patch);
      await writeAtomic(SETTINGS_FILE, JSON.stringify(current, null, 2));
      return current;
    });
    return sendJson(res, 200, { settings: next });
  }

  return sendJson(res, 404, { error: 'Not Found' });
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      if (pathname === '/dav' || pathname.startsWith('/dav/')) {
        await handleWebDav(req, res, pathname);
      } else if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(req, res, pathname);
      } else {
        res.writeHead(405).end('Method Not Allowed');
      }
    } catch (e) {
      const status = e?.statusCode || 500;
      console.error('[fluentcal-server]', e);
      if (!res.headersSent) sendJson(res, status, { error: status === 413 ? '数据超过 20MB 限制' : '服务器内部错误' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.listen(PORT, HOST, () => {
    console.log(`[fluentcal-server] listening on http://${HOST}:${PORT}`);
    console.log(`[fluentcal-server] data dir: ${DATA_DIR}`);
    console.log(`[fluentcal-server] public dir: ${PUBLIC_DIR}`);
  });
}
