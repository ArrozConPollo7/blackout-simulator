# BLACKOUT: GRID COLLAPSE — MANUAL DE OPERACIÓN

**Versión 5.1** · simulador multijugador asimétrico de gestión de crisis eléctrica para un salón de clase.
Este manual explica **cómo funciona el juego, sus reglas exactas y cómo se opera en el aula**. La misma
información, en versión corta y para los estudiantes, está dentro de la aplicación en `/rules`.

Origen de las reglas: la nota de Obsidian *Juego - NFI* (crisis, sectores, castigos y criterios de victoria),
implementada en `src/shared/rules.js`, que es la **única fuente de verdad** del motor.

---

## Índice

1. [El juego en 60 segundos](#1-el-juego-en-60-segundos)
2. [Roles, pantallas y montaje](#2-roles-pantallas-y-montaje)
3. [Recursos, sectores y demanda](#3-recursos-sectores-y-demanda)
4. [La red regional: capacidad y déficit](#4-la-red-regional-capacidad-y-déficit)
5. [Ciclo de una ronda, paso a paso](#5-ciclo-de-una-ronda-paso-a-paso)
6. [Resolución: red estable o BLACKOUT](#6-resolución-red-estable-o-blackout)
7. [Las cuatro crisis oficiales](#7-las-cuatro-crisis-oficiales)
8. [Incidentes aleatorios (la variación de cada partida)](#8-incidentes-aleatorios-la-variación-de-cada-partida)
9. [Palancas bloqueadas](#9-palancas-bloqueadas)
10. [Fin de la partida y puntuación](#10-fin-de-la-partida-y-puntuación)
11. [Partida de referencia con números reales](#11-partida-de-referencia-con-números-reales)
12. [Protocolo técnico y configuración](#12-protocolo-técnico-y-configuración)
13. [Puesta en marcha (LAN y Cloudflare)](#13-puesta-en-marcha-lan-y-cloudflare)
14. [Verificación: qué está probado y cómo repetirlo](#14-verificación-qué-está-probado-y-cómo-repetirlo)
15. [Guion de clase (checklist)](#15-guion-de-clase-checklist)
16. [Problemas conocidos y plan B](#16-problemas-conocidos-y-plan-b)

---

## 1. El juego en 60 segundos

La ciudad se queda sin generación suficiente. Cada mesa del salón controla un **distrito** con tres cargas
(industria, zona residencial y servicios críticos). La red regional tiene un **techo de megavatios y de gas**
que se recorta en cada ronda. Durante 60 segundos los distritos **negocian a voz en grito** —la aplicación no
tiene chat, a propósito— decidiendo quién apaga qué. Al expirar el cronómetro el servidor compara la demanda
agregada con el techo:

- **Cabe** → red estable: todos ganan 100 pts de Bienestar y cada distrito cobra o paga según lo que dejó encendido.
- **No cabe** → **BLACKOUT** colectivo: −300 pts de Bienestar para todos, los ingresos industriales se anulan y
  se cobran igual los costos fijos de red.

Dos blackouts acumulados y la partida termina en **fallo regional irreversible, sin ganadores**. Si la red
sobrevive las cuatro rondas, gana el distrito con mejor **PEF = Bienestar final + (Tesorería final / 100)**.

El dilema central: mantener la industria encendida paga **+$3.000 por ronda** (y sube el PEF) pero consume
**150 MW y 320 m³** de los 360 MW y 750 m³ del distrito. Apagarla cuesta **$1.000** y **−60 pts de Bienestar**
(paro local y pérdida de actividad). La zona residencial y los servicios críticos casi no dan dinero, pero
apagarlos cuesta **−150** y **−450 pts de Bienestar**.

Desde el rebalanceo **5.2** el juego castiga al que se aprovecha: en un blackout el golpe base baja a **−150
para todos**, pero el distrito que **sostuvo la industria encendida** mientras la red se caía carga **−250 más
y una multa de $1.500**; y el bono de **+100** por red estable es solo para quien **cedió al menos un sector**
(el que se quedó al 100% cobra **+10 de cortesía**). Parasitar sigue pagando en caja, pero ya no es gratis ni
en Bienestar ni en el marcador.

---

## 2. Roles, pantallas y montaje

| Rol | Pantalla | URL | Qué hace |
|---|---|---|---|
| **Anfitrión / proyector** | Monitor del salón | `/host` | Abre la sala (clave maestra), reserva el panel de distritos, arranca rondas, fuerza resoluciones y opera distritos sin teléfono |
| **Mesa / distrito** | Celular de cada mesa | `/` (o `/team`) | Enciende y apaga los tres sectores de su distrito; lee el tablero espejo |
| **Vista de red** | Pantalla secundaria | `/grid` | Topología, osciloscopio y reserva girante (apoyo visual opcional) |
| **Manual** | Cualquiera | `/rules` | Reglas resumidas, tabla de sectores, pool de crisis e incidentes |
| **Calibración CRT** | — | `/crt` | Ajustes visuales del efecto retro (scanlines, curvatura, fósforo) |

- **Mesas por partida:** 3 a 6 distritos (4 recomendado). Cada distrito puede existir sin teléfono: sigue
  consumiendo y el anfitrión lo opera a mano desde el proyector. **Una mesa sin teléfono no deja de consumir.**
- **Coordinación:** verbal y presencial. La aplicación muestra el mismo tablero en todas las pantallas para que la
  discusión sea sobre números compartidos.
- **PIN de sala:** por defecto `VOLT`; cada PIN es una sala aislada (en Cloudflare, un Durable Object propio), así
  que varias clases pueden jugar a la vez sin verse.
- **Clave maestra:** por defecto `1984`, configurable por `HOST_PASSCODE`. Se valida en el servidor: sin clave,
  el proyector no recibe estado ni puede mandar órdenes. **En internet no uses la de por defecto.**

---

## 3. Recursos, sectores y demanda

Cada distrito arranca igual: **1.000 pts de Bienestar** (rango 0–1.200) y **$10.000 de tesorería** (nunca
por debajo de 0). Las tres cargas y su aritmética exacta:

| Sector | Demanda eléctrica | Demanda de gas | Encendido (por ronda) | Apagado (por ronda) | Si se apaga (Bienestar) |
|---|---|---|---|---|---|
| **Zona industrial** (`industry`) | 150 MW | 320 m³ | **+$3.000** de ingresos | **−$1.000** de paro técnico | **−60 pts** (paro y pérdida de empleo) |
| **Zona residencial** (`residential`) | 130 MW | 280 m³ | −$500 de mantenimiento de red | −$500 de mantenimiento de red | **−150 pts** |
| **Servicios críticos** (`critical`) | 80 MW | 150 m³ | −$300 de mantenimiento de red | −$300 de mantenimiento de red | **−450 pts** |
| **Total por distrito** | **360 MW** | **750 m³** | **+$2.200 netos** | — | — |

Notas de implementación que el salón nota:

- Los "gastos fijos de red" de residencial y críticos **se cobran siempre**, estén encendidos o apagados.
- El Bienestar se recorta solo cuando la ronda se resuelve con el sector apagado — incluida la industria, que
  desde el rebalanceo 5.2 paga **−60** por el paro local; la penalización se acumula en la métrica interna
  `welfareSacrificed`, que es la que decide el título de **Distrito Mártir**.
- Los sectores se **rearman al 100% al inicio de cada ronda**: la decisión se toma de nuevo, ronda a ronda, y por
  eso las traiciones de última ronda se repiten.

---

## 4. La red regional: capacidad y déficit

La capacidad de la ronda se calcula así:

```
capacidad_MW  = 360 MW × nº_distritos × multiplicador_eléctrico(crisis) × ∏ multiplicadores_eléctricos(incidentes)
capacidad_gas = 750 m³ × nº_distritos × multiplicador_gas(crisis)      × ∏ multiplicadores_gas(incidentes)
```

La base (360 MW / 750 m³ por distrito) es **exactamente igual a la demanda base** del panel: la red arranca
**sin margen**, así que cualquier crisis obliga a ceder carga. La demanda del panel es la suma de los distritos
presentes, con los sectores encendidos en ese instante y los multiplicadores de demanda vigentes (crisis e
incidentes). El redondeo es **por distrito**, así que el proyector y los mandos siempre enseñan enteros.

Ejemplo con 4 distritos y todo encendido:

| Ronda | Crisis | Multiplicadores | Techo | Demanda si nadie cede |
|---|---|---|---|---|
| 1 | Mantenimiento de gasoducto | eléctrico ×1,00 · gas ×0,80 | 1.440 MW / 2.400 m³ | 1.440 MW / **3.000 m³** ⚠ |
| 2 | Sequía hidrológica | eléctrico ×0,65 · gas ×1,00 | **936 MW** / 3.000 m³ | 1.440 MW / 3.000 m³ ⚠ |
| 3 | Onda polar | demanda civil ×2 | 1.440 MW / 3.000 m³ | **1.920 MW / 4.000 m³** ⚠ |
| 4 | Colapso de subestaciones | eléctrico ×0,50 · gas ×0,50 | **720 MW / 1.500 m³** | 1.440 MW / 3.000 m³ ⚠ |

⚠ = **no hacer nada es un blackout garantizado**. El sistema muestra en vivo, en el proyector, la demanda
agregada contra el techo y marca en rojo el déficit (MW, gas o ambos).

---

## 5. Ciclo de una ronda, paso a paso

Cada una de las 4 rondas sigue esta secuencia, gobernada por el servidor (reloj autoritativo). **El ritmo lo
marca el anfitrión, no el cronómetro**: entre rondas la sala se queda esperando y el reloj solo corre cuando él
lo abre.

1. **Planificación (sin reloj).** Al abrir una ronda nueva se sortean crisis e incidentes, la capacidad aparece ya
   recortada y las palancas se rearman al 100%… pero **el tiempo no corre**. El salón ve el problema en pantalla
   y discute cuánto y quién cede; las mesas pueden dejar sus palancas premarcadas y el anfitrión ve el efecto en
   los medidores. Es el momento de "¿quién apaga la industria?" sin agobios.
2. **Anuncio de crisis (10 s, `ANNOUNCE_SECONDS`).** El anfitrión pulsa `ABRIR CRONÓMETRO` (o salta directo a la
   negociación) y arranca la cuenta atrás. Los medidores entran en zona de peligro.
3. **Negociación en vivo (60 s, `NEGOTIATION_SECONDS`).** El cronómetro corre en todas las pantallas. Cada palanca
   cambia al instante los medidores del proyector y se puede cambiar de decisión hasta el último segundo.
4. **Resolución automática (t = 0).** Al expirar el cronómetro el servidor evalúa la red **una sola vez** y publica
   el parte: estable o blackout, con el detalle económico y de bienestar distrito por distrito.
5. **Siguiente ronda, cuando el anfitrión quiera.** El botón `SIGUIENTE RONDA` abre la planificación de la ronda
   siguiente (otra vez sin reloj). Tras la ronda 4 se publica la clasificación final.

Controles del anfitrión durante la partida:

| Control | Cuándo | Qué hace |
|---|---|---|
| `ABRIR CRONÓMETRO` | Planificación | Arranca anuncio + negociación de la ronda preparada |
| `SALTAR AL ANUNCIO Y NEGOCIAR YA` | Planificación o anuncio | Salta el anuncio y va directo a la negociación |
| `PAUSAR RELOJ` / `REANUDAR RELOJ` | Anuncio o negociación | Congela el tiempo (sigue donde estaba) y lo reanuda: la forma limpia de alargar una discusión buena |
| `+30 s` | Anuncio o negociación | Suma 30 segundos a la fase (acumulable) |
| `FORZAR RESOLUCIÓN` | Negociación | Cierra la ronda antes de tiempo si ya hay acuerdo |
| `SIGUIENTE RONDA` | Resolución | Prepara la ronda siguiente (planificación sin reloj) |
| `REINICIAR PARTIDA` | **Cualquier fase de partida** | Vuelve al vestíbulo, borra el marcador y expulsa las sesiones de las mesas (pide confirmación) |
| `NUEVA SIMULACIÓN` | Fin de partida | Lo mismo, al terminar la partida |
| `BLOQUEAR` | Cualquier fase | Cierra la sesión de anfitrión: el proyector vuelve a pedir la clave maestra |

Esta fila de control queda **fija bajo el encabezado** mientras se desplaza el tablero: para avanzar de ronda no
hay que buscar el botón.

El reloj **no late**: el estado publica la fecha límite (`deadlineTs`) y cada cliente dibuja su cuenta atrás; el
servidor se despierta una sola vez, en esa fecha. Menos tráfico y un Durable Object que puede hibernar.

---

## 6. Resolución: red estable o BLACKOUT

Al resolver, el servidor compara **dos condiciones simultáneas**:

```
Σ demanda eléctrica ≤ capacidad eléctrica     Y     Σ demanda de gas ≤ capacidad de gas
```

Basta que **una** de las dos se pase para que haya blackout.

### Escenario A — RED ESTABLE

| Concepto | Quién |
|---|---|
| Bienestar | **+100 pts** a cada distrito que **cedió al menos un sector** |
| Bienestar | **+10 pts** de cortesía al que dejó **todo al 100%** (free-rider) |
| Industria **encendida** | **+$3.000** de ingresos |
| Industria **apagada** | **−$1.000** de paro técnico y **−60 pts** de Bienestar |
| Mantenimiento de red residencial | **−$500** (se cobra siempre) |
| Mantenimiento de red crítica | **−$300** (se cobra siempre) |
| Zona residencial **apagada** | **−150 pts** de Bienestar |
| Servicios críticos **apagados** | **−450 pts** de Bienestar |

### Escenario B — BLACKOUT (fallo colectivo)

| Concepto | Quién |
|---|---|
| Bienestar | **−150 pts** por apagón masivo (golpe base para todos) |
| **Malus por sobreconsumo** | **−250 pts** y **−$1.500 de multa** al distrito que mantuvo la **industria encendida** en pleno colapso |
| **Carga civil sostenida** | **−50 pts** extra al distrito que mantuvo **activo el sector residencial** durante el colapso |
| Ingresos industriales | **se anulan ($0)**: no hubo suministro para operar |
| Industria apagada antes del fallo | **−$1.000** (paro técnico) y **−60 pts** de Bienestar |
| Costos fijos de red | **se cobran igual**: −$500 y −$300 |
| Sectores civiles apagados | se suman sus penalizaciones individuales (−150 / −450) |
| Contador global | **+1 apagón** |

Ejemplos de una ronda completa, distrito tipo, con industria apagada y sectores civiles encendidos:

- Estable con la industria apagada → Bienestar 1.000 → **1.040** (+100 −60); Tesorería 10.000 → **8.200** (−1.800).
- Blackout sin ceder nada → Bienestar 1.000 → **550** (−150 −250 −50); Tesorería 10.000 → **7.700** (−2.300).

Las dos cuentas importan: **el parasito paga la multa** (−$1.500) y pierde más Bienestar que cualquier mesa que
haya cedido carga (−450 contra −260 de quien apagó solo la industria o −360 de quien apagó industria y
residencial). El apagón sigue siendo letal y, con dos, termina la partida para todos.

---

## 7. Las cuatro crisis oficiales

Cada ronda tiene su crisis fija; sobre ella se sortean los incidentes (sección 8).

| # | Crisis | Contexto | Efecto exacto | Conflicto que provoca |
|---|---|---|---|---|
| 1 | **MANTENIMIENTO DE GASODUCTO TRONCAL** (tutorial) | Fuga de presión en la válvula regional | Gas ×0,80 · eléctrico ×1,00 | Bastan 2 de 4 industrias apagadas (con 1 sola, el gas se pasa): enseña la mecánica sin castigar |
| 2 | **SEQUÍA HIDROLÓGICA EXTREMA** | Embalses en niveles críticos | Eléctrico ×0,65 · gas ×1,00 | Déficit severo de MW: hay que apagar **todas** las industrias o combinarlo con cortes civiles |
| 3 | **ONDA POLAR Y CONGELAMIENTO** | Pico de calefacción y agua caliente | Demanda residencial ×2 (+130 MW y +280 m³ por distrito) | El consumo civil se come el margen: hay que apagar toda la industria y decidir qué áreas civiles caen |
| 4 | **COLAPSO EN CADENA DE SUBESTACIONES** | Fallo sincronizado de alta tensión y baja presión | Eléctrico ×0,50 · gas ×0,50 | Dilema extremo: **toda** la industria fuera **y al menos un distrito** cediendo el residencial (con 10 MW de margen) |

---

## 8. Incidentes aleatorios (la variación de cada partida)

Sobre la crisis de la ronda se **sortea un número fijo de incidentes**, para que dos partidas no se jueguen igual.
Los incidentes están agrupados en cinco familias y se muestran en el proyector y en cada mando con sus etiquetas
de efecto (por ejemplo: `ELÉCTRICA −10%`, `DEMANDA CIVIL x1,15`, `−$400 A TODOS`, `SERVICIOS CRÍTICOS BLOQUEADA`).

### Reglas del sorteo

| Ronda | Incidentes | Severidad máxima | Familias |
|---|---|---|---|
| 1 (tutorial) | **0** | — | — |
| 2 | **1** | 2 | cualquiera permitida desde la ronda 2 |
| 3 | **1** | 3 | cualquiera |
| 4 (final) | **2** | 3 | **distintas** entre sí |

- Un incidente **nunca se repite** dentro de la misma partida (se juegan 4 incidentes distintos, salvo que la
  partida muera antes).
- El sorteo depende de una **semilla** que el proyector muestra en hexadecimal. Dos salas con la misma semilla
  juegan exactamente el mismo guion: sirve para repetir una partida o analizarla.
- Se puede fijar la semilla con `GAME_SEED` y **apagar** la mecánica con `INCIDENTS=off` (respaldo: vuelve a la
  aritmética pura del documento, útil si algo se descuadra en clase).

### Invariantes de balance (verificados por pruebas)

1. **Nunca se puede ganar sin tocar nada:** con cualquier crisis y cualquier combinación de incidentes, la demanda
   base supera el techo.
2. **La ronda siempre tiene salida:** existe al menos un reparto de cortes que salva la red, en cualquier ronda y
   con cualquier combinación de incidentes (por eso los incidentes de bloqueo solo pueden congelar los críticos).
3. **Ninguna palanca resuelve la crisis sola (rebalanceo 5.2):** en las rondas 2, 3 y 4, un distrito que mueva sus
   tres palancas mientras el resto del panel se queda al 100% colapsa en **las 8 combinaciones posibles**.
4. **El free-rider no sale gratis:** en un apagón, quien mantuvo la industria encendida pierde **-250 de Bienestar
   y $1.500** más que cualquier mesa que haya cedido carga; y si la red se salva, quien no cortó nada cobra **+10**
   en vez del bono de **+100**.
5. La prueba `ningún sorteo hace la ronda irresoluble ni perdona al que no toca nada` recorre 400+ combinaciones
   (rondas 2–4, paneles de 3 a 6 distritos, todos los pares de incidentes de familias distintas), y
   `combinaciones a ciegas` recorre las 8 combinaciones de switches por ronda. Con la estrategia coordinada,
   `--scan 300` sobrevive **300 de 300 semillas**.

### Catálogo completo (19 incidentes)

**Familia `capacity` — recortan el techo**

| Incidente | Sev. | Desde | Efecto |
|---|---|---|---|
| Fuga en la línea de distribución | 2 | r2 | Gas −10% |
| Torre de enfriamiento al 70% | 2 | r2 | Eléctrica −10% |
| Robo de cable en el anillo sur | 2 | r2 | Eléctrica −8% · −$200 a todos |
| Turbina 3 fuera de servicio | 3 | r3 | Eléctrica −15% |
| Compresor troncal en parada | 3 | r3 | Gas −15% |

**Familia `demand` — suben el consumo**

| Incidente | Sev. | Desde | Efecto |
|---|---|---|---|
| Oleada de calor extrema | 2 | r2 | Demanda residencial ×1,15 |
| Turno industrial doble por exportación | 2 | r2 | Demanda industrial ×1,20 · +$600 si la industria aguanta |
| Traslado masivo al hospital central | 2 | r2 | Demanda crítica ×1,25 |
| Cadena de frío en alerta sanitaria | 3 | r3 | Demanda residencial ×1,10 · crítica ×1,10 |

**Familia `economy` — dinero y bienestar**

| Incidente | Sev. | Desde | Efecto |
|---|---|---|---|
| Subsidio de emergencia del estado | 1 | r2 | +$800 a todos |
| Plan de empleo de emergencia | 1 | r2 | +$300 y −40 de Bienestar a todos |
| Huelga en la planta de bombeo | 2 | r2 | −$400 a todos · −$400 extra si hay apagón |
| Saqueo en los barrios del este | 2 | r2 | −80 de Bienestar a todos · −120 extra si hay apagón |
| Auditoría del regulador | 3 | r3 | −$600 a todos · +$900 extra si la red aguanta |

**Familia `lock` — blindan una palanca**

| Incidente | Sev. | Desde | Efecto |
|---|---|---|---|
| Cuarentena en las salas de trauma | 2 | r2 | Servicios críticos bloqueados |
| Oxígeno crítico en cuidados intensivos | 3 | r3 | Servicios críticos bloqueados · −$300 a todos |

**Familia `boost` — dan aire**

| Incidente | Sev. | Desde | Efecto |
|---|---|---|---|
| Trasvase de emergencia habilitado | 1 | r2 | Eléctrica +10% |
| Buque metanero atracado en puerto | 1 | r2 | Gas +10% |
| Mercado spot a precio de ruina | 3 | r3 | Eléctrica +10% · −$700 a todos |

Los efectos de un mismo tipo **se acumulan multiplicativamente** (capacidad y demanda) o **sumándose**
(las partidas en dinero y Bienestar). En la resolución final cada efecto aparece desglosado en el parte del
distrito, precedido de `INCIDENTE //`.

---

## 9. Palancas bloqueadas

Dos incidentes (`CUARENTENA...` y `OXÍGENO CRÍTICO...`) **bloquean los servicios críticos** durante esa ronda:

- El mando de la mesa muestra la palanca, pero **no responde**: el servidor rechaza el intento con
  `SERVICIOS CRÍTICOS BLOQUEADA POR INCIDENTE // NO SE PUEDE CORTAR ESTA RONDA`.
- El **override del anfitrión** tampoco pasa: el bloqueo es del sistema, no del mando. El corte total de
  emergencia (SCRAM) también respeta el bloqueo.
- El bloqueo desaparece al empezar la ronda siguiente.

Consecuencia pedagógica: la mesa que iba a sacrificar al hospital tiene que sacrificar **industria o barrio**, y
eso reabre la negociación en voz alta. Es el incidente más divertido para el aula.

---

## 10. Fin de la partida y puntuación

**Derrota general (fin inmediato).** Si el contador de apagones llega a **2** en cualquier momento, la red colapsa
de forma permanente y el proyector cierra con `FALLO REGIONAL IRREVERSIBLE — NO HAY GANADORES`. La lección: la
falta de coordinación y el egoísmo corporativo destruyeron la infraestructura común.

**Puntuación de Eficiencia Final (si la red sobrevive las 4 rondas).**

```
PEF = Bienestar final + (Tesorería final / 100)
```

- **Primer puesto → Operador de Red Ejemplar.**
- **Distrito Mártir:** el que más puntos de Bienestar sacrificó apagando sectores para que el salón no colapsara
  (desempate: más rondas con industria apagada).
- **Distrito Parásito:** el que más rondas mantuvo la industria encendida a costa de los cortes de los demás.

El acta final incluye además la **semilla** y la lista de **incidentes jugados**, para poder repetir o auditar la
partida.

---

## 11. Partida de referencia con números reales

Salida real del motor (`node scripts/reference-game.js --seed 4200`), jugando con una estrategia sencilla y
explicable: cada distrito apaga **el mínimo** que salva la red, empezando por la industria y sin tocar los críticos.

```
PARTIDA DE REFERENCIA // semilla 4200 // 4 distritos // 5.2
Capacidad base del panel: 1440 MW y 3000 m3 (igual a la demanda base)

=== RONDA 1 // MANTENIMIENTO DE GASODUCTO TRONCAL (TUTORIAL) ===
  incidentes: sin incidentes
  techo: 1440 MW (x1) / 2400 m3 (x0.8)
  demanda si nadie cede: 1440 MW / 3000 m3
  plan: cada distrito apaga [IND] -> 210 MW / 430 m3 por distrito
  total: 840 MW / 1720 m3 contra 1440 MW / 2400 m3
  RESOLUCIÓN: STABLE // margen 600 MW / 680 m3
  distrito tipo: Bienestar 1000 -> 1040 (+40) // Tesorería 10000 -> 8200 (-1800)

=== RONDA 2 // SEQUÍA HIDROLÓGICA EXTREMA (DÉFICIT SEVERO DE MW) ===
  incidentes: SAQUEO EN LOS BARRIOS DEL ESTE  [-80 BIENESTAR A TODOS · -120 EXTRA SI HAY APAGÓN]
  techo: 936 MW (x0.65) / 3000 m3 (x1)
  demanda si nadie cede: 1440 MW / 3000 m3
  plan: cada distrito apaga [IND] -> 210 MW / 430 m3 por distrito
  total: 840 MW / 1720 m3 contra 936 MW / 3000 m3
  RESOLUCIÓN: STABLE // margen 96 MW / 1280 m3
  distrito tipo: Bienestar 1040 -> 1000 (-40) // Tesorería 8200 -> 6400 (-1800)

=== RONDA 3 // ONDA POLAR Y CONGELAMIENTO (PICO DE DEMANDA CIVIL) ===
  incidentes: COMPRESOR TRONCAL EN PARADA  [GAS -15%]
  techo: 1440 MW (x1) / 2550 m3 (x0.85)
  demanda si nadie cede: 1960 MW / 4120 m3
  plan: cada distrito apaga [RES] -> 230 MW / 470 m3 por distrito
  RESOLUCIÓN: STABLE // margen 520 MW / 670 m3
  distrito tipo: Bienestar 1000 -> 950 (-50) // Tesorería 6400 -> 8600 (+2200)

=== RONDA 4 // COLAPSO EN CADENA DE SUBESTACIONES (FINAL) ===
  incidentes: TORRE DE ENFRIAMIENTO AL 70% [ELÉCTRICA -10%] + BUQUE METANERO ATRACADO EN PUERTO [GAS +10%]
  techo: 648 MW (x0.45) / 1650 m3 (x0.55)
  demanda si nadie cede: 1440 MW / 3000 m3
  plan: cada distrito apaga [IND, RES] -> 80 MW / 150 m3 por distrito
  RESOLUCIÓN: STABLE // margen 328 MW / 1050 m3
  distrito tipo: Bienestar 950 -> 840 (-110) // Tesorería 8600 -> 6800 (-1800)

=== CLASIFICACIÓN FINAL ===
  1. NEO-DOWNTOWN: PEF 908 (Bienestar 840 + Tesorería 6800/100) // sacrificó 480 de Bienestar // industrias encendidas 1/4
  ...
```

Lecturas para clase:

- **La ronda 2 es el primer apretón real:** con la sequía hay que apagar la industria de casi todo el panel
  (apagar 3 de 4 industrias deja la red en 990 MW sobre un techo de 936) y el margen final es de 96 MW.
- **La ronda 3 es la trampa civil:** el residencial duplicado lleva la demanda a 1.960 MW / 4.120 m³; el que
  resuelve apagando residencial en vez de industria se queda sin ingresos justo antes del final.
- **La ronda 4 obliga a un corte extremo:** apagar toda la industria aún deja 840 MW sobre un techo de 720; hace
  falta que **al menos un distrito** ceda también el residencial (710 MW, 10 de margen). El incidente
  `TORRE DE ENFRIAMIENTO` recorta el techo un 10% adicional y castiga a quien cuente con el margen del documento.
- En un panel simétrico todos los distritos terminan empatados (PEF 908): el PEF no premia "no perder", premia
  **quién aguantó la industria encendida** sin tumbar la red. Ahí está la tensión de verdad.
- Con la estrategia de referencia, **las 300 semillas se pueden sobrevivir** (`--scan 300`): si el salón falla, es
  por coordinación, no por imposibilidad. Con `--scan` también se comprueba que los 19 incidentes salen con
  frecuencia parecida.

---

## 12. Protocolo técnico y configuración

**Arquitectura: dos runtimes, un motor.**

```
src/shared/rules.js       motor de reglas (CommonJS, sin I/O): demanda, capacidad, sorteo, resolución, PEF
server.js                 servidor Node para LAN: Next.js + WebSocket autoritativo en el mismo puerto
worker/index.js           Cloudflare Worker: enruta /ws al Durable Object de la sala y sirve los estáticos
worker/room.js            Durable Object de una sala: WebSocket Hibernation, alarm() y storage
src/lib/types.ts          contrato de tipos del cliente + re-exportación de los datos del motor
src/app/…                 mando (/), proyector (/host), red (/grid), manual (/rules), CRT (/crt)
tests/…                   motor, partida end-to-end contra Node y contra el Durable Object real
scripts/reference-game.js partida de referencia sin interfaz (números del manual, barrido de semillas)
```

- **Autoridad única:** las mesas solo envían intenciones (`TOGGLE_SECTOR`, `SCRAM`); el servidor responde con el
  estado completo (`SYNC_STATE`). El proyector necesita la clave maestra para operar.
- **Mensajes cliente → servidor:** `HOST_OPEN_ROOM`, `HOST_SEED_DISTRICTS`, `HOST_REMOVE_UNCLAIMED`,
  `HOST_START_GAME`, `HOST_BEGIN_ROUND`, `HOST_PAUSE`, `HOST_RESUME`, `HOST_ADD_TIME`, `HOST_SKIP_ANNOUNCE`,
  `HOST_RESOLVE_NOW`, `HOST_NEXT_ROUND`, `HOST_RESET_GAME`, `HOST_TOGGLE_SECTOR`, `WATCH_ROOM`,
  `JOIN_DISTRICT`, `LEAVE_DISTRICT`, `TOGGLE_SECTOR`, `SCRAM`, `PING`.
- **Mensajes servidor → cliente:** `SYNC_STATE`, `JOIN_SUCCESS`, `JOIN_REJECTED`, `ROOM_NOT_FOUND`,
  `SESSION_EXPIRED`, `ERROR`, `ALERT`.
- **Endpoint de salud:** `GET /healthz` devuelve versión, salas activas, fase, ronda, apagones, **semilla,
  incidentes vigentes y palancas bloqueadas** (útil para diagnosticar en vivo).

| Variable | Por defecto | Descripción |
|---|---|---|
| `HOST_PASSCODE` | `1984` | Clave maestra del anfitrión. En internet, usa un secreto (`wrangler secret put`) |
| `ANNOUNCE_SECONDS` | `10` | Duración del anuncio de crisis |
| `NEGOTIATION_SECONDS` | `60` | Duración de la negociación |
| `EXTRA_SECONDS` | `30` | Segundos que suma el botón `+30 s` del anfitrión (constante del motor) |
| `PORT` | `3006` | Puerto del servidor Node (opción LAN) |
| `GAME_SEED` | aleatoria | Fija la semilla: repite exactamente el mismo guion de incidentes |
| `INCIDENTS` | `on` | `off` desactiva los incidentes aleatorios (aritmética pura del documento) |

---

## 13. Puesta en marcha (LAN y Cloudflare)

### Opción A — Cloudflare Workers (recomendada para clase: cualquier red, datos móviles incluidos)

Cada PIN de sala vive en su propio Durable Object: autoridad única, WebSocket nativo, sin servidores que se
duerman y con el estado persistido (sobrevive a reinicios y despliegues).

```bash
npx wrangler login                    # una vez, con tu cuenta de Cloudflare
npx wrangler secret put HOST_PASSCODE # 1º el secreto (numérico, interactivo): NO la clave por defecto
npm run worker:deploy                 # 2º compila la interfaz estática y publica Worker + Durable Objects
```

El valor se escribe en el prompt de wrangler, no en la línea de comandos (`HOST_PASSCODE=1234 npx wrangler …` no
crea el secreto) y debe ser **numérico**, porque el teclado en pantalla del proyector solo acepta dígitos.
`wrangler.jsonc` no lleva `vars.HOST_PASSCODE` a propósito: un `vars` con ese nombre sobrescribiría el secreto en
cada despliegue, y desplegar sin secreto deja al Durable Object sin clave (rechaza las órdenes del proyector), así
que **el secreto se pone antes de desplegar**. Verifícalo con `npx wrangler secret list`.

Wrangler imprime la URL (`https://blackout-grid-collapse.<subdominio>.workers.dev`). Proyector: `<url>/host/`.
Mandos: `<url>/` desde cualquier móvil. Prueba local antes de publicar con `npm run worker:dev`
(workerd en `http://127.0.0.1:8788`).

**Dominio propio.** No hay que tocar código: la interfaz se resuelve contra `window.location` (el socket pasa a
`wss://` en https) y la URL de los mandos es el origen del proyector. Con la zona del dominio en la misma cuenta
de Cloudflare, se añade un *Custom Domain* en el dashboard (Worker → *Settings* → *Domains & Routes* → *Add* →
`juego.tudominio.com`) o se declara en `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "juego.tudominio.com", "custom_domain": true }]
```

y se vuelve a desplegar (`npm run worker:deploy`). El certificado TLS es automático y el `workers.dev` sigue
funcionando en paralelo.

Si el dominio está en **Namecheap**, el Custom Domain exige la zona en Cloudflare, así que hay que mover los
nameservers (el dominio sigue en Namecheap): *Cloudflare → Add a site → plan Free* para obtener los dos
nameservers; *Domain List → Manage → Advanced DNS* → desactivar **DNSSEC** si está activo; *Domain List → Manage →
Nameservers* → **Custom DNS** → pegar los dos y guardar. Cuando la zona quede *Active*, el paso 2 de arriba ya
funciona sin tocar DNS ni certificados. Sin mover nameservers queda la vía de un **URL Redirect Record** en el DNS
de Namecheap apuntando a `https://blackout-grid-collapse.<subdominio>.workers.dev/` (301, ~30 min): sirve para la
clase, pero el navegador termina mostrando la URL `workers.dev`. Redesplegar no pierde la partida en curso: el estado vive en el Durable Object.

### Opción B — LAN sin internet (servidor Node)

```bash
npm install          # una vez
npm run build        # compilación de producción (NO uses build:static para esta opción)
npm start            # o `npm run dev` para desarrollo
# Proyector:  http://localhost:3006/host      (clave maestra 1984 o la que fijes)
# Mandos:     http://<IP-LAN>:3006            (el proyector muestra la URL para los móviles)
```

**Aviso importante de red en Windows + WSL2.** Si el juego corre *dentro* de WSL (o de un contenedor), los móviles
**no** alcanzan la IP de WSL: el distro está en modo NAT (una red privada detrás de Windows). Verificado en este
equipo: `wslinfo --networking-mode` → `nat`, IP de WSL `172.25.x.x`, IP de LAN de Windows `192.168.40.80`. Lo que
**sí** funciona (probado end-to-end) es publicar el puerto desde Docker Desktop, que escucha en `0.0.0.0` de
Windows:

```bash
cd ~/jarvis-hermes/workspace/laptop-projects/blackout-simulator
docker run -d --rm --name blackout -p 3006:3006 \
  -v "$PWD":/app -w /app --entrypoint node \
  nousresearch/hermes-agent:latest server.js
# Mandos:  http://192.168.40.80:3006  (IP de LAN de Windows; compruébala antes con ipconfig)
```

Alternativas si prefieres no usar Docker: ejecutar Node dentro de WSL (aquí está en
`~/.nvm/versions/node/v22.17.1/bin/node`) y añadir un **port proxy de Windows** hacia la IP de WSL
(`netsh interface portproxy add v4tov4 listenport=3006 listenaddress=0.0.0.0 connectport=3006 connectaddress=<IP-WSL>`
+ regla de firewall entrante), o activar el **modo de red espejo** de WSL2 (`.wslconfig` →
`networkingMode=mirrored`, requiere reiniciar WSL). En los tres casos, la prueba real es abrir la URL desde un
móvil de la misma Wi-Fi.

### Comprobación en 10 segundos

```bash
curl -s localhost:3006/healthz         # {"ok":true,"version":"5.1","rooms":[…]}
curl -s -o /dev/null -w "%{http_code}\n" http://<IP-LAN>:3006/host/   # 200
```

---

## 14. Verificación: qué está probado y cómo repetirlo

```bash
npm test              # motor + partida completa contra el servidor Node  (43 pruebas)
npm run test:engine   # solo la aritmética y el sorteo                    (31 pruebas)
npm run test:worker   # partida completa contra el Durable Object real     (9 pruebas, requiere build:static)
npm run typecheck     # tsc --noEmit
node scripts/reference-game.js --scan 300   # balance: ¿tiene salida cada semilla?
```

Estado verificado de esta versión (5.2):

| Suite | Pruebas | Qué cubre |
|---|---|---|
| `tests/engine.test.js` | **31/31 ✅** | Tabla de sectores del rebalanceo, capacidad, resolución, PEF, **anti free-rider (malus, multa y bono condicionado)**, **combinaciones a ciegas (≥6 de 8 colapsan en las rondas 2, 3 y 4)**, sorteo reproducible por semilla, no repetición, bloqueos, economía de incidentes, **irresolubilidad y "no hacer nada nunca salva la red" en 400+ combinaciones** |
| `tests/e2e.test.js` | **12/12 ✅** | Partida completa contra `server.js` con semilla fija: clave maestra, reclamo de distritos, override del anfitrión, **rechazo de palanca bloqueada (mesa y anfitrión)**, resolución automática, segundo apagón, reinicio a mitad de partida, acta final |
| `tests/worker.e2e.test.js` | **9/9 ✅** | Lo mismo contra `wrangler dev` + Durable Objects: aislamiento por PIN, clave dentro del objeto, alarmas, estado persistido |
| `npm run typecheck` | **✅** | Contrato de tipos del cliente |
| `npm run build` / `build:static` | **✅** | Compilación de producción y export estático |

Las salas de prueba van **sin incidentes por defecto** (`createRoom(pin, { incidents: false })`) para verificar la
aritmética del documento sin azar; los sorteos se prueban aparte con semillas fijas.

---

## 15. Guion de clase (checklist)

**La semana antes**

- [ ] Decidir la vía: Cloudflare (más simple en el aula) o LAN + Docker.
- [ ] Si es Cloudflare: `wrangler login`, subir `HOST_PASSCODE` como secreto y desplegar. Probar desde el móvil.
- [ ] Si es LAN: `npm run build` y dejar el comando `docker run …` probado; confirmar la IP de LAN de Windows.
- [ ] Hacer **un ensayo completo** (proyector + 2 móviles) midiendo si 10 s de anuncio y 60 s de negociación son
      suficientes para tu grupo; si no, ajustar `ANNOUNCE_SECONDS` / `NEGOTIATION_SECONDS`. Recuerda que la ronda
      se prepara **sin reloj**: el cronómetro solo empieza cuando tú lo abres.
- [ ] Decidir la semilla (`GAME_SEED`) si quieres un guion concreto, y **jugarla antes** con
      `node scripts/reference-game.js --seed N` para saber qué incidentes salen.

**Minutos antes**

- [ ] Proyector: pantalla completa en `/host`, entrar con la clave maestra y **reservar el panel** (4–6 distritos).
- [ ] Un clic en cualquier parte del proyector (los navegadores exigen un gesto para habilitar el audio).
- [ ] PIN de sala visible para todos (`VOLT` por defecto); comprobar que el proyector enseña la URL de los mandos.
- [ ] Que cada mesa entre desde su teléfono, escriba su nombre y **tome un distrito**. Los distritos que nadie tome
      se siguen consumiendo: el anfitrión los opera a mano o los retira de la malla (`RETIRAR SIN OPERADOR`).
- [ ] Anotar la **semilla** en el tablero (permite repetir la partida con la misma dificultad).

**Durante**

- [ ] Leer en voz alta la crisis y los incidentes de la ronda (el proyector los tiene en grande).
- [ ] No interrumpir la negociación: el valor pedagógico está en el grito. Si la discusión está siendo buena,
      `PAUSAR RELOJ` y sigues cuando quieras; si se descarrila, `FORZAR RESOLUCIÓN`.
- [ ] Usar `RESOLVER AHORA` si el acuerdo llegó antes de tiempo.
- [ ] Al acabar: leer el parte distrito por distrito y cerrar con las menciones (Ejemplar, Mártir, Parásito).
- [ ] Si la partida se descarrila (un grupo se atasca, alguien desconfigura su distrito, el tiempo no alcanza):
      `REINICIAR PARTIDA` en la fila de control devuelve todo al vestíbulo sin cerrar el navegador. Las mesas
      vuelven a tomar distrito en segundos.

**Después**

- [ ] Guardar la semilla y la lista de incidentes del acta final: la próxima clase puede repetir exactamente la
      misma partida y comparar decisiones.

---

## 16. Problemas conocidos y plan B

| Síntoma | Causa | Solución |
|---|---|---|
| El proyector abre pero rechaza órdenes | Clave maestra incorrecta | `HOST_PASSCODE` (por defecto `1984`); en Cloudflare, el secreto subido |
| Los móviles no cargan la página | WSL en modo NAT / firewall | Publicar el puerto desde Docker Desktop (ver sección 13) o un port proxy de Windows |
| "NO EXISTE UNA SALA CON EL PIN X" | Nadie ha abierto la sala en el proyector todavía | El anfitrión entra a `/host` primero: la sala nace ahí |
| La página se ve sin estilos | Se ejecutó `npm run build` con `npm run dev` vivo | Detén el servidor, construye y arranca otra vez |
| `next: Permission denied` al construir | Copia desde Windows: se perdió el bit de ejecución | `npm install` o `chmod +x node_modules/.bin/*` |
| Wrangler dice que falta su binario | npm 11 y `allow-scripts` | `npm approve-scripts workerd esbuild && npm rebuild workerd esbuild` |
| Una mesa se queda sin batería a mitad | — | Reconecta con el mismo distrito (la sesión se restaura) o el anfitrión opera ese distrito a mano |
| Quieres la aritmética del documento sin azar | — | `INCIDENTS=off` (Node) o `--var INCIDENTS:off` (Worker) |
| La partida sale rara y quieres auditar | — | Semilla en pantalla + `node scripts/reference-game.js --seed N` reproduce el guion |

**Plan B mínimo** si la tecnología falla en plena clase: el proyector muestra `/rules` (tabla de sectores, crisis y
castigos) y la clase juega con las cuentas en la pizarra usando exactamente los mismos números de este manual.
El juego es bueno; la aplicación solo acelera la aritmética.