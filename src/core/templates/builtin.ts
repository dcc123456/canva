// builtin.ts: catalogue of the 4 built-in templates shipped as static
// assets under /public/templates/. The PDF bytes are fetched on demand
// by `loadBuiltinTemplate`; the `description` / bilingual name live
// in this file so the in-app start page can render them without making
// a network round-trip first.
import type { Template } from '../types';

export interface BuiltinTemplateEntry {
  id: string;
  /** Filename under /public/templates/ */
  url: string;
  /** Bilingual display name (zh / en). */
  name: string;
  /** One-line description shown on the start-page card. */
  description: string;
}

export const builtinTemplateEntries: BuiltinTemplateEntry[] = [
  {
    id: 'builtin-resume',
    url: '/templates/resume.pdf',
    name: '简历 / Resume',
    description: '个人信息 + 工作经历 + 教育背景的占位模板',
  },
  {
    id: 'builtin-invoice',
    url: '/templates/invoice.pdf',
    name: '发票 / Invoice',
    description: '含表头、条目、合计的发票占位模板',
  },
  {
    id: 'builtin-contract',
    url: '/templates/contract.pdf',
    name: '合同 / Contract',
    description: '双方信息 + 条款 + 签字位 的合同占位模板',
  },
  {
    id: 'builtin-notes',
    url: '/templates/notes.pdf',
    name: '便签 / Notes',
    description: '空白横线便签,可直接打印为笔记本',
  },
];

/** Convert the static catalogue to runtime Template objects. The
 *  `pdf` field stays empty until the user actually picks the template
 *  — the start page only needs the metadata to draw the card. */
export function listBuiltinTemplates(): Template[] {
  return builtinTemplateEntries.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    source: 'builtin',
    pdf: '',
    createdAt: new Date(0).toISOString(),
  }));
}

/** Fetch a built-in template's PDF bytes by id. */
export async function loadBuiltinTemplate(
  id: string
): Promise<Uint8Array | null> {
  const entry = builtinTemplateEntries.find((e) => e.id === id);
  if (!entry) return null;
  const res = await fetch(entry.url);
  if (!res.ok) {
    throw new Error(
      `Failed to load built-in template ${id}: HTTP ${res.status}`
    );
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
