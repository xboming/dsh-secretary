/**
 * 工作日与节假日。
 *
 * 规则：工作日 = 周一至周五 − 法定节假日 + 调休上班日。
 * 内置 2025、2026 两年（来源：国务院办公厅通知），可被 系统/节假日.json 覆盖；
 * 未收录的年份退化为"只扣周末"，并通过 holidayDataMissing 显式告知，不静默算错。
 */

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
const { DAY_MS, addDays, daysBetween, parseDay, startOfDay, ymd } = await import(rel('./util.js', import.meta.url));

/** 内置节假日：off = 放假，work = 调休上班 */
export const BUILTIN_HOLIDAYS = {
  2025: {
    off: {
      '2025-01-01': '元旦',
      '2025-01-28': '除夕',
      '2025-01-29': '春节',
      '2025-01-30': '春节',
      '2025-01-31': '春节',
      '2025-02-01': '春节',
      '2025-02-02': '春节',
      '2025-02-03': '春节',
      '2025-02-04': '春节',
      '2025-04-04': '清明节',
      '2025-04-05': '清明节',
      '2025-04-06': '清明节',
      '2025-05-01': '劳动节',
      '2025-05-02': '劳动节',
      '2025-05-03': '劳动节',
      '2025-05-04': '劳动节',
      '2025-05-05': '劳动节',
      '2025-05-31': '端午节',
      '2025-06-01': '端午节',
      '2025-06-02': '端午节',
      '2025-10-01': '国庆节',
      '2025-10-02': '国庆节',
      '2025-10-03': '国庆节',
      '2025-10-04': '国庆节',
      '2025-10-05': '国庆节',
      '2025-10-06': '中秋节',
      '2025-10-07': '国庆节',
      '2025-10-08': '国庆节',
    },
    work: {
      '2025-01-26': '春节前补班',
      '2025-02-08': '春节后补班',
      '2025-04-27': '劳动节前补班',
      '2025-09-28': '国庆节前补班',
      '2025-10-11': '国庆节后补班',
    },
  },
  2026: {
    off: {
      '2026-01-01': '元旦',
      '2026-01-02': '元旦',
      '2026-01-03': '元旦',
      '2026-02-15': '春节',
      '2026-02-16': '除夕',
      '2026-02-17': '春节',
      '2026-02-18': '春节',
      '2026-02-19': '春节',
      '2026-02-20': '春节',
      '2026-02-21': '春节',
      '2026-02-22': '春节',
      '2026-02-23': '春节',
      '2026-04-04': '清明节',
      '2026-04-05': '清明节',
      '2026-04-06': '清明节',
      '2026-05-01': '劳动节',
      '2026-05-02': '劳动节',
      '2026-05-03': '劳动节',
      '2026-05-04': '劳动节',
      '2026-05-05': '劳动节',
      '2026-06-19': '端午节',
      '2026-06-20': '端午节',
      '2026-06-21': '端午节',
      '2026-09-25': '中秋节',
      '2026-09-26': '中秋节',
      '2026-09-27': '中秋节',
      '2026-10-01': '国庆节',
      '2026-10-02': '国庆节',
      '2026-10-03': '国庆节',
      '2026-10-04': '国庆节',
      '2026-10-05': '国庆节',
      '2026-10-06': '国庆节',
      '2026-10-07': '国庆节',
    },
    work: {
      '2026-01-04': '元旦后补班',
      '2026-02-14': '春节前补班',
      '2026-02-28': '春节后补班',
      '2026-05-09': '劳动节后补班',
      '2026-09-20': '中秋节前补班',
      '2026-10-10': '国庆节后补班',
    },
  },
};

/**
 * 合并内置表与用户覆盖。
 * 用户文件形如 { "2027": { "off": {...}, "work": {...} } }，同键覆盖内置值。
 */
export function buildHolidayTable(userTable) {
  const table = {};
  for (const [year, entry] of Object.entries(BUILTIN_HOLIDAYS)) {
    table[year] = { off: { ...entry.off }, work: { ...entry.work } };
  }
  if (userTable && typeof userTable === 'object') {
    for (const [year, entry] of Object.entries(userTable)) {
      if (!/^\d{4}$/.test(year) || !entry || typeof entry !== 'object') continue;
      const current = table[year] ?? { off: {}, work: {} };
      table[year] = {
        off: { ...current.off, ...(entry.off ?? {}) },
        work: { ...current.work, ...(entry.work ?? {}) },
      };
    }
  }
  return table;
}

