import { parseArgs } from 'node:util';
import { startSidecarServer } from '../../scripts/sidecar-server.mjs';

const { values } = parseArgs({
  options: { port: { type: 'string' } },
  strict: false,
});

await startSidecarServer({
  port: values.port === undefined ? undefined : Number(values.port),
});
