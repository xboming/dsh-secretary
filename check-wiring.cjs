/** 一次性：静态确认新功能接线。用后即删。 */
const fs = require('node:fs');
const src = fs.readFileSync('client.js', 'utf8');

const checks = {
  '搜索分支': src.includes('search.trim()') && src.includes('searchResult'),
  '搜索走 /search': src.includes("request('/search?'"),
  '搜索防抖': src.includes('}, 250);'),
  '加载更多按钮': src.includes('sct-load-more') && src.includes("t('group.loadMore')"),
  'onSaveDetail 接线': src.includes('onSave: onSaveDetail'),
  '详情编辑入口': src.includes('sct-edit-entry') && src.includes("t('action.edit')"),
  '编辑表单': src.includes('editSection') && src.includes('sct-edit-actions'),
  '编辑保存走 /update': src.includes("request('/update', jsonBody(body))"),
  '排序下拉': src.includes('sct-sort') && src.includes('sortItems'),
  'doneLimit=all': src.includes('doneLimit=all'),
  '快照 doneLimit 参数': src.includes('useSnapshot(doneLimit)'),
  '工具条装入固定区': src.includes("sct-main-head' }, capture, tabs, filter, toolbar"),
};

let pass = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log((ok ? '  ok  ' : '  FAIL') + ' ' + name);
  if (ok) pass += 1;
}
console.log(`\n静态接线 ${pass}/${Object.keys(checks).length}`);
process.exit(pass === Object.keys(checks).length ? 0 : 1);
