/**
 * 时间与字符串小工具。全部按宿主本地时区计算，不引入依赖。
 */

export const DAY_MS = 86400000;

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** 本地日期 YYYY-MM-DD */
export function ymd(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本地时间 HH:mm */
export function hhmm(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 时间戳 `YYYY-MM-DD HH:mm` */
export function stamp(date = new Date()) {
  return `${ymd(date)} ${hhmm(date)}`;
}

/** 今天零点 */
export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 解析 `YYYY-MM-DD` 为本地零点；无效返回 null */
export function parseDay(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 解析 `HH:mm`，返回当天分钟数；无效返回 null */
export function parseClock(value) {
  if (typeof value !== 'string') return null;
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 把分钟数写成 HH:mm（允许 >=1440，取模） */
export function clockText(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 两个本地零点之间相差的天数 */
export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** 日期加减天数 */
export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** ISO 周序号（周一为一周开始） */
export function isoWeek(date = new Date()) {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7; // 周一=0
  const thursday = addDays(d, 3 - day);
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week = Math.floor((thursday - jan1) / (7 * DAY_MS)) + 1;
  return { year, week };
}

/** 周键 `YYYY-Www` */
export function weekKey(date = new Date()) {
  const { year, week } = isoWeek(date);
  return `${year}-W${pad(week)}`;
}

/** 月键 `YYYY-MM` */
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** 该日是否为所在月的最后一天（按本地日历年月判断，闰年自动正确） */
export function isLastDayOfMonth(date = new Date()) {
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() === last;
}

/** 该月的最后一天（本地零点） */
export function lastDayOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** 周一零点 */
export function startOfWeek(date = new Date()) {
  const d = startOfDay(date);
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** 单行化：折叠换行与多余空白，用于标题 */
export function oneLine(text, max = 80) {
  const flat = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' · ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** 文件名安全化 */
export function safeName(text, max = 40) {
  const cleaned = String(text ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned) || '未命名';
}
