'use client';

/**
 * Puerta de la consola del Host.
 *
 * El proyector es público (queda a la vista de todo el salón) pero los controles no:
 * aquí se pide la contraseña, se sondea contra el Worker (`POST /host/verify`) y solo
 * entonces se abre la consola. La contraseña no vive en el bundle: la prueba el Worker.
 */

import React, { useState } from 'react';
import { ApiClientError, api, describeApiError } from '@/lib/api';
import { env, missingConfig } from '@/lib/env';

export interface HostGateProps {
  onUnlock: (passcode: string) => void;
}

export default function HostGate({ onUnlock }: HostGateProps) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entrar = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = passcode.trim();
    if (value.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifyHost(value);
      onUnlock(value);
    } catch (cause) {
      // Un Worker todavía sin actualizar no conoce /host/verify: mientras el token clásico
      // siga configurado, la consola se abre con él para no dejar la clase sin proyector.
      if (cause instanceof ApiClientError && cause.status === 404 && env.hostToken) {
        setAviso(
          'El Worker no tiene activado el control por contraseña (/host/verify no existe). Entrando con el token del bundle.',
        );
        onUnlock(env.hostToken);
        return;
      }
      setError(describeApiError(cause));
      setPasscode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-accent-crisis animate-pulse"></span>
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
              Acceso restringido · Centro de control
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg font-bold uppercase tracking-tight">
            Consola del Host
          </h1>
          <p className="font-body-sm text-body-sm text-text-secondary">
            Esta pantalla gobierna la partida: abre rondas, dispara la crisis y añade equipos.
            Escribe la contraseña del anfitrión para entrar.
          </p>
        </header>

        <form
          onSubmit={entrar}
          className="rounded-xl bg-bg-surface border border-border-subtle p-6 flex flex-col gap-4 shadow-lg"
        >
          <label className="flex flex-col gap-2">
            <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-wider">
              Contraseña de anfitrión
            </span>
            <div className="flex items-center gap-2 px-3 rounded-xl bg-bg-primary border border-border-subtle focus-within:border-accent-presupuesto">
              <span className="material-symbols-outlined text-[20px] text-text-secondary">lock</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                placeholder="••••"
                className="flex-1 h-12 bg-transparent border-0 outline-none font-metric-display-mobile text-metric-display-mobile tracking-[0.4em] text-text-primary placeholder:text-text-secondary/40"
              />
            </div>
          </label>

          {error && (
            <p className="rounded-lg border border-accent-crisis/50 bg-accent-crisis/10 px-3 py-2 font-label-sm text-label-sm">
              {error}
            </p>
          )}
          {aviso && (
            <p className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-3 py-2 font-label-sm text-label-sm">
              {aviso}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || passcode.trim().length === 0}
            className="h-12 rounded-xl bg-primary-container text-on-primary-container font-label-lg text-label-lg font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">
              {busy ? 'progress_activity' : 'login'}
            </span>
            {busy ? 'Verificando…' : 'Entrar al centro de control'}
          </button>

          <p className="font-label-sm text-label-sm text-text-secondary">
            Contraseña por defecto <code className="text-accent-presupuesto">9806</code>; se cambia con el
            secreto <code className="text-accent-presupuesto">HOST_PASSCODE</code> del Worker.
          </p>
        </form>

        {missingConfig.length > 0 && (
          <p className="rounded-lg border border-accent-gas/40 bg-accent-gas/10 px-4 py-3 font-label-sm text-label-sm">
            Configuración incompleta: falta {missingConfig.join(', ')}.
          </p>
        )}
      </div>
    </main>
  );
}
