import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMove, H, isLate, nextId, pendingOf, sample, shiftNow, summaryText, validLot } from '../src/turno-logic.ts';

const now = Date.UTC(2026, 8, 28, 15);
const items = sample(now);

test('nada empieza sin responsable y nada se cierra sin foto', () => {
 const open = items.find(i => i.id === 'INC-231')!;
 const torque = items.find(i => i.id === 'INC-232')!;
 const seal = items.find(i => i.id === 'INC-229')!;
 assert.deepEqual(canMove(open, 'doing'), { ok: false, why: 'owner' });
 assert.deepEqual(canMove(torque, 'closed'), { ok: false, why: 'evidence' });
 assert.deepEqual(canMove(seal, 'closed'), { ok: true });
 assert.deepEqual(canMove(seal, 'doing'), { ok: false, why: 'same' });
 assert.deepEqual(canMove(open, 'open'), { ok: false, why: 'same' });
});

test('la crítica va primero y el SLA marca lo que ya se pasó', () => {
 const p = pendingOf(items);
 assert.equal(p[0].id, 'INC-232');
 assert.equal(p.length, 3);
 assert.equal(isLate(p[0], now), true); // 2,6 h sobre 2 h
 assert.equal(isLate({ ...p[0], at: now - 1 * H }, now), false);
 assert.equal(isLate(items.find(i => i.status === 'closed')!, now), false);
});

test('turnos de 8 horas y folios que siguen', () => {
 assert.equal(shiftNow(new Date(2026, 8, 28, 7)).name, 'Matutino');
 assert.equal(shiftNow(new Date(2026, 8, 28, 15)).next, 'nocturno');
 const n = shiftNow(new Date(2026, 8, 28, 2));
 assert.equal(n.name, 'Nocturno');
 assert.equal(n.left, 4);
 assert.equal(nextId(items), 'INC-233');
 assert.equal(validLot('4480'), true);
 assert.equal(validLot('44a'), false);
});

test('el resumen avisa lo que queda sin dueño y fuera de tiempo', () => {
 const s = summaryText(items, true, new Date(now), now);
 assert.match(s, /3 pendientes, 1 sin responsable, 1 fuera de tiempo/);
 assert.match(s, /SIN RESPONSABLE/);
 assert.ok(s.indexOf('INC-232') < s.indexOf('INC-231'));
 assert.match(summaryText(items, false, new Date(now), now), /3 open/);
});
