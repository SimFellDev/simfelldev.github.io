// One sim worker (simPool.js starts them): a .NET runtime of its own from the app's assemblies, without the page, running
// the SimWorker methods it is asked for. It says 'ready' (with its start time) once it can take calls; each call's reply
// carries the call's id, with its JSON or its error.
import { dotnet } from '../_framework/dotnet.js';
import * as fights from './fights.js';

const began = performance.now();
let worker;

try {
  const runtime = await dotnet.create();
  runtime.setModuleImports('simWorker', {
    progress: (id, text) => postMessage({ id, type: 'progress', text }),
    saveFight: (reportCode, fightId, text) => fights.save(fights.key(reportCode, fightId), text),
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
      case 'chunk': reply.json = worker.Chunk(data.runId, data.chunk); break;
      case 'finish': worker.Finish(data.runId); return;
      case 'combine': reply.json = worker.Combine(data.settingsJson, data.chunks); break;
      case 'review': reply.json = await worker.Review(data.rawFight, data.playerId, data.id); break;
      case 'reviewFight': {
        // A fight the browser keeps replays from it, costing no FellowshipLogs points; any other is downloaded and kept.
        const kept = await fights.read(fights.key(data.reportCode, data.fightId));
        if (kept != null) postMessage({ id: data.id, type: 'progress', text: 'Using the fight saved in this browser' });
        reply.json = kept != null
          ? await worker.Review(kept, data.playerId, data.id)
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
  postMessage(reply);
};
