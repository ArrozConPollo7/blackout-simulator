# Design.md — Energía en Crisis

Sistema de diseño de referencia para las vistas Host y Player. Esto es lo que alimenta cualquier prompt de mockup (Stitch u otro) y lo que debe reflejar la implementación real en Tailwind.

---

## 1. Principios

- **Centro de control real, no juego infantil.** Estética SCADA/telemetría industrial: precisión, densidad controlada, sin decoración gratuita.
- **Cero emojis.** Solo íconos de línea monocromáticos, consistentes en tamaño y grosor de trazo.
- **Cero datos inventados.** Cada número en pantalla corresponde a una variable real del motor de juego (ver `documento-proyecto-energia-en-crisis.md`, sección 5). Nada de IDs de sesión, latencias, voltajes ni "operadores" decorativos. **Excepción explícita: el QR del lobby** (Fase 3), que no es adorno sino el canal de entrada de las mesas: codifica `/join?game=…`, y sin él nadie puede registrarse. Un elemento gráfico solo se permite si hace trabajo real.
- **Densidad controlada.** Máximo 3 bloques de información primaria visibles a la vez por pantalla.
- **Consistencia entre estados.** Lobby, En Juego, Crisis y Resultados comparten header, tipografía y componentes de tarjeta — son la misma app, no pantallas de sistemas distintos.
- **La pantalla no habla de tecnología.** El aula ve un centro de control, no una consola de desarrollo: prohibido «Worker», «Supabase», «API», «token», nombres de variables o rutas. Los avisos de configuración incompleta existen solo en desarrollo. Si algo no puede explicarse en el idioma del juego, no se muestra.
- **Es un juego, no un panel.** La energía y la tensión son parte del diseño: contadores vivos, avisos de urgencia, celebración de los cambios de puesto y un cierre de podio. Lo que se anima siempre informa (cuánto queda, quién acaba de decidir, quién subió).

---

## 2. Paleta de colores

| Token | Hex | Uso |
|---|---|---|
| `bg-primary` | `#0A0E17` | Fondo base |
| `bg-surface` | `#131826` | Tarjetas / paneles |
| `border` | `#232B3D` | Divisores, bordes de tarjeta |
| `text-primary` | `#E7ECF5` | Texto principal |
| `text-secondary` | `#8792A8` | Etiquetas, texto secundario |
| `accent-electricidad` | `#F5B942` (ámbar) | Todo lo relacionado a ⚡ electricidad |
| `accent-gas` | `#F2622E` (naranja-rojo) | Todo lo relacionado a 🔥 gas |
| `accent-eficiencia` | `#3ECF8E` (verde) | Todo lo relacionado a 🌱 eficiencia |
| `accent-presupuesto` | `#3EC6F0` (cian) | Todo lo relacionado a 💰 presupuesto |
| `accent-crisis` | `#FF3B4E` (rojo alerta) | Solo durante el evento de crisis |

---

## 3. Tipografía

- **Etiquetas / UI general:** Inter (sans-serif limpia, alta legibilidad a distancia)
- **Datos numéricos (kWh, $, %, timer):** JetBrains Mono o IBM Plex Mono — la fuente monoespaciada refuerza la sensación de "lectura de instrumento", y evita que los números "salten" de ancho al cambiar de valor.

---

## 4. Iconografía (Material Symbols Outlined — confirmado en los mockups de Stitch)

Set de íconos de línea **Material Symbols Outlined** (Google Fonts), un ícono fijo por concepto, cero emojis. *(Nota: versiones anteriores de este documento indicaban Lucide; se corrige aquí para reflejar lo que realmente se construyó en los mockups.)*

