// The fights the browser keeps for replays (the sim workers read and write them): each fight's raw events as downloaded,
// in an IndexedDB database of its own, on disk. The page never loads them, so a fight is in memory only in the worker
// that replays it. When each was saved is in a store apart, so keeping the newest Kept never reads the fights.
const Database = 'simfell-fights';
const Fights = 'fights';
const Saved = 'saved';
const Kept = 5;
let opened;

function open() {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(Database, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(Fights);
      request.result.createObjectStore(Saved);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

async function transact(stores, mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const request = action(transaction);
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** The key of fight `fightId` of report `reportCode`. */
export const key = (reportCode, fightId) => `${reportCode}_fight${fightId}`;

/** The fight's raw events as text, or null when the browser does not keep it. */
export async function read(fightKey) {
  return (await transact([Fights], 'readonly', t => t.objectStore(Fights).get(fightKey))) ?? null;
}

/** Keeps a fight, then drops the oldest beyond Kept. */
export async function save(fightKey, text) {
  await transact([Fights, Saved], 'readwrite', t => {
    t.objectStore(Fights).put(text, fightKey);
    return t.objectStore(Saved).put(Date.now(), fightKey);
  });
  const keys = await transact([Saved], 'readonly', t => t.objectStore(Saved).getAllKeys());
  const times = await transact([Saved], 'readonly', t => t.objectStore(Saved).getAll());
  const old = keys.map((k, i) => ({ k, saved: times[i] })).sort((a, b) => b.saved - a.saved).slice(Kept);
  if (old.length === 0) return;
  await transact([Fights, Saved], 'readwrite', t => {
    for (const o of old) {
      t.objectStore(Fights).delete(o.k);
      t.objectStore(Saved).delete(o.k);
    }
    return null;
  });
}
