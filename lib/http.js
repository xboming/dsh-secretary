/**
 * 本机 HTTP 接口：面板只从这里读快照、写两个动作。
 * 只接受本机回环地址；不缓存；POST 必须是 JSON。
 */

import { stamp } from './util.js';

const PREFIX = '/dsh-secretary/api';
const MAX_BODY = 256 * 1024;

export function registerRoutes(ctx, secretary) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    async handler(req, res) {
      try {
        if (!isLoopback(req)) {
          return sendJson(res, 403, { error: { code: 'FORBIDDEN', message: '只接受本机访问。' } });
        }
        // 写操作（POST）必须来自本页同源且声明 JSON：仅回环地址不构成身份校验，
        // 否则本机其它进程/页面可借 text/plain 表单直接改写记录。
        if (req.method === 'POST') {
          const rejected = guardWrite(req);
          if (rejected) return sendJson(res, rejected.status, rejected.body);
        }
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const route = url.pathname.slice(PREFIX.length) || '/';

        if (route === '/snapshot' && req.method === 'GET') {
          // doneLimit=all 表示把已完成记录全部带回（面板"全部记录"页需要）
          const doneLimit = url.searchParams.get('doneLimit') ?? undefined;
          return sendJson(res, 200, await secretary.snapshot(new Date(), { doneLimit }));
        }
        if (route === '/search' && req.method === 'GET') {
          // 面板搜索：复用核心 query()，按关键词在标题与时间轴原话里找
          const keyword = url.searchParams.get('q') ?? '';
          const domainKey = url.searchParams.get('domain') ?? undefined;
          const limit = Number(url.searchParams.get('limit')) || 50;
          const items = await secretary.query({ domain: domainKey, keyword, limit, kind: 'all' });
          return sendJson(res, 200, { ok: true, keyword, count: items.length, items });
        }
        if (route === '/health' && req.method === 'GET') {
          return sendJson(res, 200, { ok: true, at: stamp(), root: secretary.store.root });
        }
        if (route === '/add' && req.method === 'POST') {
          const body = await readJson(req);
          const result = await secretary.addRecord({
            domain: body.domain ?? 'work',
            text: body.text,
            title: body.title,
            fields: body.fields ?? {},
            updateExisting: body.updateExisting === true,
          });
          return sendJson(res, 200, { ok: true, result });
        }
        if (route === '/update' && req.method === 'POST') {
          const body = await readJson(req);
          const result = await secretary.updateRecord({
            id: body.id,
            status: body.status,
            stage: body.stage,
            progress: body.progress,
            next: body.next,
            category: body.category,
            // deadline 必须透传，否则改期只更新了备注，前端却显示成功
            deadline: body.deadline,
            openEnded: body.openEnded,
            note: body.note,
            quote: body.quote,
          });
          return sendJson(res, 200, { ok: true, result });
        }
        if (route === '/link' && req.method === 'POST') {
          const body = await readJson(req);
          const { linkEntries } = await import('./link.js');
          const result = await linkEntries(secretary, {
            id: body.id,
            action: body.action,
            to: body.to,
            title: body.title,
            // promote 也是新建记录：期限必须透传，否则会绕过期限防线
            deadline: body.deadline,
            openEnded: body.openEnded === true,
          });
          return sendJson(res, 200, { ok: true, result });
        }
        if (route === '/schedule' && req.method === 'POST') {
          const body = await readJson(req);
          return sendJson(res, 200, { ok: true, result: await secretary.updateSchedule(body) });
        }
        return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '未知接口。' } });
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        if (status >= 500) console.error('[dsh-secretary] 请求失败', error);
        return sendJson(res, status, {
          error: { code: error?.code ?? 'INTERNAL', message: error?.message ?? '处理请求时出错。' },
        });
      }
    },
  });
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * 写入防护：
 *   1. Content-Type 必须是 application/json（挡掉跨站表单的 text/plain 提交）
 *   2. Origin 若存在，host 必须是本机回环（挡掉浏览器里的跨站脚本）
 *   3. Sec-Fetch-Site 若存在，不能是 cross-site
 * 返回 null 表示放行，否则返回 { status, body }。
 */
function guardWrite(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return {
      status: 415,
      body: { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '写操作必须以 application/json 提交。' } },
    };
  }
  const origin = req.headers.origin;
  if (origin) {
    const host = hostOf(origin);
    if (!isLoopbackHost(host)) {
      return {
        status: 403,
        body: { error: { code: 'BAD_ORIGIN', message: '写操作只接受来自本机页面的请求。' } },
      };
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return {
      status: 403,
      body: { error: { code: 'BAD_FETCH_SITE', message: '写操作只接受同源请求。' } },
    };
  }
  return null;
}

function hostOf(origin) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function sendJson(res, status, value) {
  if (res.headersSent) return undefined;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
  return undefined;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('请求体过大。');
      error.status = 413;
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('请求体不是合法 JSON。');
    error.status = 400;
    error.code = 'INVALID_JSON';
    throw error;
  }
}