| Concepto | Ícono (Material Symbols) |
|---|---|
| Electricidad | `bolt` |
| Gas | `local_fire_department` |
| Presupuesto | `account_balance_wallet` |
| Eficiencia | `speed` |
| Tiempo restante | `timer` |
| Vivienda / caso del equipo | `home` |
| Aire acondicionado | `ac_unit` |
| Computador | `computer` |
| Iluminación | `lightbulb` |
| Cocina / estufa | `outdoor_grill` |
| Evento de crisis | `warning` |
| Resultados / podio | `emoji_events` |
| Ranking / posición (sube/baja/estable) | `trending_up` / `trending_down` / `trending_flat` |
| Avatar / usuario | `person` |

Íconos utilitarios adicionales usados en la interfaz de Host (no mapean a variables del juego, son de estado del sistema):

| Uso | Ícono |
|---|---|
| Estado de conexión / red | `sensors` |
| Sincronización | `sync` |
| Controles de host | `admin_panel_settings` |
| Iniciar / pausar simulación | `play_arrow` / `pause` |
| Vista / cámara | `visibility` |
| Medidor eléctrico | `electric_meter` |
| Vista de cuadrícula | `grid_view` |

---

## 5. Espaciado y componentes

- Unidad base: `8px` (usar múltiplos: 8, 16, 24, 32)
- Radio de esquina de tarjetas: `12px`
- Tarjeta de equipo: header (color + nombre) → 4 métricas en fila (íconos + barra de progreso) → posición en ranking
- Timer: siempre en la esquina superior o header persistente, nunca dentro de una tarjeta de equipo
- Botones (vista Player): altura mínima táctil 48px, un solo botón por opción de decisión, apilados verticalmente

---

## 6. Modelo 3D — "Vecindario reactivo" (solo Host)

Una casa low-poly por equipo (4-6 casas), no una casa genérica agregada. Corre únicamente en Host — nunca en la vista Player.

| Variable del equipo | Reacción visual |
|---|---|
| Electricidad | Nº de ventanas iluminadas |
| Gas | Intensidad de partícula de humo/llama en chimenea |
| Eficiencia | Color de césped/aura: verde → ámbar → rojo |
| Presupuesto | Velocidad de un medidor girando sobre el techo |
| Ranking | Halo/spotlight sutil sobre la casa líder |

Durante la Crisis: ambiente de todo el vecindario cambia a tono `accent-crisis`, con parpadeo/chispa breve simultánea en todas las casas.

### Mockup vs. implementación real

Para los mockups de Stitch, el vecindario se representa como una **imagen ilustrada isométrica de fondo** (no SVG dibujado a mano) con etiquetas HUD flotantes superpuestas por casa — mismo tratamiento atmosférico (luz, sombra, profundidad) en los 4 estados de pantalla (Lobby, En Juego, Crisis, Resultados), solo cambia la paleta/tono según el estado.

Esa imagen es referencia de dirección de arte, no algo replicable literalmente en Three.js en tiempo real. La implementación real debe acercarse a esa riqueza visual con: post-procesamiento (bloom en ventanas/chispas), niebla/vignette sutil, y materiales emissive + luces puntuales por casa — no polígonos planos de color sólido.

---

## 7. Estados de pantalla (Host)

1. **Acceso** — la consola se abre con la contraseña de anfitrión (guarda en `sessionStorage`); el proyector es público, los controles no.
2. **Lobby** — QR de registro de mesas + contador `n/slots` + botón "Iniciar juego" (deshabilitado hasta que entre al menos una mesa).
3. **En juego** — vecindario 3D + franja de ranking/KPIs + timer
4. **Crisis** — overlay de alerta, vecindario en modo rojo
5. **Resultados** — podio + KPIs finales + mensaje educativo de cierre

## 8. Estados de pantalla (Player)

1. **Registro** (`/join`) — nombre del equipo; si el celular ya entró, "continuar con ese equipo"
2. **Investigar** — grid de tarjetas de electrodomésticos
3. **Decidir** — escenario + 3 opciones apiladas
4. **Crisis** (interrupción) — banner de alerta a pantalla completa
5. **Resultados** — posición final + comparación contra el promedio del aula

---

## 9. Movimiento y sonido (Fase 3)

### Lenguaje de movimiento

