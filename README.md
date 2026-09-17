# BLACKOUT: GRID COLLAPSE — Terminal CRT-Punk

Simulador multijugador **asimétrico** de gestión de crisis eléctrica en tiempo real para un salón de clase.
Dos vistas sobre el mismo estado autoritativo:

- **Proyector / Host** (`/host`): tablero general con capacidad de la red, cronómetro, crisis vigente, malla de
  distritos, telemetría y clasificación final. Requiere clave maestra.
- **Mando de Distrito** (`/`): interfaz táctil por mesa para encender/apagar los tres sectores del distrito.
  Toda la coordinación es **verbal en el aula**: la aplicación no tiene chat, a propósito.

La estética es retro-futurista CRT-punk (scanlines, curvatura de tubo, fósforo verde/cian, shake de pantalla,
sintetizador Web Audio procedural).

Reglas completas (tabla de sectores, castigos, pool de crisis y criterios de victoria) en la propia aplicación,
en `/rules`; provienen de la nota de Obsidian *Juego - NFI*.

---

## Opción A — LAN, sin internet (servidor Node)

Ideal para el aula: nada sale a la red pública, todos en la misma Wi-Fi.

```bash
npm install
npm run dev
# Proyector:  http://localhost:3006/host      (clave maestra por defecto: 1984)
# Mando:      http://<IP-LAN-de-tu-PC>:3006   (el proyector muestra la URL para los móviles)
```

`server.js` sirve Next.js y el WebSocket autoritativo (`ws://…/ws`) en el mismo puerto. También vale
`npm run build && npm start` para modo producción.

## Opción B — Público en Cloudflare Workers (cualquier red o datos)

Con esta opción las mesas entran desde **cualquier red, datos móviles incluidos**, a una URL `https://`.
Cada sala vive en su propio **Durable Object**: autoridad única, WebSocket nativo, sin servidores que se
duerman y con el estado guardado en el almacenamiento del objeto (sobrevive a reinicios y despliegues).

```bash
npx wrangler login                 # tu cuenta de Cloudflare (una vez)
npx wrangler secret put HOST_PASSCODE   # clave maestra de verdad para internet
npm run worker:deploy              # compila la interfaz estática y publica Worker + Durable Objects
```

Wrangler imprime la URL (`https://blackout-grid-collapse.<tu-subdominio>.workers.dev`). El primer despliegue
pregunta si quieres registrar un subdominio `workers.dev`: acepta y elige el que prefieras.

- Proyector: `https://<tu-url>/host/` (misma clave maestra que subiste como secreto).
- Mando: `https://<tu-url>/` desde el móvil, en cualquier red.
- En local, para probar antes de publicar: `npm run worker:dev` (levanta workerd en `http://127.0.0.1:8788`).

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `HOST_PASSCODE` | `1984` | Clave maestra del anfitrión. **En internet usa un secreto** (`wrangler secret put`), no el valor por defecto. |
| `ANNOUNCE_SECONDS` | `10` | Duración del anuncio de crisis. |
| `NEGOTIATION_SECONDS` | `60` | Duración de la negociación (el documento fija 60 s). |
| `PORT` | `3006` | Puerto del servidor Node (opción A). |

En Cloudflare se pasan como `vars` en `wrangler.jsonc` o con `--var CLAVE:valor` al desplegar:

```bash
npx wrangler deploy --var NEGOTIATION_SECONDS:45
```

Cada clase que juega en paralelo usa su **propio PIN de sala**, y eso la aísla en su propio Durable Object.

---

## Flujo de una partida (4 rondas)

1. **Vestíbulo.** El anfitrión reserva el panel (4, 5 o 6 distritos); cada mesa entra desde su teléfono con el
   PIN de sala (`VOLT` por defecto) y **toma un distrito libre** (uno por mesa; los distritos que nadie tome
   siguen consumiendo y el anfitrión puede operarlos a mano).
2. **Anuncio de crisis (10 s).** Se recorta la capacidad de la ronda y se muestra la tarjeta del evento.
3. **Negociación en vivo (60 s).** Los distritos debaten en voz alta; cada palanca mueve los medidores del
   proyector al instante. Los sectores se rearman al 100% al inicio de cada ronda.
4. **Resolución automática (t = 0).** El servidor compara la demanda agregada de MW **y** de gas con el techo de
   la ronda: si cualquiera se pasa, hay **BLACKOUT** colectivo.
5. **2 apagones ⇒ `FALLO REGIONAL IRREVERSIBLE — NO HAY GANADORES`.** Si la red sobrevive las 4 rondas, gana el
   mayor **PEF = Bienestar + (Tesorería / 100)**, con menciones de *Operador de Red Ejemplar*, *Distrito Mártir*
   y *Distrito Parásito*.

### Balance

Cada distrito: 1.000 pts de Bienestar (0–1.200), $10.000 de tesorería y tres sectores:

| Sector | MW | Gas m³ | Encendido | Apagado | Si se apaga |
|---|---|---|---|---|---|
| Zona Industrial | 180 | 400 | +$3.000 | -$1.000 | sin daño a Bienestar |
| Zona Residencial | 120 | 250 | -$500 de red | -$500 de red | -150 Bienestar |
| Servicios Críticos | 60 | 100 | -$300 de red | -$300 de red | -450 Bienestar |
| **Total** | **360** | **750** | **+$2.200 netos** | — | — |

