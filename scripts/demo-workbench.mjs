// Preloaded into the demo app so its own listener establishes the launcher address.
import { channel } from 'node:diagnostics_channel';
import { Server } from 'node:http';
import { createPraxisServer } from '../src/server.mjs';

const bound = channel('tracing:net.server.listen:asyncEnd');
function showWorkbench({ server }) {
  if (!(server instanceof Server)) return;
  const address = server.address();
  if (address?.address !== '127.0.0.1') return;
  bound.unsubscribe(showWorkbench);
  const workbench = createPraxisServer({
    demoApp: { id: process.env.PRAXIS_DEMO_APP, port: address.port },
    observationsFile: null,
    publicUrlsFile: null,
  });
  server.once('close', () => workbench.close());
  workbench.listen(0, '127.0.0.1', () => {
    console.log(`Demo workbench: http://127.0.0.1:${workbench.address().port}/`);
  });
}
bound.subscribe(showWorkbench);
