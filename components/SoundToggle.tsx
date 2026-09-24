'use client';

import React, { useCallback } from 'react';
import { audio, useSoundEnabled } from '@/lib/audio';

/**
 * Botón de sonido del centro de control.
 *
 * Muestra el estado (nunca emojis: ícono de línea Material Symbols, regla de Design.md)
 * y es el gesto que desbloquea el `AudioContext`: `unlock()` + `setEnabled()` ocurren
 * dentro del click, que es la única forma de que el navegador deje sonar la página.
 */
export default function SoundToggle({ className = '' }: { className?: string }) {
  const [enabled, setEnabled] = useSoundEnabled();

  const toggle = useCallback(() => {
    const next = !enabled;
    audio.unlock();
    if (next) {
      // Encender: primero se enciende, luego suena la confirmación.
      setEnabled(true);
      audio.play('confirm');
    } else {
      // Apagar: el click suena antes de quedarse mudo, si no sería inaudible.
      audio.play('click');
      setEnabled(false);
    }
  }, [enabled, setEnabled]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? 'Silenciar el sonido del centro de control' : 'Activar el sonido del centro de control'}
      title={enabled ? 'Sonido activado' : 'Sonido silenciado'}
      className={`h-8 px-2.5 rounded-lg border flex items-center gap-1 font-label-sm text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${
        enabled
          ? 'bg-bg-surface border-accent-eficiencia/60 text-accent-eficiencia'
          : 'bg-bg-surface border-border-subtle text-text-secondary hover:text-text-primary'
      } ${className}`}
    >
      <span className="material-symbols-outlined text-[16px] leading-none">
        {enabled ? 'volume_up' : 'volume_off'}
      </span>
      <span className="whitespace-nowrap max-[420px]:hidden">
        {enabled ? 'Sonido' : 'Mudo'}
      </span>
    </button>
  );
}
