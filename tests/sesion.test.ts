/**
 * La partida que recuerda el dispositivo: cuándo se puede seguir y cuándo hay que soltarla.
 *
 * El bug que cubre: un celular que jugó la clase anterior abría el portal y veía «Abrir la
 * partida / sala C619 / 1 mesa» como si tuviera sesión, y al entrar aparecía la partida
 * vieja —sin relación con la que el PC acababa de crear—. El registro local nunca se
 * comprueba contra el servidor hasta que se pulsa, y entonces ya es tarde.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  avisoDeSesion,
  clasificarPartidaGuardada,
  sePuedeReanudar,
  type DatosDeSesion,
  type EstadoPartidaGuardada,
} from '../lib/sesion.ts';

const datos = (parcial: Partial<DatosDeSesion>): DatosDeSesion => ({
  guardada: true,
  respuesta: 'ok',
  fase: 'lobby',
  ...parcial,
});

describe('Sesión guardada — clasificación', () => {
  it('sin registro local no hay nada que clasificar', () => {
    assert.equal(
      clasificarPartidaGuardada(datos({ guardada: false, respuesta: 'sin-respuesta', fase: null })),
      'sin-registro',
    );
  });

  it('una partida en lobby o en cualquier fase jugable se puede reanudar', () => {
    for (const fase of ['lobby', 'investigar', 'decidir', 'crisis', 'crisis_votacion', 'decidir_2'] as const) {
      const estado = clasificarPartidaGuardada(datos({ fase }));
      assert.equal(estado, 'en-juego', `fase ${fase}`);
      assert.equal(sePuedeReanudar(estado), true, `fase ${fase}`);
    }
  });

  it('una partida en resultados está terminada y NO se ofrece para continuar', () => {
    const estado = clasificarPartidaGuardada(datos({ fase: 'resultados' }));
    assert.equal(estado, 'terminada');
    assert.equal(sePuedeReanudar(estado), false);
  });

  it('un 404 del servidor deja la partida como inexistente', () => {
    const estado = clasificarPartidaGuardada(datos({ respuesta: 'no-existe', fase: null }));
    assert.equal(estado, 'no-existe');
    assert.equal(sePuedeReanudar(estado), false);
  });

  it('sin respuesta se conserva el atajo: una API caída no bloquea al Host en el aula', () => {
    const estado = clasificarPartidaGuardada(datos({ respuesta: 'sin-respuesta', fase: null }));
    assert.equal(estado, 'sin-confirmar');
    assert.equal(sePuedeReanudar(estado), true);
    assert.equal(avisoDeSesion(estado, 'C619'), null);
  });

  it('la fase manda sobre cualquier suposición del cliente', () => {
    // El servidor dice resultados aunque el registro local sea reciente: se acaba la sesión.
    assert.equal(clasificarPartidaGuardada(datos({ fase: 'resultados' })), 'terminada');
  });
});

describe('Sesión guardada — avisos del portal', () => {
  it('avisa con el código de sala cuando la partida terminó', () => {
    const aviso = avisoDeSesion('terminada', 'C619');
    assert.ok(aviso?.includes('C619'));
    assert.ok(aviso?.includes('terminó'));
  });

  it('avisa cuando la partida ya no existe', () => {
    assert.match(avisoDeSesion('no-existe', 'C619') ?? '', /ya no existe/);
  });

  it('no avisa nada cuando la partida sigue viva o no hay registro', () => {
    for (const estado of ['en-juego', 'sin-registro', 'sin-confirmar'] as EstadoPartidaGuardada[]) {
      assert.equal(avisoDeSesion(estado, 'C619'), null, estado);
    }
  });
});
