// The sim workers (worker.js), called by SimWorkerPool.cs. The page has one thread, so each worker is a .NET runtime of its
// own: one per core but the page's, up to MaxWorkers, started at the first sim or replay. A sim's chunks go to its workers
// as each frees up, and a worker merges them in chunk order; a replay takes the least busy worker.

/** Most workers: each holds a .NET runtime of its own (tens of MB). */
const MaxWorkers = 16;

const workers = [];
const cancelled = new Set();
let nextCall = 1;

/** The browser's logical processors (2 when it does not say). */
export function cores() {
  return navigator.hardwareConcurrency || 2;
}

/** The workers a sim can use: the cores but the page's, from 1 to MaxWorkers. */
export function size() {
  return Math.max(1, Math.min(cores() - 1, MaxWorkers));
}

function spawn() {
  // With this script's build stamp (?v=), so the worker is of the same build; and this build's dotnet.js, from the page's
  // import map, which a worker does not have.
  const url = new URL('./worker.js' + new URL(import.meta.url).search, import.meta.url);
  url.searchParams.set('dotnet', import.meta.resolve?.('../_framework/dotnet.js') ?? new URL('../_framework/dotnet.js', import.meta.url).href);
  const worker = new Worker(url, { type: 'module' });
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
  while (workers.filter(w => !w.retiring).length < size()) workers.push(spawn());
}

// A worker that has replayed a fight: a runtime's memory never shrinks, so the worker would keep the replay's peak (up
// to 2 GB for a long fight) for as long as it runs. It takes no new calls, and stops once its calls are done; the next
// run starts another in its place.
function retire(w) {
  w.retiring = true;
  release(w);
}

// One call fewer on a worker; a retiring worker with none left stops.
function release(w) {
  w.busy--;
  if (w.retiring && w.busy === 0 && !w.dead) {
    w.dead = true;
    w.worker.terminate();
  }
}

function call(w, message, progress) {
  return new Promise((resolve, reject) => {
    const id = nextCall++;
    w.calls.set(id, { resolve, reject, progress });
    w.worker.postMessage({ ...message, id });
  });
}

function leastBusy(count) {
  return workers.filter(w => !w.retiring).sort((a, b) => a.busy - b.busy).slice(0, count);
}

/**
 * Runs sim `runId`'s `chunkCount` chunks on up to `wanted` workers (all when null). `sink` (a .NET object) hears
 * OnChunk(chunk, count, mean, m2) as each chunk completes, and answers with the chunks of the result: a sim to a target
 * error ends at fewer. Resolves to the result's JSON; a cancelled run rejects with an AbortError.
 */
export async function simulate(runId, profileJson, settingsJson, chunkCount, wanted, sink) {
  ensure();
  const chosen = leastBusy(Math.max(1, Math.min(wanted ?? workers.length, workers.length, chunkCount)));
  await Promise.all(chosen.map(w => w.ready));
  const chunks = new Array(chunkCount);
  let next = 0;
  let resultChunks = chunkCount;
  try {
    await Promise.all(chosen.map(async w => {
      w.busy++;
      try {
        await call(w, { type: 'start', runId, profileJson, settingsJson });
        try {
          while (!cancelled.has(runId) && next < resultChunks) {
            const chunk = next++;
            const reply = await call(w, { type: 'chunk', runId, chunk });
            chunks[chunk] = reply.json;
            const answer = await sink.invokeMethodAsync('OnChunk', chunk, ...reply.moments);
            if (answer >= 0) resultChunks = Math.min(resultChunks, answer);
          }
        } finally {
          if (!w.dead) w.worker.postMessage({ id: 0, type: 'finish', runId });
        }
      } catch (e) {
        cancelled.add(runId);
        throw e;
      } finally {
        release(w);
      }
    }));
    const result = chunks.slice(0, resultChunks);
    if (cancelled.has(runId) || result.some(c => c === undefined)) throw new DOMException('The sim was cancelled.', 'AbortError');
    // On a worker of the sim's that still runs: one that replayed a fight meanwhile has stopped.
    ensure();
    const w = chosen.find(c => !c.dead) ?? leastBusy(1)[0];
    await w.ready;
    w.busy++;
    try {
      return (await call(w, { type: 'combine', profileJson, settingsJson, chunks: result })).json;
    } finally {
      release(w);
    }
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
 * OnProgress(text). Resolves to the reply's bytes. The fight never reaches the page.
 */
export async function reviewFight(reportCode, fightId, playerId, accessToken, clientId, clientSecret, sink) {
  ensure();
  const [w] = leastBusy(1);
  await w.ready;
  w.busy++;
  try {
    return (await call(w, { type: 'reviewFight', reportCode, fightId, playerId, accessToken, clientId, clientSecret },
      text => sink.invokeMethodAsync('OnProgress', text))).bytes;
  } finally {
    retire(w);
  }
}

/** Fights the first fight of a sim on the least busy worker, tracing every decision. Resolves to the reply's JSON. */
export async function traceFight(profileJson, settingsJson) {
  ensure();
  const [w] = leastBusy(1);
  await w.ready;
  w.busy++;
  try {
    return (await call(w, { type: 'traceFight', profileJson, settingsJson })).json;
  } finally {
    release(w);
  }
}

/**
 * Replays player `playerId` of a raw fight's UTF-8 JSON (a Uint8Array) on the least busy worker; `sink` hears
 * OnProgress(text). Resolves to the reply's bytes.
 */
export async function review(rawFight, playerId, sink) {
  ensure();
  const [w] = leastBusy(1);
  await w.ready;
  w.busy++;
  try {
    return (await call(w, { type: 'review', rawFight, playerId }, text => sink.invokeMethodAsync('OnProgress', text))).bytes;
  } finally {
    retire(w);
  }
}
