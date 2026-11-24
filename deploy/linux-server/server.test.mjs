import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'fluentcal-srv-test-'));
const pubDir = path.join(tmpRoot, 'public');
const dataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(pubDir, { recursive: true });
fs.writeFileSync(path.join(pubDir, 'index.html'), '<!doctype html><html><body>FluentCal</body></html>');
fs.writeFileSync(path.join(pubDir, 'manifest.webmanifest'), '{"name":"FluentCal"}');

process.env.PUBLIC_DIR = pubDir;
process.env.DATA_DIR = dataDir;
process.env.AUTH_USER = 'tester';
process.env.AUTH_PASSWORD = 'secret-pass-123';

const { createAppServer } = await import('./server.mjs');

const server = createAppServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

test.after(() => {
  server.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('static index & manifest are served', async () => {
  const r1 = await fetch(`${base}/`);
  assert.equal(r1.status, 200);
  assert.match(await r1.text(), /FluentCal/);

  const r2 = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(r2.status, 200);
  assert.match(r2.headers.get('content-type') || '', /manifest\+json/);
});

test('api auth, sync merge, settings and webdav interop', async () => {
  // Unauthenticated access blocked
  const unauth = await fetch(`${base}/api/doc`);
  assert.equal(unauth.status, 401);

  // Bad password rejected
  const badLogin = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'tester', password: 'wrong' }),
  });
  assert.equal(badLogin.status, 401);

  // Good login issues HttpOnly cookie
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'tester', password: 'secret-pass-123' }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.match(cookie, /^fc_session=/);

  const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.deepEqual(await me.json(), { authenticated: true, user: 'tester' });

  // WebDAV MKCOL + PUT from Windows Desktop
  const basic = 'Basic ' + Buffer.from('tester:secret-pass-123').toString('base64');
  const mkcol = await fetch(`${base}/dav/FluentCal/`, { method: 'MKCOL', headers: { Authorization: basic } });
  assert.equal(mkcol.status, 201);

  const desktopDoc = {
    app: 'FluentCal',
    format: 1,
    device: 'WIN-PC',
    savedAt: 1000,
    data: {
      tasks: { t1: { id: 't1', title: 'PC Task', start: '2026-11-23', end: '2026-11-23', done: false, progress: 0 } },
      groups: {},
      dayMarks: {},
      meta: { tasks: { t1: 1000 }, groups: {}, dayMarks: {} },
    },
  };
  const davPut1 = await fetch(`${base}/dav/FluentCal/fluentcal-data.json`, {
    method: 'PUT',
    headers: { Authorization: basic, 'If-None-Match': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify(desktopDoc),
  });
  assert.equal(davPut1.status, 201);
  const etag1 = davPut1.headers.get('etag');
  assert.ok(etag1 && !etag1.startsWith('W/'));

  // Conditional GET returns 304 on matching ETag (including Cloudflare-weakened W/)
  const dav304 = await fetch(`${base}/dav/FluentCal/fluentcal-data.json`, {
    headers: { Authorization: basic, 'If-None-Match': `W/${etag1}` },
  });
  assert.equal(dav304.status, 304);

  // iPad API sees the PC task and merges a new iPad task
  const doc1 = await (await fetch(`${base}/api/doc`, { headers: { Cookie: cookie } })).json();
  assert.equal(doc1.view.tasks.t1.title, 'PC Task');

  const syncRes = await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device: 'iPad Web',
      view: {
        tasks: {
          t1: { id: 't1', title: 'PC Task', start: '2026-11-23', end: '2026-11-23', done: false, progress: 0 },
          t2: { id: 't2', title: 'iPad Task', start: '2026-11-24', end: '2026-11-24', done: false, progress: 0 },
        },
        groups: {},
        dayMarks: {},
        meta: { tasks: { t1: 1000, t2: 2000 }, groups: {}, dayMarks: {} },
      },
    }),
  });
  assert.equal(syncRes.status, 200);
  const syncJson = await syncRes.json();
  assert.equal(syncJson.view.tasks.t2.title, 'iPad Task');

  // Stale desktop ETag now gets 412 conflict
  const stalePut = await fetch(`${base}/dav/FluentCal/fluentcal-data.json`, {
    method: 'PUT',
    headers: { Authorization: basic, 'If-Match': etag1, 'Content-Type': 'application/json' },
    body: JSON.stringify(desktopDoc),
  });
  assert.equal(stalePut.status, 412);

  // Desktop fetches merged file including iPad task
  const davGet = await fetch(`${base}/dav/FluentCal/fluentcal-data.json`, {
    headers: { Authorization: basic },
  });
  assert.equal(davGet.status, 200);
  const mergedOnDav = await davGet.json();
  assert.equal(mergedOnDav.data.tasks.t2.title, 'iPad Task');

  // Settings patch persists
  const setRes = await fetch(`${base}/api/settings`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch: { calendar: { view: 'gantt' } } }),
  });
  assert.equal(setRes.status, 200);
  const doc2 = await (await fetch(`${base}/api/doc`, { headers: { Cookie: cookie } })).json();
  assert.equal(doc2.settings.calendar.view, 'gantt');

  // Personal Account profile + connected devices tracking
  const acc1 = await (await fetch(`${base}/api/account`, { headers: { Cookie: cookie } })).json();
  assert.equal(acc1.username, 'tester');
  assert.ok(acc1.devices.length >= 2, 'should track connected devices across WebDAV & API');

  const patchAcc = await fetch(`${base}/api/account`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Linze', title: '个人数字空间', passNumber: 'FC-07' }),
  });
  assert.equal(patchAcc.status, 200);
  const patchAccJson = await patchAcc.json();
  assert.equal(patchAccJson.account.displayName, 'Linze');
  assert.equal(patchAccJson.account.passNumber, 'FC-07');

  // Concurrent conflict detection via baseStamps & conflict resolution
  const conflictSync = await fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device: 'Android Phone',
      baseStamps: { tasks: { t2: 1500 }, groups: {}, dayMarks: {} },
      view: {
        tasks: {
          t1: { id: 't1', title: 'PC Task', start: '2026-11-23', end: '2026-11-23', done: false, progress: 0 },
          t2: { id: 't2', title: 'Android Edited Task', start: '2026-11-24', end: '2026-11-24', done: true, progress: 100 },
        },
        groups: {},
        dayMarks: {},
        meta: { tasks: { t1: 1000, t2: 2200 }, groups: {}, dayMarks: {} },
      },
    }),
  });
  assert.equal(conflictSync.status, 200);
  const conflictJson = await conflictSync.json();
  assert.equal(conflictJson.conflicts.length, 1);
  assert.equal(conflictJson.conflicts[0].itemId, 't2');

  const resolveRes = await fetch(`${base}/api/conflicts/${encodeURIComponent(conflictJson.conflicts[0].id)}/resolve`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice: 'local' }),
  });
  assert.equal(resolveRes.status, 200);
  const resolvedJson = await resolveRes.json();
  assert.equal(resolvedJson.conflicts.length, 0);
});
