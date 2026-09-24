'use client';

/**
 * Navegador de la demostración (panel flotante del cascarón).
 *
 * Ya no inventa equipos ni fases: lista la partida activa guardada por el Host en este
 * dispositivo (`lib/game-store`) y enlaza a cada vista real. Las fases se controlan
 * desde la consola del Host, no desde aquí.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { readActiveGame, type ActiveGame } from '@/lib/game-store';

export default function DemoNav() {
  const [isOpen, setIsOpen] = useState(false);
  const [partida, setPartida] = useState<ActiveGame | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    setPartida(readActiveGame());
  }, [isOpen, pathname]);

  // Andamiaje de desarrollo: en la partida real (producción) no puede aparecer flotando
  // sobre el proyector ni sobre el celular de un equipo.
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <aside aria-label="Navegador de demostración" className="fixed bottom-4 right-4 z-[999] font-sans">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-11 px-4 rounded-full bg-primary-container text-on-primary-container shadow-2xl flex items-center gap-2 font-label-md text-label-md font-bold tracking-wider uppercase border border-white/20 hover:opacity-95 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined text-[18px]">{isOpen ? 'close' : 'tune'}</span>
        <span>Navegación</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-14 right-0 w-80 p-4 rounded-2xl bg-bg-surface/95 border border-border-subtle shadow-2xl backdrop-blur-2xl flex flex-col gap-3 text-text-primary">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest font-bold">
              Partida activa
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                partida
                  ? 'bg-surface border-accent-eficiencia text-accent-eficiencia'
                  : 'bg-surface border-border-subtle text-text-secondary'
              }`}
            >
              {partida ? partida.gameId.slice(0, 8).toUpperCase() : 'SIN PARTIDA'}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-label-sm text-label-sm text-accent-presupuesto uppercase font-semibold">
              Vista Host (pantalla completa)
            </span>
            <Link
              href={partida?.hostPath ?? '/host'}
              onClick={() => setIsOpen(false)}
              className={`p-2 rounded border transition-colors flex items-center gap-1.5 font-label-sm text-label-sm ${
                pathname === '/host'
                  ? 'bg-surface border-accent-presupuesto text-text-primary'
                  : 'bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
              <span>Abrir consola del Host</span>
            </Link>
          </div>

          <div className="flex flex-col gap-1.5 pt-2 border-t border-border-subtle">
            <span className="font-label-sm text-label-sm text-accent-electricidad uppercase font-semibold">
              Vista Player (un celular por equipo)
            </span>
            {partida && partida.teams.length > 0 ? (
              <div className="grid grid-cols-2 gap-1.5 font-label-sm text-label-sm">
                {partida.teams.map((team) => (
                  <Link
                    key={team.id}
                    href={team.path}
                    onClick={() => setIsOpen(false)}
                    className="p-2 rounded border bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary flex items-center gap-1.5 truncate"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: team.color }}
                    ></span>
                    <span className="truncate">{team.name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="font-body-sm text-body-sm text-text-secondary">
                Crea una partida en la consola del Host para ver los enlaces de cada equipo.
              </p>
            )}
          </div>

          <Link
            href="/"
            onClick={() => setIsOpen(false)}
            className="w-full text-center py-1.5 rounded bg-surface hover:bg-surface-bright text-text-secondary hover:text-text-primary font-label-sm text-label-sm transition-colors border border-border-subtle uppercase"
          >
            ← Volver al portal
          </Link>
        </div>
      )}
    </aside>
  );
}
