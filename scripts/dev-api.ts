/**
 * API local de desarrollo: sirve el MISMO router del Worker (`handleRequest`) sobre
 * Node con el repositorio en memoria.
 *
 * Sirve para probar la interfaz completa (Host + Players) sin Supabase y sin desplegar
 * nada, por ejemplo para ensayar la clase. La partida vive en memoria: al reiniciar el
 * proceso se pierde.
 *
 *   npm run dev:api            # http://127.0.0.1:8787
 *   PORT=9000 npm run dev:api
 *
 * Para la versión real (persistencia + Realtime) usa `wrangler dev` con
 * SUPABASE_SERVICE_ROLE_KEY configurada en worker/.dev.vars.
 */

import { createServer } from 'node:http';
import { handleRequest } from '../worker/src/index.ts';
import { InMemoryRepo } from '../worker/src/repo-memory.ts';
import type { Env } from '../worker/src/env.ts';

const port = Number(process.env.PORT ?? 8787);
const hostToken = process.env.HOST_TOKEN ?? 'host-local';

const env: Env = {
  SUPABASE_URL: 'memoria-local',
  SUPABASE_SERVICE_ROLE_KEY: 'memoria-local',
  HOST_TOKEN: hostToken,
  ALLOWED_ORIGINS: '*',
};

const repo = new InMemoryRepo();
let peticiones = 0;

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

  const request = new Request(`http://127.0.0.1:${port}${req.url ?? '/'}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });

  const response = await handleRequest(request, env, repo);
  peticiones += 1;
  if (process.env.LOG_REQUESTS === 'true') {
    console.log(`${peticiones}  ${req.method} ${req.url}  ->  ${response.status}`);
  }

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, () => {
  console.log(`API local (repositorio en memoria) en http://127.0.0.1:${port}`);
  console.log(`HOST_TOKEN=${hostToken} (debe coincidir con NEXT_PUBLIC_HOST_TOKEN)`);
  console.log('GET /health para comprobar que responde.');
});
