/**
 * Guardia de codificación (UTF-8).
 *
 * El cascarón de Antigravity llegó con caracteres corruptos en `app/layout.tsx` y
 * `mock/gameState.ts` (secuencias U+FFFD: bytes perdidos al escribir los archivos).
 * Este test impide que vuelva a colarse texto roto y que reaparezca el mojibake de
 * UTF-8 leído como latin-1 (por ejemplo U+00C3 U+00B3 donde debería haber "ó").
 *
 * Las secuencias se comparan por punto de código (no con literales en el fuente) para
 * que este propio archivo no se delate a si mismo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.json', '.sql', '.md'];
const IGNORAR = new Set(['node_modules', '.next', '.git', 'coverage', 'out', 'dist']);
const CARACTER_ROTO = '\uFFFD';

/** UTF-8 interpretado como latin-1: C3 + byte bajo, E2 + 20AC, C2 + byte alto. */
function tieneMojibake(texto: string): boolean {
  const puntos = [...texto].map((ch) => ch.codePointAt(0)!);
  for (let i = 0; i < puntos.length - 1; i += 1) {
    const [a, b] = [puntos[i], puntos[i + 1]];
    if (a === 0x00c3 && b >= 0x0080 && b <= 0x00bf) return true;
    if (a === 0x00e2 && b === 0x20ac) return true;
    if (a === 0x00c2 && b >= 0x00a0 && b <= 0x00bf) return true;
  }
  return false;
}

function archivos(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;
    const full = join(dir, entrada);
    if (statSync(full).isDirectory()) {
      archivos(full, acc);
    } else if (EXTENSIONES.some((ext) => entrada.endsWith(ext)) && !entrada.endsWith('package-lock.json')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('codificación de los archivos fuente', () => {
  const fuentes = archivos(ROOT);

  it('encuentra los archivos del proyecto (el test no esta vacio por error)', () => {
    assert.ok(fuentes.length > 15, `solo se leyeron ${fuentes.length} archivos`);
  });

  it('ningun archivo contiene caracteres de reemplazo (U+FFFD)', () => {
    const rotos = fuentes.filter((f) => readFileSync(f, 'utf8').includes(CARACTER_ROTO));
    assert.deepEqual(
      rotos.map((f) => relative(ROOT, f)),
      [],
      'hay archivos con bytes perdidos: reescribelos en UTF-8 con las tildes correctas',
    );
  });

  it('ningun archivo tiene mojibake (texto UTF-8 leido como latin-1)', () => {
    const sospechosos = fuentes.filter((f) => tieneMojibake(readFileSync(f, 'utf8')));
    assert.deepEqual(sospechosos.map((f) => relative(ROOT, f)), []);
  });

  it('las tildes del español se conservan en los textos que ve el usuario', () => {
    const decisiones = readFileSync(join(ROOT, 'content/decisions.ts'), 'utf8');
    assert.match(decisiones, /Climatización/);
    assert.match(decisiones, /Últimas decisiones bajo crisis/);
    assert.match(decisiones, /presión/);
    const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8');
    assert.match(layout, /Energía en Crisis/);
    assert.match(layout, /charSet="utf-8"/);
  });
});
