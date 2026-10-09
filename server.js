'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = 3000;
const HOST = '0.0.0.0';
const MAX_BODY = 1024 * 1024;

const tasks = [];
let nextId = 1;

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        failed = true;
        const err = new Error('Request body too large');
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        const err = new Error('Invalid JSON');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', (e) => {
      if (failed) return;
      failed = true;
      e.status = 400;
      reject(e);
    });
  });
}

function findIndex(idStr) {
  if (!/^\d+$/.test(idStr)) return -1;
  const id = Number(idStr);
  return tasks.findIndex((t) => t.id === id);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const method = req.method;

  if (path === '/tasks') {
    if (method === 'GET' || method === 'HEAD') {
      const pending = (url.searchParams.get('pending') || '').toLowerCase();
      const list = pending === 'true' || pending === '1'
        ? tasks.filter((t) => !t.done)
        : tasks;
      return send(res, 200, list);
    }
    if (method === 'POST') {
      const body = await readJson(req);
      if (!isObject(body) || typeof body.text !== 'string' || body.text.trim() === '') {
        return send(res, 400, { error: 'text must be a non-empty string' });
      }
      const task = { id: nextId++, text: body.text, done: false };
      tasks.push(task);
      return send(res, 201, task);
    }
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Method not allowed' });
  }

  const m = /^\/tasks\/([^/]+)$/.exec(path);
  if (m) {
    const idx = findIndex(m[1]);

    if (method === 'GET' || method === 'HEAD') {
      if (idx === -1) return send(res, 404, { error: 'Task not found' });
      return send(res, 200, tasks[idx]);
    }
    if (method === 'PATCH' || method === 'PUT') {
      if (idx === -1) {
        req.resume();
        return send(res, 404, { error: 'Task not found' });
      }
      const body = await readJson(req);
      if (!isObject(body)) {
        return send(res, 400, { error: 'Body must be a JSON object' });
      }
      const hasDone = Object.prototype.hasOwnProperty.call(body, 'done');
      const hasText = Object.prototype.hasOwnProperty.call(body, 'text');
      if (!hasDone && !hasText) {
        return send(res, 400, { error: 'done must be a boolean' });
      }
      if (hasDone && typeof body.done !== 'boolean') {
        return send(res, 400, { error: 'done must be a boolean' });
      }
      if (hasText && (typeof body.text !== 'string' || body.text.trim() === '')) {
        return send(res, 400, { error: 'text must be a non-empty string' });
      }
      const task = tasks[idx];
      if (hasDone) task.done = body.done;
      if (hasText) task.text = body.text;
      return send(res, 200, task);
    }
    if (method === 'DELETE') {
      if (idx === -1) return send(res, 404, { error: 'Task not found' });
      const [removed] = tasks.splice(idx, 1);
      return send(res, 200, removed);
    }
    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return send(res, 405, { error: 'Method not allowed' });
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = err && err.status ? err.status : 500;
    send(res, status, { error: status === 500 ? 'Internal server error' : err.message });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`To-do service listening on http://${HOST}:${PORT}`);
});
