// My Album — IndexedDB storage of saved results.
const DB = 'dalkom-booth', STORE = 'saves';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function albumAdd(entry) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, 'readwrite');
    t.objectStore(STORE).add({ ...entry, createdAt: Date.now() });
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
export async function albumList() {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result.sort((a, b) => b.createdAt - a.createdAt));
    r.onerror = () => rej(r.error);
  });
}
export async function albumDelete(id) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(id);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
