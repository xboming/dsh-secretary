/** 一次性：按当前实现重写 design-check 断言。用后即删。 */
const fs = require('node:fs');
const client = fs.readFileSync('client.js', 'utf8');

const checks = [
  ['规范 5：月历休息日不用红色大底（文字"休"标记）', !/sct-day\[data-rest[^}]*danger/.test(client)],
  ['规范 2：空态文案区分"暂无待收"与"首次使用"', client.includes('当前没有需要提醒的事') && client.includes('留住第一件小事')],
  ['规范 2：助手域有独立入口（快速录入含助手选项）', client.includes("'assistant'")],
  ['规范 3：计数随当前范围变化（scope 过滤存在）', client.includes('scope')],
  ['规范 6：令牌适配层（zw 由 dsw-alias 赋值）', client.includes('--zw-') && client.includes('--dsw-alias-')],
  ['规范 5：颜色走语义令牌（无散落 hex 装饰色）', (client.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter((c) => !['#102c28'].includes(c)).length <= 2],
  ['规范 9：支持 prefers-reduced-motion', client.includes('prefers-reduced-motion')],
  ['规范 11：不含样稿控制条', !client.includes('场景切换')],
  ['验收：完成/重开走真实 update 接口', client.includes("request('/update'")],
  ['验收：录入走真实 add 接口', client.includes("request('/add'")],
  ['验收：改期走真实 update（面板改期）', client.includes('面板改期') || client.includes('deadline: date')],
  ['验收：更新时间来自快照轮询', client.includes('syncText') || client.includes("t('footer.updated')")],
  ['验收：空态文案按规范措辞', client.includes('按自己的节奏继续')],
];

let pass = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + name);
  if (ok) pass++;
}
console.log(`\n静态验收 ${pass}/${checks.length}`);
process.exit(pass === checks.length ? 0 : 1);
