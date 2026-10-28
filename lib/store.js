/**
 * 文件存储：唯一真相是 Markdown 文件，索引只是可重建的缓存。
 *
 * 三条保证：
 *   1. 写入原子：先写同目录临时文件再 rename，进程被杀不会留下半个 JSON。
 *   2. 写入串行：单进程内一条队列，两个工具调用不会同时改同一批文件。
 *   3. 外部改动可见：读的时候带 mtime，写之前比对；Obsidian 里改过就拒绝覆盖。
 */

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class StoreError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    if (detail) Object.assign(this, detail);
  }
}

export function defaultBaseDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'plugin-data', 'dsh-secretary');
}

export function resolveBaseDir(configured) {
  const text = typeof configured === 'string' ? configured.trim() : '';
  return text ? path.resolve(text) : defaultBaseDir();
}

export function createStore(baseDir) {
  const root = path.resolve(baseDir);
  let queue = Promise.resolve();
  // 临时文件名去重计数（同一 store 实例内单调递增）
  let tempCounter = 0;

  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function absolute(relative) {
    const target = path.resolve(root, relative);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new StoreError('OUT_OF_BOUNDS', `路径越界：${relative}`);
    }
    return target;
  }

  async function ensureDir(relative) {
    await mkdir(absolute(relative), { recursive: true });
  }

  async function exists(relative) {
    try {
      await stat(absolute(relative));
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  /** 读文本 + mtime；不存在返回 null */
  async function read(relative) {
    const file = absolute(relative);
    try {
      const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      return { text, mtimeMs: info.mtimeMs };
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /** 只读文本，不存在返回 null */
  async function readText(relative) {
    const result = await read(relative);
    return result ? result.text : null;
  }

  /**
   * 原子写。expectedMtimeMs 给了就做并发校验：
   * 文件已存在且 mtime 与预期不符 → 抛 CONFLICT，调用方负责让模型重读。
   */
  function write(relative, text, expectedMtimeMs) {
    return enqueue(() => writeNow(relative, text, expectedMtimeMs));
  }

  /**
   * 原子写（不入队）。仅供**已经处于临界区**的调用方使用，
   * 例如整段读改写都在 store.enqueue 内的事务；在队列外调用它会让写入失去串行保证。
   */
  async function writeNow(relative, text, expectedMtimeMs) {
    {
      const file = absolute(relative);
      await mkdir(path.dirname(file), { recursive: true });
      if (expectedMtimeMs !== undefined && expectedMtimeMs !== null) {
        try {
          const info = await stat(file);
          if (Math.abs(info.mtimeMs - expectedMtimeMs) > 1) {
            throw new StoreError('CONFLICT', '文件在你操作期间被改动过，请重新读取后再写。', {
              path: relative,
              mtimeMs: info.mtimeMs,
            });
          }
        } catch (error) {
          if (error instanceof StoreError) throw error;
          if (!error || error.code !== 'ENOENT') throw error;
        }
      }
      // 临时名必须全局唯一：只靠 Date.now() 在同一毫秒内的并发写会撞名，
      // 表现为 Windows 上 rename 拿到 EPERM/EEXIST（复验 A03 复现）。
      tempCounter += 1;
      const temp = `${file}.${process.pid}.${Date.now()}.${tempCounter}.tmp`;
      await writeFile(temp, text, 'utf8');
      try {
        await rename(temp, file);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        // Windows 上目标文件可能被瞬时占用（杀毒/索引/并发读者），重试几次再放弃
        if (error && (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY')) {
          for (let attempt = 1; attempt <= 5; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 12 * attempt));
            const retryTemp = `${file}.${process.pid}.${Date.now()}.${tempCounter}.${attempt}.tmp`;
            try {
              await writeFile(retryTemp, text, 'utf8');
              await rename(retryTemp, file);
              const info2 = await stat(file);
              return { path: relative, mtimeMs: info2.mtimeMs, bytes: Buffer.byteLength(text, 'utf8') };
            } catch (retryError) {
              await unlink(retryTemp).catch(() => undefined);
              if (attempt === 5) throw retryError;
            }
          }
        }
        throw error;
      }
      const info = await stat(file);
      return { path: relative, mtimeMs: info.mtimeMs, bytes: Buffer.byteLength(text, 'utf8') };
    }
  }

  async function remove(relative) {
    return enqueue(async () => {
      try {
        await unlink(absolute(relative));
        return true;
      } catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  /** 递归列 Markdown（相对路径），按路径排序 */
  async function listMarkdown(relative, options = {}) {
    const skipSystem = options.skipSystem !== false;
    const out = [];
    async function walk(rel) {
      let entries;
      try {
        entries = await readdir(absolute(rel), { withFileTypes: true });
      } catch (error) {
        if (error && error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (skipSystem && entry.name === '系统' && rel === '') continue;
        const child = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          await walk(child);
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(child);
      }
    }
    await walk(relative);
    return out.sort((a, b) => a.localeCompare(b, 'zh'));
  }

  async function listFiles(relative, predicate) {
    const out = [];
    async function walk(rel) {
      let entries;
      try {
        entries = await readdir(absolute(rel), { withFileTypes: true });
      } catch (error) {
        if (error && error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const child = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) await walk(child);
        else if (predicate(child)) out.push(child);
      }
    }
    await walk(relative);
    return out.sort();
  }

  /**
   * 读 JSON（不存在返回 fallback）。
   *
   * 先剥 BOM：Windows 记事本、PowerShell 的 `Set-Content -Encoding utf8`、
   * 部分编辑器另存时都会带 U+FEFF，而 JSON.parse 遇到它直接抛错。
   * 不剥的话，用户手改配置会得到"文件明明在、配置却完全不生效"的静默失败。
   */
  async function readJson(relative, fallback = null) {
    const text = await readText(relative);
    if (text === null) return fallback;
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      return fallback;
    }
  }

  function writeJson(relative, value, expectedMtimeMs) {
    return write(relative, `${JSON.stringify(value, null, 2)}\n`, expectedMtimeMs);
  }

  return {
    root,
    absolute,
    ensureDir,
    exists,
    read,
    readText,
    write,
    writeNow,
    remove,
    listMarkdown,
    listFiles,
    readJson,
    writeJson,
    enqueue,
  };
}

export const FILES = {
  domains: path.join('系统', '域.json'),
  schedule: path.join('系统', '调度.json'),
  holidays: path.join('系统', '节假日.json'),
  snapshot: path.join('系统', '快照.json'),
  state: path.join('系统', '状态.json'),
  // 社区入口：{ "label": "GitHub 社区", "url": "https://github.com/..." }
  community: path.join('系统', '社区.json'),
  reports: '报告',
  trash: '.trash',
};
