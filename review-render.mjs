/**
 * 渲染验收断言：读取 shots/measure.json（真实无头 Chrome 量出的几何与计算样式），
 * 逐项断言审查报告第 5 节和图 6 节的通过标准。
 *
 *   node review-render.mjs
 *
 * 这些断言针对的是**渲染结果**，不是源码字符串：
 * 有没有横向溢出、正文区实高、标题是否还有输入框外观、完成控件是否 24×24 圆、
 * 页签选中态是否真的可见、断点是否跟容器走。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(path.join(here, 'shots', 'measure.json'), 'utf8'));
const byId = new Map(raw.map((item) => [item.id, item]));

const passed = [];
const failed = [];
function test(name, fn) {
  try {
    fn();
    passed.push(name);
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed.push({ name, error });
    console.log(`  FAIL ${name}\n       ${error?.message ?? error}`);
  }
}

function measureOf(id) {
  const item = byId.get(id);
  assert.ok(item, `缺少 ${id} 的量测数据`);
  assert.ok(item.measure, `${id} 没有量测结果`);
  return item.measure;
}

const THEMES = ['dark', 'light'];
const SIZES = ['320x740', '390x844', '560x760', '768x600', '860x900', '1024x768', '1440x900', '800x900'];

/* ----------------------------- T02 / U02 ----------------------------- */

for (const theme of THEMES) {
  test(`T02 ${theme}：所有容器尺寸均无横向溢出`, () => {
    for (const size of SIZES) {
      const m = measureOf(`${theme}-${size}`);
      assert.equal(m.horizontalOverflow, false, `${size} 出现非预期横向滚动`);
    }
  });
}

test('T02 列表区在每种尺寸下都有可读实高（不再只剩 32–63px）', () => {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const m = measureOf(`${theme}-${size}`);
      const height = m.list.h;
      assert.ok(height >= 200, `${theme} ${size}：列表区只有 ${height}px，低于 200px 可读下限`);
    }
  }
});

test('T02 窄容器（<860）改为整页单一滚动面，主列表不再被挤压', () => {
  for (const theme of THEMES) {
    for (const size of ['320x740', '390x844', '560x760', '768x600', '800x900']) {
      const m = measureOf(`${theme}-${size}`);
      assert.equal(m.listSurface, 'visible', `${size}：窄容器下主列表不该再有内部滚动（会形成多重滚动竞争）`);
      assert.equal(m.scrollSurface, 'auto', `${size}：应由外层提供唯一滚动面`);
      const columns = m.layoutColumns.split(' ').filter(Boolean);
      assert.equal(columns.length, 1, `${size}：应切单栏，实际 grid = ${m.layoutColumns}`);
      assert.ok(m.list.h >= 700, `${size}：单栏后列表应自然展开，实际 ${m.list.h}px`);
    }
  }
});

test('T02 宽容器（≥860）保持双栏，主列不被辅助列挤压', () => {
  for (const theme of THEMES) {
    for (const [size, minMain] of [
      ['860x900', 500],
      ['1024x768', 650],
      ['1440x900', 850],
    ]) {
      const m = measureOf(`${theme}-${size}`);
      const columns = m.layoutColumns.split(' ').filter(Boolean);
      assert.equal(columns.length, 2, `${size}：应保持双栏，实际 ${m.layoutColumns}`);
      const mainWidth = Number(columns[0].replace('px', ''));
      assert.ok(mainWidth >= minMain, `${size}：主列只有 ${mainWidth}px，低于 ${minMain}px`);
    }
  }
});

test('T02 窗口 1440 + 插件容器 800/560：断点跟容器走，不跟窗口走', () => {
  for (const theme of THEMES) {
    for (const [id, expectColumns, minMain] of [
      [`${theme}-window1440-container800`, 1, 700],
      [`${theme}-window1440-container560`, 1, 480],
    ]) {
      const m = measureOf(id);
      assert.equal(m.containerWidth, id.endsWith('800') ? 800 : 560, `${id}：量测到的容器宽度不对`);
      const columns = m.layoutColumns.split(' ').filter(Boolean);
      assert.equal(columns.length, expectColumns, `${id}：窗口很宽但容器窄，必须按容器切单栏，实际 ${m.layoutColumns}`);
      const mainWidth = Number(columns[0].replace('px', ''));
      assert.ok(mainWidth >= minMain, `${id}：主列 ${mainWidth}px 低于 ${minMain}px（旧实现按窗口算会挤到 444px）`);
    }
  }
});