export function hasYear(table, year) {
  return Boolean(table?.[year]);
}

function weekdayOf(date) {
  return date.getDay(); // 0=周日
}

/** 法定假日（不含周末） */
export function holidayNameOf(date, table) {
  const year = date.getFullYear();
  return table?.[year]?.off?.[ymd(date)] ?? null;
}

/** 调休上班日 */
export function makeupNameOf(date, table) {
  const year = date.getFullYear();
  return table?.[year]?.work?.[ymd(date)] ?? null;
}

/** 是否上班日（含调休），忽略节假日表缺失 */
export function isWorkday(date, table) {
  const d = startOfDay(date);
  const makeup = makeupNameOf(d, table);
  if (makeup) return true;
  if (holidayNameOf(d, table)) return false;
  const day = weekdayOf(d);
  return day >= 1 && day <= 5;
}

/** 是否休息日（周末或法定假日，调休上班日除外） */
export function isRestDay(date, table) {
  return !isWorkday(date, table);
}

/**
 * 从 from 到 deadline 还剩几个工作日。
 * 今天到期 = 0；逾期返回负数。
 */
export function workingDaysUntil(deadline, from, table) {
  const target = startOfDay(deadline);
  const base = startOfDay(from);
  const diff = daysBetween(base, target);
  if (diff === 0) return isWorkday(base, table) ? 0 : 0;
  const step = diff > 0 ? 1 : -1;
  let count = 0;
  let cursor = new Date(base);
  for (let i = 0; i < Math.abs(diff); i += 1) {
    cursor = addDays(cursor, step);
    if (isWorkday(cursor, table)) count += step > 0 ? 1 : -1;
  }
  return count;
}

/** 从 from 起加 n 个工作日 */
export function addWorkingDays(from, n, table) {
  let cursor = startOfDay(from);
  let remaining = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isWorkday(cursor, table)) remaining -= 1;
  }
  return cursor;
}

/**
 * 截止日归一化：截止落在非工作日（周末/法定假日）时，向前折叠到最近的工作日。
 * 口径：周六截止视为周五交——用户不该在"剩 0 个工作日"的提示下才想起周末根本不算。
 */
export function normalizeDeadline(deadline, table) {
  let cursor = startOfDay(deadline);
  for (let i = 0; i < 30 && !isWorkday(cursor, table); i += 1) {
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

/** 面板/月历用的一格描述 */
export function describeDay(date, table) {
  const d = startOfDay(date);
  const holiday = holidayNameOf(d, table);
  const makeup = makeupNameOf(d, table);
  const weekend = weekdayOf(d) === 0 || weekdayOf(d) === 6;
  return {
    date: ymd(d),
    workday: isWorkday(d, table),
    holiday: Boolean(holiday),
    holidayName: holiday,
    makeup: Boolean(makeup),
    makeupName: makeup,
    weekend,
    missingData: !hasYear(table, d.getFullYear()),
  };
}

/** 某月内的假期段落，供图例使用 */
export function holidaysInMonth(year, month, table) {
  const days = new Date(year, month, 0).getDate();
  const groups = [];
  for (let day = 1; day <= days; day += 1) {
    const d = new Date(year, month - 1, day);
    const name = holidayNameOf(d, table);
    if (!name) continue;
    const last = groups[groups.length - 1];
    if (last && last.name === name && daysBetween(parseDay(last.to), d) === 1) {
      last.to = ymd(d);
      last.days += 1;
    } else {
      groups.push({ name, from: ymd(d), to: ymd(d), days: 1 });
    }
  }
  return groups;
}

/** 未来 n 天内的工作日列表（用于提醒窗口） */
export function workdaysWithin(from, days, table) {
  const out = [];
  let cursor = startOfDay(from);
  for (let i = 0; i <= days; i += 1) {
    const d = addDays(cursor, i);
    if (isWorkday(d, table)) out.push(d);
  }
  return out;
}

export { DAY_MS };
