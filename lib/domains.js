/**
 * 域注册表：加一个域 = 加一份声明，不改工具、不改面板、不改报告生成器。
 *
 * 形态只有三种，这是刻意的限制：
 *   task    事项：一事项一文件（有状态、截止、下一步）
 *   project 项目：一项目一文件（有阶段、里程碑、进度）
 *   stream  流水：月度单文件追加（记录成本最低，不要求标题）
 *
 * 声明可放在 系统/域.json，与内置合并（同 id 覆盖）。
 */

export const SHAPES = ['task', 'project', 'stream'];

export const BUILTIN_DOMAINS = [
  {
    id: 'work',
    name: '工作',
    en: 'Work',
    shape: 'task',
    dir: '工作',
    icon: '▣',
    fields: {
      status: { type: 'enum', values: ['todo', 'doing', 'done', 'dropped'], default: 'todo', label: '状态' },
      progress: { type: 'number', min: 0, max: 100, label: '进度' },
      deadline: { type: 'date', label: '截止' },
      next: { type: 'string', max: 200, label: '下一步' },
      category: { type: 'string', max: 20, label: '分类' },
      tags: { type: 'tags', label: '标签' },
    },
    required: ['title'],
    dedupe: 'title',
    reminders: ['due', 'stall'],
    stallDays: 5,
    analysis: ['flow', 'completion', 'due', 'stall', 'distribution'],
    tone: 'colleague',
  },
  {
    id: 'creation',
    name: '创作',
    en: 'Creation',
    shape: 'project',
    dir: '创作',
    icon: '✎',
    fields: {
      stage: {
        type: 'enum',
        values: ['idea', 'drafting', 'revising', 'done', 'parked'],
        default: 'idea',
        label: '阶段',
      },
      progress: { type: 'number', min: 0, max: 100, label: '进度' },
      deadline: { type: 'date', label: '截止' },
      next: { type: 'string', max: 200, label: '下一步' },
      tags: { type: 'tags', label: '标签' },
    },
    required: ['title'],
    dedupe: 'title',
    reminders: ['due', 'stall'],
    stallDays: 10,
    analysis: ['flow', 'completion', 'stall', 'distribution'],
    tone: 'creator',
  },
  {
    id: 'idea',
    name: '灵感',
    en: 'Ideas',
    shape: 'stream',
    dir: '灵感',
    icon: '✦',
    fields: {
      source: { type: 'string', max: 40, label: '来源' },
      tags: { type: 'tags', label: '标签' },
      promotedTo: { type: 'string', max: 40, label: '转化为' },
    },
    required: [],
    dedupe: 'none',
    reminders: ['dormant'],
    dormantDays: 30,
    analysis: ['flow', 'promotion', 'dormant', 'distribution'],
    tone: 'collector',
  },
];

const ENUM_STATUS = new Set(['todo', 'doing', 'done', 'dropped']);

export function cloneDomain(domain) {
  return JSON.parse(JSON.stringify(domain));
}

/** 合并内置与用户声明；用户同 id 覆盖，新增 id 追加 */
export function resolveDomains(userDomains) {
  const map = new Map();
  for (const domain of BUILTIN_DOMAINS) map.set(domain.id, cloneDomain(domain));

  if (Array.isArray(userDomains)) {
    for (const entry of userDomains) {
      const normalized = normalizeDomain(entry);
      if (!normalized) continue;
      const current = map.get(normalized.id);
      map.set(normalized.id, current ? mergeDomain(current, normalized) : normalized);
    }
  }
  return [...map.values()];
}

function mergeDomain(base, patch) {
  const merged = { ...base, ...patch };
  merged.fields = { ...base.fields, ...(patch.fields ?? {}) };
  merged.required = patch.required ?? base.required;
  merged.reminders = patch.reminders ?? base.reminders;
  merged.analysis = patch.analysis ?? base.analysis;
  return merged;
}