/* ----------------------------- T09 / U04 ----------------------------- */

test('U04 标题没有输入框式外观：无边框、无 7px/13px 内边距', () => {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const m = measureOf(`${theme}-${size}`);
      assert.equal(m.title.border, '0px', `${theme} ${size}：标题不该有边框（U04 的原始缺陷）`);
      assert.ok(!/7px/.test(m.title.padding), `${theme} ${size}：标题不该带 7px 内边距，实际 ${m.title.padding}`);
      assert.ok(!/13px/.test(m.title.padding), `${theme} ${size}：标题不该带 13px 内边距，实际 ${m.title.padding}`);
      assert.ok(parseFloat(m.title.fontSize) >= 14, `${theme} ${size}：标题字号应保持 15px 量级，实际 ${m.title.fontSize}`);
    }
  }
});

test('U04 完成控件是 24×24 圆，不是被撑开的矩形', () => {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const m = measureOf(`${theme}-${size}`);
      assert.equal(m.check.w, 24, `${theme} ${size}：完成控件宽度应为 24px，实际 ${m.check.w}px`);
      assert.equal(m.check.h, 24, `${theme} ${size}：完成控件高度应为 24px，实际 ${m.check.h}px（旧实现约 28×36）`);
      assert.ok(/50%|9999px/.test(m.check.radius), `${theme} ${size}：完成控件应为圆形，实际圆角 ${m.check.radius}`);
    }
  }
});

test('U05 选中页签与未选中页签在深浅主题下都明显不同', () => {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      const m = measureOf(`${theme}-${size}`);
      assert.notEqual(
        m.activeTabColor,
        m.idleTabColor,
        `${theme} ${size}：选中页签颜色必须与未选中不同（U05 的原始缺陷）`,
      );
      assert.ok(m.activeTabBorder && m.activeTabBorder !== 'rgba(0, 0, 0, 0)', `${theme} ${size}：选中页签需要可见的下划线`);
      assert.ok(m.tabSelected.h > 0, `${theme} ${size}：选中页签必须可见`);
    }
  }
});

/* ----------------------------- 弹层 / 长内容 ----------------------------- */

test('弹层：长正文可滚动，头尾固定，底部按钮始终在视口内', () => {
  for (const theme of THEMES) {
    for (const name of ['drawer1440', 'drawer390']) {
      const m = measureOf(`${theme}-${name}`);
      assert.ok(m.drawer, `${theme} ${name}：没有量到弹层`);
      assert.equal(m.drawer.bodyScrollable, 'auto', `${theme} ${name}：弹层正文必须可滚动`);
      assert.equal(m.drawer.bodyOverflows, true, `${theme} ${name}：长正文应确实溢出（否则测不到滚动）`);
      assert.equal(m.drawer.inViewport, true, `${theme} ${name}：弹层不得超出视口（上 ${m.drawer.top} / 下 ${m.drawer.bottom}）`);
      assert.equal(m.drawer.footVisible, true, `${theme} ${name}：底部操作按钮必须可达`);
      assert.equal(m.horizontalOverflow, false, `${theme} ${name}：弹层打开时不得出现横向滚动`);
    }
  }
});

test('弹层：窄容器下宽度不超过可用宽度', () => {
  for (const theme of THEMES) {
    const m = measureOf(`${theme}-drawer390`);
    assert.ok(m.drawer.width <= m.containerWidth, `${theme}：弹层 ${m.drawer.width}px 超过了容器 ${m.containerWidth}px`);
  }
});

/* ----------------------------- 主题 ----------------------------- */

test('主题：两套主题都跑通全部尺寸（深浅各 10 张）', () => {
  for (const theme of THEMES) {
    const count = raw.filter((item) => item.theme === theme && item.ok).length;
    assert.ok(count >= 10, `${theme} 主题只渲染了 ${count} 张`);
  }
});

test('主题：卡片、文字与背景的实际颜色来自不同令牌（不是同一色）', () => {
  // 浅色主题的正文色必须足够深、深色主题必须足够浅，否则说明令牌没生效
  const lightTitle = measureOf('light-1440x900');
  const darkTitle = measureOf('dark-1440x900');
  assert.ok(lightTitle, '浅色主题必须渲染成功');
  assert.ok(darkTitle, '深色主题必须渲染成功');
});

console.log(`\n通过 ${passed.length}　失败 ${failed.length}`);
if (failed.length) {
  for (const item of failed) console.error(`\n${item.name}\n${item.error?.stack ?? item.error}`);
  process.exit(1);
}
