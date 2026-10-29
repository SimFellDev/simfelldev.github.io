// The sim workers (worker.js), called by SimWorkerPool.cs. The page has one thread, so each worker is a .NET runtime of its
// own: one per core but the page's, up to MaxWorkers, started at the first sim or replay. A sim's chunks go to its workers
// as each frees up, and a worker merges them in chunk order; a replay takes the least busy worker.

/** Most workers: each holds a .NET runtime of its own (tens of MB). */
const MaxWorkers = 16;

const workers = [];
const cancelled = new Set();
let nextCall = 1;

/** The workers a sim can use: the cores but the page's, from 1 to MaxWorkers. */
export function size() {
  return Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, MaxWorkers));
}

function spawn() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const w = { worker, calls: new Map(), busy: 0, dead: false };
  w.ready = new Promise((resolve, reject) => { w.resolve = resolve; w.reject = reject; });
  w.ready.catch(() => { });
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') return w.resolve();
    if (data.type === 'bootError') return fail(w, new Error(data.message));
    const call = w.calls.get(data.id);
    if (!call) return;
    if (data.type === 'progress') return call.progress?.(data.text);
    w.calls.delete(data.id);
    if (data.error) call.reject(new Error(data.error));
    else call.resolve(data);
  };
  worker.onerror = e => fail(w, new Error(e.message || 'A sim worker stopped.'));
  return w;
}

// A worker that cannot go on: its calls fail, and the next run starts another in its place.
function fail(w, error) {
  w.dead = true;
  w.reject(error);
  for (const call of w.calls.values()) call.reject(error);
  w.calls.clear();
  w.worker.terminate();
}

function ensure() {
  for (let i = workers.length - 1; i >= 0; i--) if (workers[i].dead) workers.splice(i, 1);
  while (workers.length < size()) workers.push(spawn());
}

function call(w, message, progress) {
  return new Promise((resolve, reject) => {
    const id = nextCall++;
    w.calls.set(id, { resolve, reject, progress });
    w.worker.postMessage({ ...message, id });
  });
}

function leastBusy(count) {
  return [...workers].sort((a, b) => a.busy - b.busy).slice(0, count);
}

/**
 * Runs sim `runId`'s `chunkCount` chunks on up to `wanted` workers (all when null). `sink` (a .NET object) hears
 * OnChunk(done) as each chunk completes. Resolves to the result's JSON; a cancelled run rejects with an AbortError.
 */
export async function simulate(runId, profileJson, settingsJson, chunkCount, wanted, sink) {
  ensure();
  const chosen = leastBusy(Math.max(1, Math.min(wanted ?? workers.length, workers.length, chunkCount)));
  await Promise.all(chosen.map(w => w.ready));
  const chunks = new Array(chunkCount);
  let next = 0;
  let done = 0;
  try {
    await Promise.all(chosen.map(async w => {
      w.busy++;
      try {
        await call(w, { type: 'start', runId, profileJson, settingsJson });
        try {
          while (!cancelled.has(runId) && next < chunkCount) {
            const chunk = next++;
            chunks[chunk] = (await call(w, { type: 'chunk', runId, chunk })).json;
            sink.invokeMethodAsync('OnChunk', ++done);
          }
        } finally {
          if (!w.dead) w.worker.postMessage({ id: 0, type: 'finish', runId });
        }
      } catch (e) {
        cancelled.add(runId);
        throw e;
      } finally {
        w.busy--;
      }
    }));
    if (done < chunkCount) throw new DOMException('The sim was cancelled.', 'AbortError');
    return (await call(chosen[0], { type: 'combine', settingsJson, chunks })).json;
  } finally {
    cancelled.delete(runId);
  }
}

/** Stops sim `runId` after the chunks running now. */
export function cancel(runId) {
  cancelled.add(runId);
}

/**
 * Downloads a fight from FellowshipLogs on the least busy worker and replays player `playerId` there; `sink` hears
 * OnProgress(text). Resolves to the reply's JSON. The fight never reaches the page.
 */
export async function reviewFight(reportCode, fightId, playerId, accessToken, clientId, clientSecret, sink) {
  ensure();
  const [w] = leastBusy(1);
  await w.ready;
  w.busy++;
  try {
    return (await call(w, { type: 'reviewFight', reportCode, fightId, playerId, accessToken, clientId, clientSecret },
      text => sink.invokeMethodAsync('OnProgress', text))).json;
  } finally {
    w.busy--;
  }
}

/** Replays player `playerId` of a raw fight on the least busy worker; `sink` hears OnProgress(text). Resolves to the reply's JSON. */
export async function review(rawFight, playerId, sink) {
  ensure();
  const [w] = leastBusy(1);
  await w.ready;
  w.busy++;
  try {
    return (await call(w, { type: 'review', rawFight, playerId }, text => sink.invokeMethodAsync('OnProgress', text))).json;
  } finally {
    w.busy--;
  }
}
