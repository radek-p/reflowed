// The demo's tiny server: workbench/demo/index.html (its viewport CSS filled in: bundle.ts demoHtml()), and demo.js bundled on each request (always fresh).
//   node workbench/scripts/serve.ts [port=8159]
import { createServer } from 'node:http';
import { join } from 'node:path';
import { WB, bundle, demoHtml } from './bundle.ts';

const port = Number(process.argv[2] ?? 8159);
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(demoHtml());
    } else if (url.pathname === '/demo.js') {
      const js = await bundle(join(WB, 'demo/main.ts'));      // before the head: a build error answers 500
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(js);
    } else { res.writeHead(404); res.end('not found'); }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end(String((e as Error).stack ?? e));
  }
}).listen(port, '0.0.0.0', () => console.log(`workbench demo on http://localhost:${port}/`));
