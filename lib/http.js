/**
 * 本机 HTTP 接口：面板只从这里读快照、写两个动作。
 * 只接受本机回环地址；不缓存；POST 必须是 JSON。
 *
 * 热重载自检：本模块被重新 import 时 LOADED_AT 会变，
 * 改完代码对比 /health 的 loadedAt 就能知道新代码有没有接管。
 */

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
const { stamp } = await import(rel('./util.js', import.meta.url));

const PREFIX = '/dsh-secretary/api';
const MAX_BODY = 256 * 1024;

/**
 * 本模块被求值的时刻。
 *
 * 宿主对插件模块有进程级缓存，热重载是否真的发生了，光看代码改没改是判断不出来的。
 * 这个值随每次 import 变化：改完代码后对比 /health 的 loadedAt，
 * 变了就是热重载生效，没变就是还跑着旧模块。
 */
const LOADED_AT = Date.now();

export function registerRoutes(ctx, secretary, options = {}) {
  const reload = typeof options.reload === 'function' ? options.reload : null;
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

        /**
         * 开发用热重载：换一个新的版本号重新 import 整棵 lib 树。
         *
         * 防护沿用上面两道：回环地址检查（挡远程）+ guardWrite
         * （必须 POST、application/json、同源，挡浏览器里的跨站脚本）。
         *
         * 本机其它进程仍可调用——但该接口只重新加载插件代码，不读也不写
         * 用户记录，最坏影响是重载瞬间短暂不可用，可以接受。
         * 要更严可加 token，或只在开发模式下挂载这条路由。
         */
        if (route === '/reload' && req.method === 'POST') {
          if (!reload) {
            return sendJson(res, 503, { error: { code: 'NO_RELOAD', message: '此实例不支持热重载。' } });
          }
          const result = await reload();
          return sendJson(res, 200, result);
        }

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
        if (route === '/entry' && req.method === 'GET') {
          /**
           * 单条详情（面板详情弹层用）。
           *
           * 为什么不能直接用快照里那条：快照为了体积，每个条目的时间轴只带回
           * 前 8 条（entries.js 的 MAX_TIMELINE_SHOWN）。用户在详情页翻自己记过
           * 什么时，第 9 条以后就"消失"了——文件里明明有。
           *
           * 这里**显式要全量**（timelineLimit 传 Infinity），代价是单次请求大一点，
           * 但只有打开详情时才发，不影响每次轮询的快照。
           */
          const id = url.searchParams.get('id') ?? '';
          if (!id.trim()) {
            return sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少 id。' } });
          }
          const found = await secretary.find(id, { timelineLimit: Infinity });
          return sendJson(res, 200, { ok: true, item: found.view });
        }
        if (route === '/health' && req.method === 'GET') {
          // loadedAt：本次模块被 import 的时刻。值变化即说明模块被重新加载，
          // 用来确认热重载是否生效（改完代码对比一下就知道）。
          return sendJson(res, 200, {
            ok: true,
            at: stamp(),
            root: secretary.store.root,
            loadedAt: new Date(LOADED_AT).toISOString(),
          });
        }
        if (route === '/add' && req.method === 'POST') {
          const body = await readJson(req);
          const result = await secretary.addRecord({
            domain: body.domain ?? 'work',
            text: body.text,
            title: body.title,
            fields: body.fields ?? {},
            updateExisting: body.updateExisting === true,
            // 用户已确认"另建一条"：只跳过去重，不改任何字段（U03）
            createSeparate: body.createSeparate === true,
            // 经验教训库：面板/用户主动写下时允许不经"结论"校验
            allowProgressLog: body.allowProgressLog === true,
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
            // 域声明的其他字段（销售域 customer/bidNo/amount/profit 等）原样透传。
            // updateRecord 会按域声明过滤，未声明的键自然被忽略，不需要在这里再列一遍白名单
            // ——在这里硬编码白名单，面板每加一个字段就得改一次 HTTP 层。
            //
            // 注意 `agreements` / `installments` 也走这条路：它们是数组，不是标量，
            // 但 updateRecord 会专门识别并整表重写正文（见 secretary.js 的合同分支）。
            ...pickDomainFields(body),
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
            /**
             * 目标域必须透传。
             *
             * 这里曾经漏掉 targetDomain，后果很隐蔽：面板明明传了「转到销售」，
             * 到这一层被丢掉，后端只能按"只有一个去向"去猜。
             * 现在工作→销售、销售→工作两个方向都存在，猜错就是转错域，
             * 而用户还得手动删掉重建。
             */
            targetDomain: body.targetDomain,
            // 新名称：转化时重填的记录名，空着后端沿用原标题
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

/**
 * 挑出请求体里**不属于核心字段**的那些键，原样透传给 updateRecord。
 *
 * 不在这一层做白名单：真正的合法性由 `domain.fields` 判定（updateRecord 内），
 * 域表才是唯一真相。这里只负责把值送到，核心字段排除掉是因为它们有专门的
 * 处理分支（带完成时间、状态校验等副作用），重复传会绕过那些分支。
 */
const CORE_UPDATE_KEYS = new Set([
  'id',
  'status',
  'stage',
  'progress',
  'next',
  'category',
  'deadline',
  'openEnded',
  'note',
  'quote',
  'expectedUpdated',
]);

function pickDomainFields(body) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const [key, value] of Object.entries(body)) {
    if (CORE_UPDATE_KEYS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function isLoopback(req) {  const address = req.socket?.remoteAddress;
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
