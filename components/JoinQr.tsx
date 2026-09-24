'use client';

/**
 * QR de registro para el proyector.
 *
 * Codifica la URL de alta de equipos (`/join?game=...`): cada mesa lo escanea y cae
 * directamente en la pantalla donde escribe su nombre. Se dibuja como SVG (nítido a
 * cualquier tamaño y sin canvas, así que no falla en el portátil del aula) con fondo
 * claro y módulos oscuros: contraste alto = lectura fiable desde lejos.
 */

import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export interface JoinQrProps {
  url: string;
  size?: number;
  className?: string;
}

export default function JoinQr({ url, size = 208, className = '' }: JoinQrProps) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className={`flex items-center gap-5 ${className}`}>
      <div className="rounded-xl bg-white p-3 shadow-[0_0_0_6px_rgba(62,198,240,0.12)]">
        <QRCodeSVG
          value={url}
          size={size}
          level="M"
          marginSize={0}
          bgColor="#FFFFFF"
          fgColor="#0A0E17"
        />
      </div>

      <div className="flex flex-col gap-2 min-w-0">
        <span className="font-label-sm text-label-sm text-text-secondary uppercase tracking-widest">
          Registro de mesas
        </span>
        <p className="font-headline-md text-headline-md font-bold uppercase text-text-primary leading-tight">
          Escanea y escribe
          <br />
          tu nombre de equipo
        </p>
        <code className="font-label-sm text-[11px] text-accent-presupuesto break-all">{url}</code>
        <button
          type="button"
          onClick={() => void copiar()}
          className="self-start mt-1 h-9 px-3 rounded-lg border border-border-subtle bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-text-secondary hover:text-text-primary active:scale-95 transition-all flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">
            {copiado ? 'check' : 'content_copy'}
          </span>
          {copiado ? 'Enlace copiado' : 'Copiar enlace'}
        </button>
      </div>
    </div>
  );
}
