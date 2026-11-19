// Container entry point, installed alongside the pinned read-only app server.
import { observerServer } from './server.mjs';

if (process.getuid() === 0) throw new Error('Run the observation viewer as an unprivileged user.');
const file = process.env.POLARIS_OBSERVATIONS_FILE;
const workspaceId = file ? process.env.PRAXIS_WORKSPACE_ID : 'local';
if (!workspaceId) throw new Error('A mounted observation file requires a workspace ID.');
observerServer({ workspaceId, file }).listen(18787, '0.0.0.0');
