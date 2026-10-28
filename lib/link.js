/**
 * 两处顺手改：灵感转创作、条目互相关联。
 */

// 版本化加载（见 reloadable.js）：子依赖跟着 ?v= 一起刷新。
const { rel } = await import(new URL('./reloadable.js', import.meta.url).href);
import path from 'node:path';
const { findDomain } = await import(rel('./domains.js', import.meta.url));
const { setStreamMeta } = await import(rel('./stream.js', import.meta.url));
const { appendNote, appendTimeline } = await import(rel('./entries.js', import.meta.url));
const { splitDocument } = await import(rel('./frontmatter.js', import.meta.url));
const { serializeEntry } = await import(rel('./entries.js', import.meta.url));
const { newEntryBody, newEntryData, entryPath } = await import(rel('./entries.js', import.meta.url));
const { safeName, stamp, ymd } = await import(rel('./util.js', import.meta.url));

export async function linkEntries(secretary, { id, action, to, title, deadline, openEnded }) {
  if (action === 'promote') return promote(secretary, id, title, { deadline, openEnded });
  if (action === 'relate') return relate(secretary, id, to);
  throw new Error('action 只能是 promote 或 relate。');
}

async function promote(secretary, ideaId, title, options = {}) {
  const deadline = typeof options.deadline === 'string' ? options.deadline.trim() : '';
  const openEnded = options.openEnded === true;

  // F02：编号分配 + 项目写入 + 灵感回写必须处于**同一临界区**。
  // 原实现先加载条目、在队列外算号，再分别写两个文件——并发转化会拿到同一个号，
  // 且灵感回写失败时项目已经创建，留下重复编号的孤儿项目。
  // 这里整段使用 store.enqueue，内部一律用 writeNow 避免重入死锁。
  return secretary.store.enqueue(async () => {
    // 临界区内重新读取，拿到最新状态
    const settings = await secretary.loadAll(true);
    const idea = settings.entries.find((entry) => String(entry.id).toUpperCase() === String(ideaId).toUpperCase());
    if (!idea) throw new Error(`找不到灵感 ${ideaId}。`);
    if (idea.domain !== 'idea') throw new Error(`${ideaId} 不是灵感，只有灵感能转成创作。`);

    // 重复转化：已经转过的灵感不再建第二个项目
    if (idea.promotedTo) {
      return {
        action: 'already',
        id: idea.promotedTo,
        ideaId: idea.id,
        message: `灵感 ${idea.id} 已经转成项目 ${idea.promotedTo}，没有重复创建。`,
      };
    }

    // 转化也是"新建创作项目"，必须走和 addRecord 一样的期限防线。
    if (!deadline && !openEnded) {
      return {
        action: 'need_deadline',
        ideaId: idea.id,
        title: title?.trim() || idea.title,
        message:
          '把它转成创作项目需要计划结束时间。请先确认什么时候要有产出；' +
          '用户说"不急"时带 openEnded: true 再来一次。',
      };
    }

    const creation = findDomain(settings.domains, 'creation');
    const id = await nextCreationId(secretary, creation, settings);
    const projectTitle = title?.trim() || idea.title;
    const fields = { id, title: projectTitle, stage: 'idea', progress: 0, origin: idea.id };
    if (deadline) fields.deadline = deadline;
    const data = newEntryData(creation, fields);
    if (openEnded) data.openEnded = true;
    const quote = idea.timeline?.[0]?.quote ?? idea.title;
    let body = newEntryBody(creation, { ...data, text: quote });
    body = appendTimeline(body, { at: stamp(), text: `由灵感 ${idea.id} 转化`, quote });
    const relative = entryPath(creation, data);

    // 先写项目，再回写灵感；回写失败则回滚项目文件，避免孤儿与重复编号
    const projectWrite = await secretary.store.writeNow(relative, serializeEntry(creation, data, body));
    let ideaRead = null;
    try {
      ideaRead = await secretary.store.read(idea.path);
      if (ideaRead) {
        const next = setStreamMeta(ideaRead.text, idea.id, '转化', id);
        await secretary.store.writeNow(idea.path, next, ideaRead.mtimeMs);
      }
    } catch (error) {
      // 回滚：删掉刚建的项目文件，保证"灵感未标注 → 项目不存在"的一致状态
      try {
        await secretary.store.remove(relative);
      } catch (rollbackError) {
        console.error('[dsh-secretary] 转化回滚失败，请手动清理', relative, rollbackError?.message);
      }
      throw new Error(`回写灵感失败，已撤销新建的项目 ${id}：${error?.message ?? error}`);
    }
    void projectWrite;

    return {
      action: 'promoted',
      message: `已把灵感 ${idea.id} 转成创作项目 ${id}（${projectTitle}），灵感里也标了来源。`,
      id,
      ideaId: idea.id,
      path: relative,
    };
  });
}

async function nextCreationId(secretary, domain, settings) {
  const year = new Date().getFullYear();
  const prefix = `C-${year}-`;
  let max = 0;
  for (const entry of settings.entries) {
    if (entry.domain !== domain.id) continue;
    const match = new RegExp(`${prefix}(\\d{3})`).exec(entry.id ?? '');
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function relate(secretary, fromId, toId) {
  if (!toId) throw new Error('relate 需要 to。');
  const from = await secretary.find(fromId);
  const to = await secretary.find(toId);
  const note = `关联：[[${to.entry.title}]]`;
  const back = `关联：[[${from.entry.title}]]`;

  const fromRead = await secretary.store.read(from.entry.path);
  const toRead = await secretary.store.read(to.entry.path);
  if (!fromRead || !toRead) throw new Error('条目文件不见了，请重新查询。');
  const a = splitDocument(fromRead.text);
  const b = splitDocument(toRead.text);
  await secretary.store.write(from.entry.path, serializeEntry(from.domain, a.data, appendNote(a.body, note)), fromRead.mtimeMs);
  await secretary.store.write(to.entry.path, serializeEntry(to.domain, b.data, appendNote(b.body, back)), toRead.mtimeMs);
  return { message: `已互相标注关联：${from.entry.title} ↔ ${to.entry.title}。` };
}