- **Todo movimiento comunica estado, nunca decora.** Si una animación no se puede explicar en
  una frase ("esto parpadea porque la red está en crisis"), no entra.
- **Interpolación exponencial, no saltos**: en 3D, `1 - Math.exp(-delta * k)`; en CSS,
  `transform`/`opacity` con `animation`. Nunca `setState` dentro de un bucle de render.
- **Duraciones y curvas**: entradas de 220-420 ms con `cubic-bezier(0.2, 0.8, 0.2, 1)`;
  pulsos lentos (1.6-2.6 s) para lo ambiental; nada de rebotes ni de "juguete".
- **Presupuesto de movimiento**: en el proyector no conviven más de dos animaciones continuas
  (crisis + líder), y el resto son transiciones finitas. El modo ligero del proyecto
  (`?lite=1`) sigue mandando sobre cualquier efecto.
- **`prefers-reduced-motion: reduce`** desactiva las animaciones decorativas en las dos vistas.
- El feedback de una decisión aparece **después** de la respuesta del Worker (nunca antes),
  con un destello verde y deslizamiento: la interfaz no anticipa el resultado del motor.

### Teatro de sincronización (lo que hace que se sienta en vivo)

Patrones tomados de los juegos de aula en vivo (Kahoot, HQ Trivia, Jackbox) y aplicados aquí:

- **Un solo reloj en todas las pantallas.** El tiempo sale de la marca del servidor y se dibuja como
  barra/aro que se agota (verde → ámbar → rojo) en el proyector y en el celular. Nadie cuenta
  segundos por su cuenta.
- **Contador vivo.** «Mesas dentro», «mesas que ya decidieron», decisiones registradas y consumo del
  aula se mueven en la pantalla grande: el aula ve que está pasando algo aunque nadie hable.
- **Bloqueo y revelación.** En el móvil, la elección se marca al instante y el resto de opciones se
  atenúan; el veredicto (y sus números) llega después del servidor. Nunca se adelanta el resultado.
- **Trayectoria, no solo posición.** «Subió 2 puestos» motiva en cualquier puesto; por eso el
  proyector celebra los cambios de ranking con el delta real, y el podio marca el aro del líder.
- **Ritmo del operador.** La ronda se abre con una toma de pantalla que nombra lo que viene; el
  cronómetro lo abre el anfitrión cuando el grupo está listo.
- **Nunca se calla una espera.** Si algo tarda, la interfaz lo dice («Montando la sala…»,
  «Enviando…», «Revalidando credencial…»). La latencia sin explicación se lee como avería.
- **El puesto siempre en texto.** Ninguna posición se comunica solo con color o movimiento: hay
  número, palabra y etiqueta (accesibilidad y proyector descalibrado).

### Lenguaje de sonido

- **Estética de subestación, no de videojuego arcade**: tonos cortos, secos, con filtro
  paso-bajo, sin melodías largas ni samples. Sintetizado con Web Audio (`lib/audio.ts`); el
  proyecto no empaqueta archivos de audio.
- **Arranca en silencio.** El sonido es opcional y el Host lo enciende con el botón de sonido
  (el `AudioContext` solo se desbloquea en un gesto del usuario). La preferencia se recuerda.
- **Volumen contenido**: un `GainNode` maestro limita la suma; el sonido acompaña al aula, no
  compite con la voz de los equipos.
- Cada evento tiene un motivo distinto: `confirm` para una acción aceptada, `deny` para un
  rechazo, `crisis` (sirena + caída de tensión) solo cuando el evento sorpresa entra en escena,
  `podium` para el cierre. Repetir el mismo tono para todo convierte la información en ruido.
- Nunca se usa el sonido para castigar un toque torpe en la vista Player: los toques que solo
  abren una ficha suenan igual que cualquier otro (`click`). Solo el **rechazo del motor**
  (decisión repetida, fase equivocada) lleva su tono bajo y corto (`deny`), porque ahí sí hay
  información que la mesa necesita.
