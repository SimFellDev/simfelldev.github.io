// The browser's copy of SimFell's data folder (BrowserDataFolder.cs): one IndexedDB object store, a file's path under the
// folder to its text.
const Database = 'simfell';
const Files = 'files';
let opened;

function open() {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(Database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(Files);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

async function transact(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(Files, mode);
    const request = action(transaction.objectStore(Files));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Every file's path. */
export function list() {
  return transact('readonly', store => store.getAllKeys());
}

export async function read(path) {
  return (await transact('readonly', store => store.get(path))) ?? null;
}

export async function write(path, text) {
  await transact('readwrite', store => store.put(text, path));
}

export async function remove(path) {
  await transact('readwrite', store => store.delete(path));
}
