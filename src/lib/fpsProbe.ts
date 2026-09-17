"use client";

/**
 * Sonda de fps independiente de React.
 *
 * Vivía dentro de un `useEffect` y dependía del ciclo de vida del componente:
 * cuando el árbol se re-montaba (por ejemplo al hidratar con ajustes guardados en
 * el navegador) la medición se perdía y la pantalla se quedaba diciendo
 * «midiendo los primeros frames…» para siempre. A nivel de módulo el resultado
 * sobrevive a re-montajes: se mide una vez y se publica a quien lo pida, ahora o
 * más tarde.
 *
 * Coste: ~70 frames de `requestAnimationFrame` una sola vez por carga de página.
 */

export type Suscriptor = (fps: number) => void;

const ESPERA_MS = 600;
const DURACION_MS = 1200;
/** Por debajo de estos fps la página se pone sola en modo ligero. */
export const FPS_MINIMOS = 40;

let medicion: number | null = null;
let enCurso = false;
const suscriptores = new Set<Suscriptor>();

/** Última medición, o null si todavía no se ha hecho. */
export function fpsMedidos(): number | null {
  return medicion;
}

function publicar(fps: number) {
  medicion = fps;
  enCurso = false;
  for (const cb of Array.from(suscriptores)) {
    try {
      cb(fps);
    } catch {
      /* un suscriptor roto no debe tumbar la medición */
    }
  }
}

function arrancar() {
  if (enCurso || typeof window === "undefined") return;
  enCurso = true;

  const medir = () => {
    const deltas: number[] = [];
    const inicio = performance.now();
    let ultimo = inicio;

    const paso = (ahora: number) => {
      deltas.push(ahora - ultimo);
      ultimo = ahora;
      if (ahora - inicio < DURACION_MS) {
        requestAnimationFrame(paso);
        return;
      }
      // Los primeros frames siempre llegan tarde (hidratación, primer pintado).
      const utiles = deltas.slice(3).sort((a, b) => a - b);
      if (!utiles.length) {
        publicar(0);
        return;
      }
      publicar(Math.round(1000 / utiles[Math.floor(utiles.length / 2)]));
    };

    requestAnimationFrame(paso);
  };

  setTimeout(medir, ESPERA_MS);
}

/**
 * Se suscribe a la medición de fps. Si ya hay una, la entrega de inmediato.
 * Devuelve la función para darse de baja.
 */
export function suscribirFps(cb: Suscriptor): () => void {
  suscriptores.add(cb);
  if (medicion !== null) {
    cb(medicion);
    return () => suscriptores.delete(cb);
  }
  arrancar();
  return () => suscriptores.delete(cb);
}
