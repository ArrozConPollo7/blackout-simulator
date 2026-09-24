# Design.md — Energía en Crisis

Sistema de diseño de referencia para las vistas Host y Player. Esto es lo que alimenta cualquier prompt de mockup (Stitch u otro) y lo que debe reflejar la implementación real en Tailwind.

---

## 1. Principios

- **Centro de control real, no juego infantil.** Estética SCADA/telemetría industrial: precisión, densidad controlada, sin decoración gratuita.
- **Cero emojis.** Solo íconos de línea monocromáticos, consistentes en tamaño y grosor de trazo.
- **Cero datos inventados.** Cada número en pantalla corresponde a una variable real del motor de juego (ver `documento-proyecto-energia-en-crisis.md`, sección 5). Nada de IDs de sesión, latencias, QR, "operadores" decorativos.
- **Densidad controlada.** Máximo 3 bloques de información primaria visibles a la vez por pantalla.
- **Consistencia entre estados.** Lobby, En Juego, Crisis y Resultados comparten header, tipografía y componentes de tarjeta — son la misma app, no pantallas de sistemas distintos.

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

1. **Lobby** — lista de equipos conectándose + botón "Iniciar juego"
2. **En juego** — vecindario 3D + franja de ranking/KPIs + timer
3. **Crisis** — overlay de alerta, vecindario en modo rojo
4. **Resultados** — podio + KPIs finales + mensaje educativo de cierre

## 8. Estados de pantalla (Player)

1. **Investigar** — grid de tarjetas de electrodomésticos
2. **Decidir** — escenario + 3 opciones apiladas
3. **Crisis** (interrupción) — banner de alerta a pantalla completa
4. **Resultados** — posición final + comparación contra el promedio del aula
