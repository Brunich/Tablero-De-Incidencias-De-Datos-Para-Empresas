// Lógica de Entrega de turno, sin interfaz: reglas para mover incidencias, tiempos y el resumen.
export type Status = 'open' | 'doing' | 'closed';
export type Sev = 'Crítica' | 'Mayor' | 'Menor';
export type Incident = { id: string; line: string; lot: string; defect: string; sev: Sev; status: Status; owner: string; action: string; photo: string; at: number };
export type Log = { at: number; id: string; text: string; tone: 'new' | 'move' | 'ok' | 'err' | 'info' };
export const OWNERS = ['R. Garza', 'L. Treviño', 'A. Cantú', 'M. Salinas'];
export const SEV_EN: Record<Sev, string> = { 'Crítica': 'Critical', 'Mayor': 'Major', 'Menor': 'Minor' };
export const RANK: Record<Sev, number> = { 'Crítica': 0, 'Mayor': 1, 'Menor': 2 };
export const SLA: Record<Sev, number> = { 'Crítica': 2, 'Mayor': 8, 'Menor': 24 }; // horas para cerrarla
export const H = 60 * 60 * 1000;

export const sample = (now = Date.now()): Incident[] => [
 { id: 'INC-232', line: 'L1', lot: '4468', defect: 'Torque fuera de rango en rueda', sev: 'Crítica', status: 'doing', owner: 'R. Garza', action: 'Recalibrar la llave 3', photo: '', at: now - 2.6 * H },
 { id: 'INC-231', line: 'L2', lot: '4471', defect: 'Burbuja en pintura de cofre', sev: 'Mayor', status: 'open', owner: '', action: '', photo: '', at: now - 1.4 * H },
 { id: 'INC-229', line: 'L3', lot: '4459', defect: 'Fuga en sello de parabrisas', sev: 'Mayor', status: 'doing', owner: 'L. Treviño', action: 'Cambiar lote de sellador', photo: 'demo', at: now - 5 * H },
 { id: 'INC-226', line: 'L1', lot: '4450', defect: 'Rayón en puerta trasera', sev: 'Menor', status: 'closed', owner: 'A. Cantú', action: 'Pulido y reinspección', photo: 'demo', at: now - 6.5 * H },
];
export const sampleLog = (items: Incident[]): Log[] => items.map(i => ({ at: i.at, id: i.id, tone: 'new' as const, text: `registrada · ${i.line} · lote ${i.lot} · ${i.sev.toUpperCase()}` })).sort((a, b) => b.at - a.at); // la más nueva arriba, como en la consola

// Turnos de planta: matutino 06–14, vespertino 14–22, nocturno 22–06.
export function shiftNow(d = new Date()) {
 const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
 const [name, start, next] = (h >= 6 && h < 14 ? ['Matutino', 6, 'vespertino'] : h >= 14 && h < 22 ? ['Vespertino', 14, 'nocturno'] : ['Nocturno', 22, 'matutino']) as [string, number, string];
 const elapsed = (h - start + 24) % 24;
 return { name, next, progress: elapsed / 8, left: Math.max(0, 8 - elapsed) };
}

// La regla del tablero: nada empieza sin responsable y nada se cierra sin responsable y foto.
export type MoveCheck = { ok: true } | { ok: false; why: 'owner' | 'evidence' | 'same' };
export function canMove(i: Incident, to: Status): MoveCheck {
 if (i.status === to) return { ok: false, why: 'same' };
 if (to !== 'open' && !i.owner) return { ok: false, why: 'owner' };
 if (to === 'closed' && !i.photo) return { ok: false, why: 'evidence' };
 return { ok: true };
}

// Horas desde que se registró, y qué tanto del SLA ya se comió (1 = fuera de tiempo).
export const ageHours = (i: Incident, now = Date.now()) => (now - i.at) / H;
export const slaUsed = (i: Incident, now = Date.now()) => Math.min(1, ageHours(i, now) / SLA[i.sev]);
export const isLate = (i: Incident, now = Date.now()) => i.status !== 'closed' && ageHours(i, now) > SLA[i.sev];

export const pendingOf = (items: Incident[]) => items.filter(i => i.status !== 'closed').sort((a, b) => RANK[a.sev] - RANK[b.sev] || a.at - b.at);
export const nextId = (items: Incident[]) => `INC-${Math.max(232, ...items.map(i => Number(i.id.slice(4)) || 0)) + 1}`;
export const validLot = (lot: string) => /^\d{3,5}$/.test(lot);

// El texto que se manda al siguiente turno (WhatsApp o portapapeles).
export function summaryText(items: Incident[], es: boolean, when = new Date(), now = Date.now()) {
 const t = (a: string, b: string) => (es ? a : b);
 const pending = pendingOf(items), orphan = pending.filter(i => !i.owner).length, late = pending.filter(i => isLate(i, now)).length;
 return [
  t(`Entrega de turno · ${when.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`, `Shift handover · ${when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`),
  t(`${pending.length} pendientes${orphan ? `, ${orphan} sin responsable` : ''}${late ? `, ${late} fuera de tiempo` : ''}:`, `${pending.length} open${orphan ? `, ${orphan} without owner` : ''}${late ? `, ${late} overdue` : ''}:`),
  ...pending.map(i => `• [${es ? i.sev : SEV_EN[i.sev]}] ${i.id} ${i.defect} (${i.line}, ${t('lote', 'batch')} ${i.lot}) — ${i.owner || t('SIN RESPONSABLE', 'NO OWNER')}${i.action ? ` · ${i.action}` : ''}`),
 ].join('\n');
}
