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
en `/rules`; provienen de la nota de Obsidian *Juego - NFI*. El manual largo para quien opera el juego (aritmética
exacta, catálogo de incidentes, montaje en el aula y checklist de clase) está en
[`docs/manual-del-juego.md`](docs/manual-del-juego.md).

Cada partida sortea además **incidentes aleatorios** sobre la crisis de la ronda (19 sucesos en cinco familias:
techo, demanda, economía, bloqueo de palancas y alivio), de forma que dos partidas nunca se juegan igual. El
sorteo es reproducible por semilla y está garantizado que ninguna combinación hace la ronda irresoluble.

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
npx wrangler login                       # tu cuenta de Cloudflare (una vez)
npx wrangler secret put HOST_PASSCODE    # 1º el secreto: wrangler lo pide de forma interactiva
npm run worker:deploy                    # 2º publica Worker + Durable Objects
```

Wrangler imprime la URL (`https://blackout-grid-collapse.<tu-subdominio>.workers.dev`). El primer despliegue
pregunta si quieres registrar un subdominio `workers.dev`: acepta y elige el que prefieras.

`HOST_PASSCODE` es el **nombre** de la variable: el valor se escribe en el prompt interactivo de wrangler (no se
pasa en la línea de comandos — `HOST_PASSCODE=1234 npx wrangler …` **no** crea el secreto). Es **numérico**: el
teclado en pantalla del proyector solo acepta dígitos. Compruébalo con `npx wrangler secret list` (lista nombres,
nunca valores).

`wrangler.jsonc` no declara `vars.HOST_PASSCODE` a propósito: un `vars` con el mismo nombre **sobrescribe el
secreto** en cada despliegue (wrangler lo avisa: *"Configuration values (...) conflict with existing remote
secrets"*). Y al revés: si despliegas sin secreto, el Durable Object no tiene clave y rechaza toda orden del
proyector → **el secreto va primero**. Para desarrollo local (`npm run worker:dev`) copia `.dev.vars.example` a
`.dev.vars` (está en `.gitignore`).

- Proyector: `https://<tu-url>/host/` (misma clave maestra que subiste como secreto).
- Mando: `https://<tu-url>/` desde el móvil, en cualquier red.
- En local, para probar antes de publicar: `npm run worker:dev` (levanta workerd en `http://127.0.0.1:8788`).

### Dominio propio (opcional)

El proyecto no tiene rutas ni hosts fijos: la interfaz se resuelve contra `window.location` (el socket cambia a
`wss://` solo cuando la página va por https) y la URL que el proyector enseña a los móviles es su propio origen.
Es decir, **no hay que tocar código**: basta con atar el Worker al dominio.

1. **Requisito:** la zona del dominio tiene que estar en la **misma cuenta de Cloudflare** (nameservers del
   registrador apuntando a Cloudflare).
2. **Dashboard:** Worker `blackout-grid-collapse` → *Settings* → *Domains & Routes* → *Add* → *Custom Domain* →
   `juego.tudominio.com`.
3. **O en configuración** (queda versionado y lo aplica el mismo despliegue):

   ```jsonc
   "routes": [{ "pattern": "juego.tudominio.com", "custom_domain": true }]
   ```

   y después `npm run worker:deploy`. El certificado TLS lo emite Cloudflare solo (Universal SSL), sin costo extra.

El `workers.dev` sigue funcionando en paralelo (mismo Worker, dos puertas). Redesplegar no pierde partidas en
curso: el estado vive en el Durable Object de cada sala. Si el dominio está en otro proveedor de DNS y no quieres
mover la zona, la alternativa es un CNAME a `<worker>.<subdominio>.workers.dev`, pero ahí el certificado y el
enrutado los gobierna ese proveedor: la vía soportada es el Custom Domain.

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `HOST_PASSCODE` | `1984` | Clave maestra del anfitrión. **En internet usa un secreto** (`wrangler secret put`), no el valor por defecto. |
| `ANNOUNCE_SECONDS` | `10` | Duración del anuncio de crisis. |
| `NEGOTIATION_SECONDS` | `60` | Duración de la negociación (el documento fija 60 s). |
| `PORT` | `3006` | Puerto del servidor Node (opción A). |
| `GAME_SEED` | aleatoria | Fija la semilla del sorteo de incidentes: repite el mismo guion de partida. |
| `INCIDENTS` | `on` | `off` desactiva los incidentes y deja la aritmética pura del documento (respaldo). |

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
1.440 MW / 3.000 m³, igual que en el documento. Los **incidentes aleatorios** multiplican (o suman) sobre eso:
ronda 1 sin incidentes, ronda 2 y 3 con uno, ronda 4 con dos de familias distintas, y ninguno se repite en la
partida. Dos de ellos pueden **bloquear los servicios críticos** durante una ronda: el servidor rechaza el corte
tanto desde el mando de la mesa como desde el override del anfitrión (el SCRAM también los respeta).

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
src/app/rules/page.tsx    Manual de reglas para el aula (sectores, crisis e incidentes)
docs/manual-del-juego.md  Manual completo: reglas, aritmética, guion de clase y montaje
scripts/reference-game.js Partida de referencia sin interfaz + barrido de semillas (balance)
scripts/drive-room.js     Utilidad de dev: abre una sala y salta a una ronda concreta por WebSocket
scripts/build-manual-html.py  Convierte el manual a HTML imprimible (base del PDF)
tests/engine.test.js      Aritmética del documento y del sorteo de incidentes (node:test)
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
npm test              # motor + partida completa contra el servidor Node   (35 pruebas)
npm run test:engine   # solo la aritmética y el sorteo de incidentes      (24 pruebas)
npm run test:worker   # partida completa contra el Worker real            (9 pruebas, necesita build:static)
npm run typecheck     # tsc --noEmit
curl localhost:3006/healthz   # salas activas, fase, ronda, apagones, semilla, incidentes y bloqueos
node scripts/reference-game.js --seed 4200   # juega una partida sin interfaz (números del manual)
node scripts/reference-game.js --scan 300    # balance: ¿tiene salida cada semilla?
```

Las pruebas del motor corren **sin incidentes** (`createRoom(pin, { incidents: false })`) porque verifican la
aritmética del documento; el sorteo, los bloqueos y la economía de los incidentes se prueban aparte, con semillas
fijas, incluida una prueba que recorre más de 400 combinaciones para demostrar que ninguna ronda queda sin salida
y que no decidir nunca salva la red.

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