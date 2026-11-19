// Docker publishes ports on the ingress bridge. The data reader uses only the internal bridge.
import { connect, createServer } from 'node:net';

createServer(client => {
  const reader = connect({ host: 'viewer', port: 18787 });
  client.on('error', () => reader.destroy());
  reader.on('error', () => client.destroy());
  client.on('close', () => reader.destroy());
  reader.on('close', () => client.destroy());
  client.pipe(reader).pipe(client);
}).listen(18787, '0.0.0.0');
