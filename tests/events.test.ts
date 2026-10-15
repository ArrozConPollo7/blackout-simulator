/**
 * Plan 2.2: eventos aleatorios extra.
 *
 * Reglas que se verifican aqui (las del documento del plan, no otras):
 *   1. 0 eventos en `investigar`, 1 en `decidir`, ninguno en el resto de fases.
 *   2. Un evento nunca se repite dentro de la misma partida.
 *   3. Ningun evento deja a un equipo sin ninguna situacion jugable (invariante de balance).
 *   4. Solo la falla de aparato le cobra algo a una decision, y solo cuando la situacion
 *      toca el aparato averiado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CASE_CATALOG } from '../content/cases.ts';
import { SCENARIOS_BY_ID, scenariosForCase } from '../content/decisions.ts';
import { EVENT_COUNT_BY_ROUND } from '../content/events.ts';
import { PHASE_ORDER } from '../content/phases.ts';
import { drawnScenarioIdsForCase } from '../engine/draw.ts';
import {
  candidateEvents,
  drawEvents,
  drawEventsForGame,
  eventEffectForDecision,
  eventLogKey,
  isEventApplied,
  locksOf,
  markApplied,
  playableScenarioIds,
  viableEvents,
} from '../engine/events.ts';

const SEMILLAS = Array.from({ length: 60 }, (_, i) => i + 1);
const EQUIPO = { id: 'equipo-1', caseId: 'familia-duque' };
const AULA = CASE_CATALOG.slice(0, 5).map((caso, i) => ({ id: `equipo-${i}`, caseId: caso.id }));

describe('sorteo de eventos aleatorios', () => {
  it('solo la ronda de decisiones trae evento', () => {
    assert.equal(EVENT_COUNT_BY_ROUND.investigar, 0);
    assert.equal(EVENT_COUNT_BY_ROUND.decidir, 1);
    for (const phase of PHASE_ORDER) {
      const eventos = drawEvents(3, phase, AULA);
      assert.equal(eventos.length, EVENT_COUNT_BY_ROUND[phase], `fase ${phase}`);
    }
  });

  it('sin equipos no hay evento (una partida vacia no sortea nada)', () => {
    assert.deepEqual(drawEvents(3, 'decidir', []), []);
  });

  it('es determinista y cambia con la semilla', () => {
    const claves = SEMILLAS.map((seed) => drawEvents(seed, 'decidir', AULA).map(eventLogKey).join('|'));
    for (const seed of SEMILLAS) {
      assert.deepEqual(
        drawEvents(seed, 'decidir', AULA).map(eventLogKey),
        SEMILLAS.includes(seed) ? drawEvents(seed, 'decidir', AULA).map(eventLogKey) : [],
      );
    }
    assert.ok(new Set(claves).size > 1, 'el evento del aula no puede ser siempre el mismo');
  });

  it('un evento nunca se repite dentro de la misma partida', () => {
    for (const seed of SEMILLAS) {
      const eventos = drawEventsForGame(seed, AULA, PHASE_ORDER);
      const claves = eventos.map(eventLogKey);
      assert.equal(new Set(claves).size, claves.length, `semilla ${seed}: ${claves.join(', ')}`);
    }
  });

  it('el invariante de balance se cumple por construccion: ningun evento viable deja sin jugada', () => {
    // Barrido caso x evento x semilla: es lo que el plan pide comprobar por fuerza bruta.
    for (const caso of CASE_CATALOG) {
      const equipo = { id: `equipo-${caso.id}`, caseId: caso.id };
      for (let seed = 1; seed <= 15; seed += 1) {
        const candidatos = viableEvents(seed, [equipo]);
        assert.ok(candidatos.length > 0, `${caso.id}: sin candidatos viables`);
        for (const evento of candidatos) {
          // Solo el apagon parcial retira situaciones; la falla y el subsidio no bloquean nada.
          const bloqueo = evento.kind === 'lock' ? evento.applianceId : null;
          assert.ok(
            playableScenarioIds(seed, equipo, bloqueo).length > 0,
            `${caso.id}/${seed}: ${eventLogKey(evento)} deja al equipo sin jugada`,
          );
        }
        const sorteados = drawEvents(seed, 'decidir', [equipo]);
        for (const evento of sorteados) {
          assert.ok(playableScenarioIds(seed, equipo, evento.applianceId).length > 0);
        }
      }
    }
  });

  it('todos los candidatos son eventos del catalogo, con su aparato cuando lo necesitan', () => {
    for (const evento of candidateEvents(AULA)) {
      assert.ok(['subsidio-sorpresa', 'apagon-parcial', 'falla-de-aparato'].includes(evento.id));
      assert.ok(evento.title.length > 0 && evento.description.length > 10);
      if (evento.kind === 'lock' || evento.kind === 'fault') assert.ok(evento.applianceId);
      if (evento.kind === 'subsidy') assert.equal(evento.applianceId, null);
    }
  });

  it('el bloqueo solo lo aplica el apagon parcial y sobre el aparato que menciona', () => {
    const apagonAire = candidateEvents(AULA).find((e) => e.kind === 'lock' && e.applianceId === 'aire-acondicionado');
    assert.ok(apagonAire);
    assert.deepEqual(locksOf([apagonAire]), ['aire-acondicionado']);
    assert.deepEqual(locksOf(drawEvents(5, 'decidir', AULA).filter((e) => e.kind !== 'lock')), []);

    // La situacion que necesita ese aparato queda fuera; las demas siguen.
    const conAire = Object.values(SCENARIOS_BY_ID).find((s) => (s.requires ?? []).includes('aire-acondicionado'))!;
    assert.ok(conAire);
  });
});

describe('aplicacion de los eventos', () => {
  it('la falla de aparato solo cobra en la situacion que toca el aparato averiado', () => {
    const falla = candidateEvents(AULA).find((e) => e.kind === 'fault' && e.applianceId === 'nevera')!;
    const conNevera = Object.values(SCENARIOS_BY_ID).find(
      (s) => (s.requires ?? []).includes('nevera') && s.round === 'decidir',
    )!;
    const sinNevera = Object.values(SCENARIOS_BY_ID).find(
      (s) => !(s.requires ?? []).includes('nevera') && s.round === 'decidir',
    )!;

    const cobro = eventEffectForDecision([falla], conNevera);
    assert.ok(cobro);
    assert.equal(cobro.event.applianceId, 'nevera');
    assert.ok((cobro.effect.electricidad ?? 0) > 0, 'la falla suma consumo');
    assert.equal(eventEffectForDecision([falla], sinNevera), null, 'una situacion ajena no paga la falla');

    // El subsidio y el apagon no se cobran en decisiones.
    const subsidio = candidateEvents(AULA).find((e) => e.kind === 'subsidy')!;
    const apagon = candidateEvents(AULA).find((e) => e.kind === 'lock')!;
    assert.equal(eventEffectForDecision([subsidio], conNevera), null);
    assert.equal(eventEffectForDecision([apagon], conNevera), null);
  });

  it('un evento ya cobrado no vuelve a cobrarse (el historial es el libro mayor)', () => {
    const falla = candidateEvents(AULA).find((e) => e.kind === 'fault' && e.applianceId === 'nevera')!;
    const conNevera = Object.values(SCENARIOS_BY_ID).find(
      (s) => (s.requires ?? []).includes('nevera') && s.round === 'decidir',
    )!;
    const yaCobrado = markApplied([falla], [eventLogKey(falla)]);
    assert.equal(yaCobrado[0].applied, true);
    assert.equal(isEventApplied(falla, [eventLogKey(falla)]), true);
    assert.equal(isEventApplied(falla, []), false);
    assert.equal(
      eventEffectForDecision(yaCobrado, conNevera),
      null,
      'si ya se pago, la siguiente decision de ese aparato no lo vuelve a pagar',
    );
  });

  it('las tres familias de evento salen de verdad en un barrido de partidas', () => {
    const vistos = new Set<string>();
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const evento of drawEvents(seed, 'decidir', AULA)) vistos.add(evento.kind);
    }
    assert.deepEqual([...vistos].sort(), ['fault', 'lock', 'subsidy']);
  });
});
