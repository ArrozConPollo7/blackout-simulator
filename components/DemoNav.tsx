'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function DemoNav() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <aside aria-label="Navegador de Demostración" className="fixed bottom-4 right-4 z-[999] font-sans">
      {/* Floating Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="h-11 px-4 rounded-full bg-primary-container text-on-primary-container shadow-2xl flex items-center gap-2 font-label-md text-label-md font-bold tracking-wider uppercase border border-white/20 hover:opacity-95 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined text-[18px]">
          {isOpen ? 'close' : 'tune'}
        </span>
        <span>DEMO NAVEGACIÓN</span>
      </button>

      {/* Floating Modal / Drawer */}
      {isOpen && (
        <div className="absolute bottom-14 right-0 w-80 p-4 rounded-2xl bg-bg-surface/95 border border-border-subtle shadow-2xl backdrop-blur-2xl flex flex-col gap-3 text-text-primary animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest font-bold">
              PANEL DE REVISIÓN
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border-subtle text-accent-eficiencia font-semibold">
              MOCK ACTIVO
            </span>
          </div>

          {/* Host Views Navigation */}
          <div className="flex flex-col gap-1.5">
            <span className="font-label-sm text-label-sm text-accent-presupuesto uppercase font-semibold">
              VISTA HOST (PANTALLA COMPLETA)
            </span>
            <div className="grid grid-cols-2 gap-1.5 font-label-sm text-label-sm">
              <Link
                href="/host?phase=lobby"
                onClick={() => setIsOpen(false)}
                className={`p-2 rounded border transition-colors flex items-center gap-1.5 ${
                  pathname === '/host'
                    ? 'bg-surface border-accent-presupuesto text-text-primary'
                    : 'bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">group</span>
                <span>1. Lobby</span>
              </Link>
              <Link
                href="/host?phase=en_juego"
                onClick={() => setIsOpen(false)}
                className={`p-2 rounded border transition-colors flex items-center gap-1.5 ${
                  pathname === '/host'
                    ? 'bg-surface border-accent-presupuesto text-text-primary'
                    : 'bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">speed</span>
                <span>2. En Juego</span>
              </Link>
              <Link
                href="/host?phase=crisis"
                onClick={() => setIsOpen(false)}
                className={`p-2 rounded border transition-colors flex items-center gap-1.5 ${
                  pathname === '/host'
                    ? 'bg-surface border-accent-crisis text-accent-crisis'
                    : 'bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[14px] text-accent-crisis">warning</span>
                <span>3. Crisis</span>
              </Link>
              <Link
                href="/host?phase=resultados"
                onClick={() => setIsOpen(false)}
                className={`p-2 rounded border transition-colors flex items-center gap-1.5 ${
                  pathname === '/host'
                    ? 'bg-surface border-accent-presupuesto text-text-primary'
                    : 'bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[14px] text-accent-eficiencia">emoji_events</span>
                <span>4. Podio</span>
              </Link>
            </div>
          </div>

          {/* Player Views Navigation */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-border-subtle">
            <span className="font-label-sm text-label-sm text-accent-electricidad uppercase font-semibold">
              VISTA PLAYER (MOBILE 1 POR EQUIPO)
            </span>
            <div className="grid grid-cols-2 gap-1.5 font-label-sm text-label-sm">
              <Link
                href="/play/alfa"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded border bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full bg-accent-eficiencia"></span>
                <span>Equipo Alfa</span>
              </Link>
              <Link
                href="/play/gamma"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded border bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full bg-secondary"></span>
                <span>Equipo Gamma</span>
              </Link>
              <Link
                href="/play/delta"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded border bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full bg-accent-presupuesto"></span>
                <span>Equipo Delta</span>
              </Link>
              <Link
                href="/play/beta"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded border bg-surface-container-low border-border-subtle text-text-secondary hover:text-text-primary flex items-center gap-1.5"
              >
                <span className="w-2 h-2 rounded-full bg-accent-crisis"></span>
                <span>Equipo Beta</span>
              </Link>
            </div>
          </div>

          {/* Portal Home Link */}
          <Link
            href="/"
            onClick={() => setIsOpen(false)}
            className="w-full text-center py-1.5 rounded bg-surface hover:bg-surface-bright text-text-secondary hover:text-text-primary font-label-sm text-label-sm transition-colors border border-border-subtle uppercase"
          >
            ← Volver a Portada Principal
          </Link>
        </div>
      )}
    </aside>
  );
}
