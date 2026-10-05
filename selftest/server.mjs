/**
 * Minimal static server for the fake Oracle used by the end to end self test.
 * No dependency, no configuration. Started automatically by playwright.selftest.config.ts.
 *
 * Two routes, because one of the traps needs a second document: /frame is served into the iframe
 * on the course form, so the engine has a real embedded page to search rather than a simulated one.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-oracle');
const port = Number(process.env.SELFTEST_PORT ?? 4173);

http
  .createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const file = url === '/frame' ? 'frame.html' : 'index.html';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(dir, file)));
  })
  .listen(port, () => console.log(`fake oracle on http://localhost:${port}`));
