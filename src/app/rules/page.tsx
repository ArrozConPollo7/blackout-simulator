import React from "react";
import { Header } from "@/components/Header";
import { CrtContainer } from "@/components/CrtContainer";
import {
  CRISIS_PRESETS,
  INCIDENT_POOL,
  incidentTags,
  INITIAL_BUDGET,
  INITIAL_WELFARE,
  MAX_BLACKOUTS,
  MAX_WELFARE,
  SECTOR_SPECS,
  SECTOR_ORDER,
  TOTAL_ROUNDS,
  ANNOUNCE_SECONDS,
  NEGOTIATION_SECONDS,
} from "@/lib/types";

export const metadata = {
  title: "Reglas // BLACKOUT: Grid Collapse",
};

function money(value: number): string {
  return `${value > 0 ? "+" : ""}$${value.toLocaleString("es-CO")}`;
}

export default function RulesPage() {
  const spec = SECTOR_SPECS;

  return (
    <CrtContainer className="pb-24">
      <Header title="Reglas del Colapso" subtitle="MANUAL DE OPERACIÓN" role="team" />

      <main className="max-w-4xl mx-auto p-3 sm:p-6 flex flex-col gap-5">
        <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 sm:p-6 flex flex-col gap-3">
          <h2 className="font-headline text-xl font-bold text-primary uppercase phosphor-glow-green">
            Cómo se juega
          </h2>
          <p className="font-data text-xs text-on-surface-variant leading-relaxed">
            Cada mesa es un distrito con {INITIAL_WELFARE} puntos de Bienestar (máximo {MAX_WELFARE}) y{" "}
            {INITIAL_BUDGET.toLocaleString("es-CO")} dólares de tesorería. La red regional tiene un techo de
            potencia eléctrica y de gas. Durante {NEGOTIATION_SECONDS} segundos por ronda ustedes negocian{" "}
            <strong className="text-on-surface">en voz alta, cara a cara</strong>: no hay chat en la aplicación.
            Si al expirar el cronómetro la demanda agregada de megavatios <em>o</em> de gas supera el techo, hay{" "}
            <span className="text-error font-bold">BLACKOUT</span> y pierden todos.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-data text-[11px]">
            <div className="bg-surface-container p-2.5 rounded border border-surface-container-high">
              <span className="text-outline uppercase text-[10px] block">Anuncio de crisis</span>
              <span className="text-secondary font-bold">{ANNOUNCE_SECONDS} s</span>
            </div>
            <div className="bg-surface-container p-2.5 rounded border border-surface-container-high">
              <span className="text-outline uppercase text-[10px] block">Negociación</span>
              <span className="text-secondary font-bold">{NEGOTIATION_SECONDS} s</span>
            </div>
            <div className="bg-surface-container p-2.5 rounded border border-surface-container-high">
              <span className="text-outline uppercase text-[10px] block">Rondas</span>
              <span className="text-secondary font-bold">{TOTAL_ROUNDS}</span>
            </div>
          </div>
          <p className="font-data text-[11px] text-outline">
            // Cada ronda arranca con las tres palancas de todos los distritos rearmadas al 100%: la decisión se
            toma de nuevo, ronda a ronda.
          </p>
          <p className="font-data text-[11px] text-on-surface-variant">
            // La ronda se prepara <strong className="text-on-surface">sin reloj</strong>: verán la crisis y los
            incidentes en pantalla y podrán mover sus palancas todo lo que necesiten. Cuando el salón esté listo, el
            anfitrión abre el cronómetro ({ANNOUNCE_SECONDS} s de anuncio + {NEGOTIATION_SECONDS} s de negociación) y
            también puede <strong className="text-on-surface">pausarlo</strong> o sumar 30 s si la discusión sigue viva.
          </p>
          <p className="font-data text-[11px] text-on-surface-variant">
            // Sobre esta crisis se sortean incidentes aleatorios (ver la sección siguiente): dos partidas de 4
            rondas casi nunca se juegan igual.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 sm:p-6 flex flex-col gap-3">
          <h2 className="font-headline text-xl font-bold text-primary uppercase phosphor-glow-green">
            Sectores: demanda y consecuencias
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full font-data text-[11px] border-collapse">
              <thead>
                <tr className="text-outline uppercase text-[10px]">
                  <th className="text-left p-2 border-b border-surface-container-high">Sector</th>
                  <th className="text-right p-2 border-b border-surface-container-high">MW</th>
                  <th className="text-right p-2 border-b border-surface-container-high">Gas m3</th>
                  <th className="text-right p-2 border-b border-surface-container-high">Encendido</th>
                  <th className="text-right p-2 border-b border-surface-container-high">Apagado</th>
                  <th className="text-right p-2 border-b border-surface-container-high">Castigo civil</th>
                </tr>
              </thead>
              <tbody>
                {SECTOR_ORDER.map((key) => (
                  <tr key={key} className="text-on-surface">
                    <td className="p-2 border-b border-surface-container-high/60">
                      <span className="text-primary-fixed font-bold">{spec[key].label}</span>
                    </td>
                    <td className="p-2 text-right border-b border-surface-container-high/60">{spec[key].demandMW}</td>
                    <td className="p-2 text-right border-b border-surface-container-high/60">{spec[key].demandGas}</td>
                    <td className="p-2 text-right border-b border-surface-container-high/60 text-secondary">
                      {money(spec[key].revenueOn)}
                      {spec[key].gridFee !== 0 ? ` ${money(spec[key].gridFee)}` : ""}
                    </td>
                    <td className="p-2 text-right border-b border-surface-container-high/60 text-error">
                      {spec[key].revenueOff !== 0 ? money(spec[key].revenueOff) : "—"}
                    </td>
                    <td className="p-2 text-right border-b border-surface-container-high/60 text-error">
                      {spec[key].welfareOff !== 0 ? `${spec[key].welfareOff} HP` : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="text-on-surface font-bold">
                  <td className="p-2">TOTAL POR DISTRITO</td>
                  <td className="p-2 text-right">360</td>
                  <td className="p-2 text-right">750</td>
                  <td className="p-2 text-right text-secondary">+$2.200 netos</td>
                  <td className="p-2 text-right text-error">—</td>
                  <td className="p-2 text-right">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="font-data text-[11px] text-on-surface-variant">
            La tesorería no baja de cero y el Bienestar nunca sale del rango 0 a {MAX_WELFARE}.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 sm:p-6 flex flex-col gap-3">
          <h2 className="font-headline text-xl font-bold text-primary uppercase phosphor-glow-green">
            Resolución de la ronda
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-primary/5 border border-primary/40 rounded-lg p-3 font-data text-[11px] flex flex-col gap-1">
              <span className="text-primary font-bold uppercase text-xs">Red estable</span>
              <span className="text-on-surface">+100 Bienestar a todos los distritos.</span>
              <span className="text-on-surface">Industria encendida: +$3.000. Apagada: -$1.000.</span>
              <span className="text-on-surface">Mantenimiento de red residencial: -$500 // críticos: -$300.</span>
              <span className="text-on-surface">Sector residencial apagado: -150 Bienestar // críticos: -450.</span>
            </div>
            <div className="bg-error/5 border border-error/50 rounded-lg p-3 font-data text-[11px] flex flex-col gap-1">
              <span className="text-error font-bold uppercase text-xs">Blackout colectivo</span>
              <span className="text-on-surface">-300 Bienestar para todos los distritos.</span>
              <span className="text-on-surface">Los ingresos industriales se anulan ($0).</span>
              <span className="text-on-surface">
                Los costos fijos de red (-$500 y -$300) se cobran igual.
              </span>
              <span className="text-on-surface">
                Se suman las penalizaciones individuales de la mesa que tenía sectores civiles apagados.
              </span>
            </div>
          </div>
        </section>

        <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 sm:p-6 flex flex-col gap-3">
          <h2 className="font-headline text-xl font-bold text-primary uppercase phosphor-glow-green">
            Incidentes aleatorios
          </h2>
          <p className="font-data text-xs text-on-surface-variant leading-relaxed">
            Cada partida sortea <strong className="text-on-surface">incidentes</strong> sobre la crisis de la ronda:
            sucesos que recortan el techo, suben el consumo, mueven dinero y bienestar, bloquean palancas o dan algo
            de aire. La ronda 1 (tutorial) no lleva incidentes; la 2 y la 3 llevan uno; el final lleva dos, de
            familias distintas. Un incidente <strong className="text-on-surface">nunca se repite</strong> en la misma
            partida, y el sorteo depende de una semilla que el proyector muestra: dos salas con el mismo número juegan
            exactamente el mismo guion.
          </p>
          <div className="flex flex-col gap-2">
            {INCIDENT_POOL.map((incident) => (
              <div
                key={incident.id}
                className="bg-surface-container p-3 rounded-lg border border-surface-container-high font-data text-[11px] flex flex-col gap-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-warning-amber font-bold uppercase">
                    {incident.name}
                  </span>
                  <span className="text-outline text-[10px] uppercase">
                    {incident.tagline} // SEV {incident.severity} // DESDE LA RONDA {incident.minRound}
                  </span>
                </div>
                <p className="text-on-surface-variant">{incident.description}</p>
                <div className="flex flex-wrap gap-2 text-[10px] text-warning-amber">
                  {incidentTags(incident).map((tag) => (
                    <span key={tag} className="border border-warning-amber/40 rounded px-1.5 py-0.5 uppercase">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="font-data text-[11px] text-outline">
            // Un incidente de bloqueo solo puede congelar los SERVICIOS CRÍTICOS: industria y zona residencial
            siguen siendo negociables, así que la ronda siempre tiene salida.
          </p>
        </section>

        <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 sm:p-6 flex flex-col gap-3">
          <h2 className="font-headline text-xl font-bold text-primary uppercase phosphor-glow-green">
            Pool de crisis
          </h2>
          <div className="flex flex-col gap-2">
            {CRISIS_PRESETS.map((crisis) => (
              <div
                key={crisis.id}
                className="bg-surface-container p-3 rounded-lg border border-surface-container-high font-data text-[11px] flex flex-col gap-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-error font-bold uppercase">
                    Ronda {crisis.round}: {crisis.name}
                  </span>
                  <span className="text-outline text-[10px] uppercase">{crisis.tagline}</span>
                </div>
                <p className="text-on-surface-variant">{crisis.description}</p>
                <div className="flex flex-wrap gap-3 text-[10px]">
                  <span className={crisis.electricMultiplier < 1 ? "text-error" : "text-primary"}>
                    ELÉCTRICA {crisis.electricMultiplier < 1 ? `-${Math.round((1 - crisis.electricMultiplier) * 100)}%` : "100%"}
                  </span>
                  <span className={crisis.gasMultiplier < 1 ? "text-error" : "text-primary"}>
                    GAS {crisis.gasMultiplier < 1 ? `-${Math.round((1 - crisis.gasMultiplier) * 100)}%` : "100%"}
                  </span>
                  <span className={crisis.residentialDemandMultiplier > 1 ? "text-error" : "text-primary"}>
                    DEMANDA CIVIL {crisis.residentialDemandMultiplier > 1 ? `x${crisis.residentialDemandMultiplier}` : "NORMAL"}
                  </span>
                </div>
                <span className="text-on-surface-variant italic">// {crisis.objective}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl p-4 sm:p-6 flex flex-col gap-3">
          <h2 className="font-headline text-xl font-bold text-primary uppercase phosphor-glow-green">
            Cómo termina la partida
          </h2>
          <div className="font-data text-[11px] flex flex-col gap-2">
            <div className="bg-error/10 border border-error/50 rounded-lg p-3">
              <span className="text-error font-bold uppercase block">Derrota general</span>
              <span className="text-on-surface">
                Si ocurren {MAX_BLACKOUTS} apagones, la red colapsa de forma permanente:{" "}
                <span className="text-error font-bold">FALLO REGIONAL IRREVERSIBLE — NO HAY GANADORES</span>.
              </span>
            </div>
            <div className="bg-surface-container p-3 rounded-lg border border-surface-container-high flex flex-col gap-1">
              <span className="text-primary font-bold uppercase">Puntaje de Eficiencia Final</span>
              <span className="text-on-surface font-mono">PEF = Bienestar final + (Tesorería final / 100)</span>
              <span className="text-on-surface-variant">
                Primer puesto: <strong className="text-secondary">Operador de Red Ejemplar</strong>.
              </span>
              <span className="text-on-surface-variant">
                <strong className="text-tertiary-fixed">Distrito Mártir</strong>: el que más Bienestar sacrificó
                apagando sectores para salvar el salón.
              </span>
              <span className="text-on-surface-variant">
                <strong className="text-error">Distrito Parásito</strong>: el que mantuvo su industria encendida
                todas las rondas a costa de los cortes de los demás.
              </span>
            </div>
          </div>
        </section>
      </main>
    </CrtContainer>
  );
}