La capacidad regional de cada ronda es igual a la demanda base del panel (360 MW / 750 m³ por distrito): **la red
arranca sin margen**, y la crisis aplica sus multiplicadores — gas -20% (ronda 1), eléctrica -35% (ronda 2),
demanda residencial x2 (ronda 3) y ambas capacidades -50% (ronda 4). Con 4 distritos el techo base es
1.440 MW / 3.000 m³, igual que en el documento.

---

## Arquitectura

Dos runtimes, **un solo motor**:

```
src/shared/rules.js       MOTOR de reglas (CommonJS, sin I/O): demanda, capacidad, resolución, PEF
worker/index.js           Cloudflare Worker: enruta /ws al Durable Object de la sala y sirve los estáticos
worker/room.js            Durable Object de una sala: WebSocket Hibernation + alarm() + storage
server.js                 Servidor Node (LAN): Next + ws en el mismo puerto, mismo motor
src/lib/types.ts          Contrato de tipos del cliente + re-exportación de los datos de reglas
src/lib/useSocket.ts      Conexión (reconexión, heartbeat, PIN en la URL, cuenta atrás local)
src/app/page.tsx          Mando de distrito (móvil)
src/app/host/page.tsx     Proyector del anfitrión (host autorizado por el servidor)
src/app/grid/page.tsx     Visión general de la red (topología, osciloscopio, reserva girante)
src/app/rules/page.tsx    Manual de reglas para el aula
tests/engine.test.js      Aritmética del documento (node:test)
tests/e2e.test.js         Partida completa contra el servidor Node (puerto 3999)
tests/worker.e2e.test.js  Partida completa contra wrangler dev (Durable Objects)
```

- **Autoridad única:** los mandos solo envían intenciones (`TOGGLE_SECTOR`, `SCRAM`); el servidor responde con el
  estado completo.
- **El reloj no late:** el estado publica `deadlineTs` (fecha límite de la fase). El móvil dibuja la cuenta atrás
  por su cuenta y el servidor solo se despierta **una vez**, en la fecha límite (`alarm()` en el Durable Object,
  `setInterval` de 1 s en el servidor Node). Menos tráfico y un Durable Object que puede hibernar.
- **Estado en memoria o en storage:** en Cloudflare cada sala guarda su estado en el almacenamiento del Durable
  Object (hibernación y despliegues no lo pierden); en Node vive en memoria volátil, como pide el documento.
- **PIN en la URL del socket:** `wss://…/ws?pin=VOLT`. En Cloudflare el router necesita saber a qué Durable
  Object enrutar el upgrade; el servidor Node lo ignora.

### Protocolo WebSocket

Cliente → servidor: `HOST_OPEN_ROOM` (con `passcode`), `HOST_SEED_DISTRICTS`, `HOST_REMOVE_UNCLAIMED`,
`HOST_START_GAME`, `HOST_SKIP_ANNOUNCE`, `HOST_RESOLVE_NOW`, `HOST_NEXT_ROUND`, `HOST_RESET_GAME`,
`HOST_TOGGLE_SECTOR`, `WATCH_ROOM`, `JOIN_DISTRICT`, `LEAVE_DISTRICT`, `TOGGLE_SECTOR`, `SCRAM`, `PING`.

Servidor → cliente: `SYNC_STATE`, `JOIN_SUCCESS`, `JOIN_REJECTED`, `ROOM_NOT_FOUND`, `SESSION_EXPIRED`, `ERROR`,
`ALERT`.

---

## Pruebas

```bash
npm test              # motor + partida completa contra el servidor Node
npm run test:engine   # solo la aritmética del documento
npm run test:worker   # partida completa contra el Worker real (necesita `npm run build:static`)
npm run typecheck     # tsc --noEmit
curl localhost:3006/healthz   # servidor Node: salas activas, fase, ronda y apagones
```

`tests/worker.e2e.test.js` levanta `wrangler dev` y verifica, además de la partida: que cada PIN es una sala
aislada en su propio Durable Object, que la clave maestra se valida dentro del objeto, que las fases avanzan por
alarmas y que un socket nuevo recibe el estado persistido.

---

## Notas de mantenimiento

- **No ejecutes `npm run build` mientras `npm run dev` está corriendo**: ambos escriben en `.next/` y el servidor
  de desarrollo empieza a devolver 404 en sus CSS y chunks (página sin estilos). Detén el servidor, construye y
  vuelve a arrancar.
- Si `npm run build` falla con `next: Permission denied`, los binarios de `node_modules/.bin` perdieron el bit de
  ejecución (típico al copiar el proyecto desde Windows): `npm install` o `chmod +x node_modules/.bin/*`.
- Con npm 11 aparecen avisos de `allow-scripts` para `workerd` y `esbuild`: si `wrangler` se queja de que falta su
  binario, ejecuta `npm approve-scripts workerd esbuild && npm rebuild workerd esbuild`.
- La clave maestra se valida en el servidor (incluido el Durable Object): el formulario del proyector no la muestra
  ni la autocompleta, y sin clave las órdenes del proyector se rechazan.
- Los controles de la versión anterior que metían MW "gratis" (potenciómetro de voltaje, banco de baterías) y los
  distritos de IA se retiraron: el juego es de negociación entre personas. Se conservan el corte total de
  emergencia (SCRAM) y el override del anfitrión para distritos sin teléfono.
