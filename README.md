# Energía en Crisis — Cascarón Visual Frontend (SCADA Telemetry)

Simulador y centro de telemetría de resiliencia energética para el control de micro-red y contingencias. Construido con **Next.js (App Router)**, **TypeScript** y **Tailwind CSS**, basado en el sistema de diseño oficial de **Stitch (SCADA Telemetry)**.

---

## 🚀 Stack Tecnológico

- **Framework**: Next.js 14 (App Router)
- **Lenguaje**: TypeScript
- **Estilos**: Tailwind CSS (Tokens oficiales extraídos de Stitch SCADA)
- **Tipografía**:
  - `Inter`: UI general y encabezados
  - `JetBrains Mono`: Métricas numéricas de telemetría y etiquetas técnicas
- **Iconografía**: Material Symbols Outlined (Google Fonts) — *Cero emojis*
- **Estado**: Mock data fuertemente tipado (`types/game.ts` y `mock/gameState.ts`)

---

## 📁 Estructura del Proyecto

```
├── app/
│   ├── globals.css              # Estilos globales y capas base
│   ├── layout.tsx               # Layout raíz con fuentes de Google y barra de demo
│   ├── page.tsx                 # Portal principal de navegación
│   ├── host/
│   │   └── page.tsx             # Vista Host (Pantalla completa / proyector SCADA)
│   └── play/
│       └── [teamId]/
│           └── page.tsx         # Vista Player (Móvil individual por equipo)
├── components/
│   ├── CrisisOverlay.tsx        # Banner y estado de alerta de crisis en red
│   ├── DemoNav.tsx              # Selector flotante de revisión y cambio de fases
│   ├── GameHeader.tsx           # Header persistente con timer y estado SCADA
│   ├── NeighborhoodStage.tsx    # Bloque aislado del vecindario 3D (target para Three.js)
│   ├── RankingIndicator.tsx     # Indicador reutilizable de tendencia (trending up/flat/down)
│   └── TeamCard.tsx             # Tarjeta de telemetría reutilizable (default, crisis, podium)
├── mock/
│   └── gameState.ts             # Equipos de ejemplo (Alfa, Gamma, Delta, Beta, etc.) y escenarios
├── public/
│   └── images/
│       └── neighborhood.png     # Render isométrico low-poly del vecindario
├── types/
│   └── game.ts                  # Interfaces exactas: TeamState y GameState
├── tailwind.config.ts           # Paleta oficial (accent-electricidad, gas, eficiencia, etc.)
└── tsconfig.json
```

---

## 🎮 Rutas y Vistas

### 1. Vista Host (`/host`)
Diseñada para pantalla grande o proyector en sala de control. Contiene 4 fases navegables:
- **Lobby**: Registro y verificación de enlace de terminales remotas (quórum 4/4).
- **En Juego**: Escena isométrica del vecindario con pines espaciales flotantes en tiempo real + fila de tarjetas de telemetría por equipo.
- **Crisis**: Protocolo de emergencia por sobrecalentamiento de subestación, ambiente de alerta roja y cálculo de penalización sobre gasto.
- **Resultados**: Podio en 3 columnas (#1 Alfa, #2 Gamma, #3 Delta), resumen de sobreconsumo (#4 Beta) y síntesis pedagógica verbatim sobre hábitos sostenibles.

### 2. Vista Player (`/play/[teamId]`)
Diseñada para dispositivos móviles táctiles (uno por equipo, e.g. `/play/alfa`, `/play/beta`):
- **Investigar**: Grid de artefactos (aire acondicionado, nevera, estación de cómputo, iluminación, calentador, estufa) para inspeccionar potencias nominales y consumo pasivo.
- **Decidir**: Escenario táctico ante ola de calor (36°C) con 3 opciones apiladas de altura mínima 48px.
- **Crisis**: Alerta de red a pantalla completa con medidas de contingencia inmediata.
- **Resultados**: Comparativa de desempeño y ahorro del equipo contra el promedio del aula.

### 3. Portal Principal (`/`)
Tablero de acceso rápido para lanzar la vista Host o entrar a la terminal de cualquiera de los equipos.

---

## 🛠️ Instalación y Ejecución Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# Compilar para producción
npm run build
```

Abre [http://localhost:3000](http://localhost:3000) en el navegador.

---

## 🔍 Panel de Demostración
En la esquina inferior derecha de la pantalla encontrarás el botón flotante **DEMO NAVEGACIÓN**. Permite alternar instantáneamente entre todas las fases de Host y saltar entre los equipos de la vista Player sin necesidad de recargar.
