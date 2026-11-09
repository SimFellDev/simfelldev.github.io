// One sim worker (simPool.js starts them): a .NET runtime of its own from the app's assemblies, without the page, running
// the SimWorker methods it is asked for. It says 'ready' (with its start time) once it can take calls; each call's reply
// carries the call's id, with its JSON or its error.
// The build's dotnet.js (?dotnet=, from the page's import map) and fights.js (with the build stamp, ?v=), so they are of
// this worker's build.
const params = new URL(import.meta.url).searchParams;
const { dotnet } = await import(params.get('dotnet') ?? '../_framework/dotnet.js');
const fights = await import(`./fights.js?v=${params.get('v') ?? ''}`);

const began = performance.now();
let worker;

try {
  const runtime = await dotnet.create();
  runtime.setModuleImports('simWorker', {
    progress: (id, text) => postMessage({ id, type: 'progress', text }),
    bytes: bytes => bytes,
    // The view is on the runtime's memory for this call alone: its bytes are copied before the save starts.
    saveFight: (reportCode, fightId, playerId, view) => {
      const text = view.slice();
      view.dispose();
      return fights.save(fights.key(reportCode, fightId, playerId), text);
    },
  });
  const exports = await runtime.getAssemblyExports('FellowshipSim.Web');
  worker = exports.FellowshipSim.Web.SimWorker;
  postMessage({ type: 'ready', bootMs: performance.now() - began });
} catch (e) {
  postMessage({ type: 'bootError', message: String(e?.message ?? e) });
}

onmessage = async ({ data }) => {
  const reply = { id: data.id };
  const started = performance.now();
  try {
    switch (data.type) {
      case 'start': worker.Start(data.runId, data.profileJson, data.settingsJson); break;
      case 'chunk': {
        reply.json = worker.Chunk(data.runId, data.chunk);
        // The chunk's fights' DPS moments, for the page's merge in chunk order: read here, so the page reads no chunk.
        const { count, mean, m2 } = JSON.parse(reply.json);
        reply.moments = [count, mean, m2];
        break;
      }
      case 'finish': worker.Finish(data.runId); return;
      case 'combine': reply.json = worker.Combine(data.profileJson, data.settingsJson, data.chunks); break;
      case 'traceFight': reply.json = await worker.TraceFight(data.profileJson, data.settingsJson); break;
      case 'review':
        // The fight goes in a call of its own, so no frame of the replay holds it.
        worker.HoldFight(data.rawFight);
        reply.bytes = await worker.Review(data.playerId, data.id);
        break;
      case 'reviewFight': {
        // A fight the browser keeps replays from it, costing no FellowshipLogs points; any other is downloaded and kept.
        const kept = fights.bytes(await fights.read(fights.key(data.reportCode, data.fightId, data.playerId)));
        if (kept != null) {
          postMessage({ id: data.id, type: 'progress', text: 'Using the fight saved in this browser' });
          worker.HoldFight(kept);
        }
        reply.bytes = kept != null
          ? await worker.Review(data.playerId, data.id)
          : await worker.ReviewFight(data.reportCode, data.fightId, data.playerId, data.accessToken, data.clientId,
            data.clientSecret, data.id);
        break;
      }
      default: throw new Error(`No worker call named ${data.type}.`);
    }
  } catch (e) {
    reply.error = String(e?.message ?? e);
  }
  reply.ms = performance.now() - started;
  // A replay's reply moves to the page without a copy.
  postMessage(reply, reply.bytes ? [reply.bytes.buffer] : []);
};
