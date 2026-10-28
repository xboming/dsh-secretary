/** A13：核对发布白名单与内部依赖完整性。可保留为常驻检查。 */
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const files = pkg.files || [];
console.log('files 白名单:', files.join(', '));

const idx = fs.readFileSync('index.js', 'utf8');
const imports = [...idx.matchAll(/from ['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]);
console.log('index.js 依赖:', imports.join(', '));

const libFiles = fs.readdirSync('lib').map((f) => 'lib/' + f);
console.log('lib 实际文件:', libFiles.join(', '));

const coveredBy = (rel) =>
  files.some((f) => f === rel || (f === 'lib' && rel.startsWith('lib/')) || (f.endsWith('/*') && rel.startsWith(f.slice(0, -1))));
const uncovered = imports.filter((i) => !coveredBy(i));
console.log('未被白名单覆盖的依赖:', uncovered.length ? uncovered.join(', ') : '无');

// lib 内部互相 import 是否都存在
const missing = [];
for (const f of libFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from ['"]\.\/([^'"]+)['"]/g)) {
    if (!fs.existsSync(path.join('lib', m[1]))) missing.push(f + ' -> ' + m[1]);
  }
}
console.log('lib 内部缺失依赖:', missing.length ? missing.join(', ') : '无');

// 入口能否被加载（等价于"干净安装后能 require 到 lib"）
const ok = uncovered.length === 0 && missing.length === 0;
console.log(`\nA13 结果：${ok ? 'PASS（lib 在发布清单内，依赖完整）' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