function normalizeDomain(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id ?? '').trim();
  if (!/^[a-z][a-z0-9_-]{0,23}$/.test(id)) return null;
  const shape = SHAPES.includes(entry.shape) ? entry.shape : 'task';
  const name = String(entry.name ?? id).trim() || id;
  const dir = String(entry.dir ?? name).replace(/[\\/:*?"<>|]/g, '').trim() || id;
  const fields = {};
  if (entry.fields && typeof entry.fields === 'object') {
    for (const [key, spec] of Object.entries(entry.fields)) {
      if (!/^[A-Za-z][\w-]{0,23}$/.test(key) || !spec || typeof spec !== 'object') continue;
      const type = ['string', 'number', 'date', 'enum', 'tags', 'boolean'].includes(spec.type)
        ? spec.type
        : 'string';
      fields[key] = { ...spec, type };
    }
  }
  return {
    id,
    name,
    en: String(entry.en ?? name),
    shape,
    dir,
    icon: String(entry.icon ?? '•').slice(0, 2),
    fields,
    required: Array.isArray(entry.required) ? entry.required.filter((k) => typeof k === 'string') : ['title'],
    dedupe: entry.dedupe === 'none' ? 'none' : 'title',
    reminders: Array.isArray(entry.reminders) ? entry.reminders : ['due'],
    stallDays: Number.isFinite(entry.stallDays) ? entry.stallDays : 7,
    dormantDays: Number.isFinite(entry.dormantDays) ? entry.dormantDays : 30,
    analysis: Array.isArray(entry.analysis) ? entry.analysis : ['flow'],
    tone: String(entry.tone ?? 'neutral'),
  };
}

/** 找域；接受 id 或中文名 */
export function findDomain(domains, key) {
  const text = String(key ?? '').trim().toLowerCase();
  if (!text) return null;
  return (
    domains.find((d) => d.id === text) ??
    domains.find((d) => d.name === key) ??
    domains.find((d) => d.en.toLowerCase() === text) ??
    null
  );
}

/** 域内状态键：不同形态用不同字段 */
export function statusFieldOf(domain) {
  if (domain.shape === 'project') return 'stage';
  if (domain.shape === 'stream') return 'promotedTo';
  return 'status';
}

export function doneValuesOf(domain) {
  if (domain.shape === 'project') return ['done'];
  if (domain.shape === 'stream') return ['promotedTo'];
  return ['done'];
}

export function validateField(domain, key, value) {
  const spec = domain.fields[key];
  if (!spec) return { ok: false, error: `未知字段 ${key}` };
  if (value === null || value === undefined || value === '') return { ok: true, value: undefined };
  switch (spec.type) {
    case 'enum': {
      const text = String(value);
      if (!spec.values.includes(text)) {
        return { ok: false, error: `${key} 只能是 ${spec.values.join(' / ')}` };
      }
      return { ok: true, value: text };
    }
    case 'number': {
      const num = Number(value);
      if (!Number.isFinite(num)) return { ok: false, error: `${key} 必须是数字` };
      if (Number.isFinite(spec.min) && num < spec.min) return { ok: false, error: `${key} 不能小于 ${spec.min}` };
      if (Number.isFinite(spec.max) && num > spec.max) return { ok: false, error: `${key} 不能大于 ${spec.max}` };
      return { ok: true, value: num };
    }
    case 'boolean':
      return { ok: true, value: value === true || value === 'true' };
    case 'date': {
      const text = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: `${key} 必须是 YYYY-MM-DD` };
      return { ok: true, value: text };
    }
    case 'tags': {
      const list = Array.isArray(value) ? value : String(value).split(/[,，\s]+/);
      const tags = [];
      for (const item of list) {
        const tag = String(item).trim().replace(/^#+/, '').slice(0, 24);
        if (!tag) continue;
        if (tags.includes(tag)) continue;
        tags.push(tag);
        if (tags.length >= 8) break;
      }
      return { ok: true, value: tags };
    }
    default: {
      const text = String(value).trim();
      if (Number.isFinite(spec.max) && text.length > spec.max) {
        return { ok: false, error: `${key} 最多 ${spec.max} 个字符` };
      }
      return { ok: true, value: text };
    }
  }
}

export { ENUM_STATUS };
