// user-templates.ts: read / write / delete user templates in IndexedDB.
//
// We use the raw `indexedDB` global (no third-party wrapper) so the
// runtime stays small. The object store is keyed on `id` and lives in
// the `minipdf` database under the `templates` store name. Everything
// is async-only; callers should `await` the exported functions.
import type { Template } from '../types';

const DB_NAME = 'minipdf';
const DB_VERSION = 1;
const STORE = 'templates';

function isBrowser(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IDBRequest error'));
        tx.oncomplete = () => db.close();
        tx.onerror = () =>
          reject(tx.error ?? new Error('IDB transaction error'));
        tx.onabort = () =>
          reject(tx.error ?? new Error('IDB transaction aborted'));
      })
  );
}

function recordToTemplate(rec: unknown): Template | null {
  if (!rec || typeof rec !== 'object') return null;
  const r = rec as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.pdf !== 'string'
  ) {
    return null;
  }
  return {
    id: r.id,
    name: r.name,
    thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : undefined,
    source: 'user',
    pdf: r.pdf,
    createdAt:
      typeof r.createdAt === 'string'
        ? r.createdAt
        : new Date().toISOString(),
  };
}

export async function getAllUserTemplates(): Promise<Template[]> {
  if (!isBrowser()) return [];
  try {
    const result = await runTx<unknown[]>('readonly', (store) =>
      store.getAll()
    );
    return (result ?? [])
      .map(recordToTemplate)
      .filter((t): t is Template => !!t);
  } catch (err) {
    console.warn('[user-templates] getAll failed:', err);
    return [];
  }
}

export async function addUserTemplate(t: Template): Promise<void> {
  if (!isBrowser()) return;
  await runTx<IDBValidKey>('readwrite', (store) => store.put(t));
}

export async function removeUserTemplate(id: string): Promise<void> {
  if (!isBrowser()) return;
  await runTx<undefined>('readwrite', (store) => store.delete(id));
}
