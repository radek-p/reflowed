// A free TCP port for a server another process starts (tests/integration/serve.ts takes its port as an argument):
// the system picks one (listen on 0, every address), it is read and let go. A fixed or pid-derived port met other
// runs' servers, and a probe of it could even get a foreign server's answer.
//
//   const port = await freePort()
import { createServer, type AddressInfo } from 'node:net';

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); });
  });
}
