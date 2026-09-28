import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, WarningOctagon, Warning, Info, Clock, DotsSixVertical, ArrowRight, TerminalWindow } from '@phosphor-icons/react';
import './shift-handover.css';

// Entrega de turno: tablero de incidencias de calidad (abierta → en curso → cerrada) con bitácora tipo consola.
// Sólo se cierra con responsable y foto de evidencia; cada severidad tiene su tiempo máximo (SLA)
// y al final sale el resumen para el siguiente turno. Se guarda en este navegador.
import { closeStats, exportRows, fmtHours, OWNERS, SEV_EN, RANK, SLA, H, sample, sampleLog, shiftNow, canMove, pendingOf, nextId, validLot, summaryText, isLate } from './turno-logic';
import type { Status, Sev, Incident, Log } from './turno-logic';
const KEY = 'bruno-turno-v3';
const load = (): { items: Incident[]; log: Log[] } => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? ''); if (Array.isArray(v.items)) return v; } catch { /* ejemplo */ } const items = sample(); return { items, log: sampleLog(items) }; };

function shrink(file: File): Promise<string> {
 return new Promise((ok, fail) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, 480 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', .72)); };
  img.onerror = fail; img.src = url;
 });
}

// Cuando una tarjeta cambia de columna, se desliza desde donde estaba (técnica FLIP).
function useFlip(dep: unknown) {
 const nodes = useRef(new Map<string, HTMLElement>()), last = useRef(new Map<string, DOMRect>());
 useLayoutEffect(() => {
  const still = document.documentElement.dataset.motion === 'paused' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const next = new Map<string, DOMRect>();
  nodes.current.forEach((el, id) => {
   const r = el.getBoundingClientRect(); next.set(id, r);
   const p = last.current.get(id);
   if (p && !still && (Math.abs(p.left - r.left) > 40)) el.animate([{ transform: `translate(${p.left - r.left}px, ${p.top - r.top}px) rotate(${p.left > r.left ? -3 : 3}deg)`, boxShadow: '0 30px 60px #000a' }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
  });
  last.current = next;
 }, [dep]);
 return (id: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); };
}

export default function ShiftHandover({ lang }: { lang: 'es' | 'en' }) {
 const es = lang === 'es', t = (a: string, b: string) => (es ? a : b);
 const [state, setState] = useState(load);
 const { items, log } = state;
 const [draft, setDraft] = useState({ line: 'L2', lot: '', defect: '', sev: 'Mayor' as Sev });
 const [openId, setOpenId] = useState<string | null>(null);
 const [handed, setHanded] = useState<string | null>(null);
 const [copied, setCopied] = useState(false);
 const [err, setErr] = useState('');
 const [now, setNow] = useState(() => new Date());
 const [drag, setDrag] = useState<string | null>(null);
 const [over, setOver] = useState<Status | null>(null);
 const [shake, setShake] = useState<string | null>(null);
 // Celular: una columna a la vista (pestañas). Filtros por línea y severidad, y «ver más» con muchas incidencias.
 const [tab, setTab] = useState<Status>('open');
 const [fLine, setFLine] = useState('');
 const [fSev, setFSev] = useState<Sev | ''>('');
 const [more, setMore] = useState<Status[]>([]);
 const PER_COL = 6;
 const file = useRef<HTMLInputElement>(null), target = useRef<string>(''), consoleEnd = useRef<HTMLOListElement>(null);
 const flip = useFlip(items.map(i => i.id + i.status).join());
 useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sin espacio: sigue en memoria */ } }, [state]);
 useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
 useEffect(() => { consoleEnd.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [log.length]);

 const note = (id: string, text: string, tone: Log['tone']) => setState(s => ({ ...s, log: [{ at: Date.now(), id, text, tone }, ...s.log].slice(0, 40) }));
 const patch = (id: string, p: Partial<Incident>) => { setState(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, ...p } : i) })); setHanded(null); };
 const label: Record<Status, string> = { open: t('Abiertas', 'Open'), doing: t('En curso', 'In progress'), closed: t('Cerradas', 'Closed') };
 const age = (i: Incident) => (Date.now() - i.at) / H;
 const ago = (at: number) => { const m = Math.max(1, Math.round((Date.now() - at) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
 const clock = (d: Date | number) => new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
 const pending = pendingOf(items);
 const orphan = pending.filter(i => !i.owner).length;
 const late = pending.filter(i => isLate(i)).length;
 const shift = shiftNow(now);
 const closedNow = items.filter(i => i.status === 'closed');
 const stats = closeStats(items);
 async function exportExcel() {
  const XLSX = await import('xlsx'); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exportRows(items, es)), t('Incidencias', 'Incidents'));
  XLSX.writeFile(wb, `incidencias_${new Date().toISOString().slice(0, 7)}.xlsx`);
 }

 // Mover una incidencia de columna, con las mismas reglas que el formulario.
 function move(i: Incident, to: Status) {
  const ok = canMove(i, to);
  if (!ok.ok) {
   if (ok.why === 'same') return;
   setShake(i.id); setTimeout(() => setShake(null), 600); setOpenId(i.id);
   note(i.id, ok.why === 'evidence' ? t('no se puede cerrar: falta evidencia', 'cannot close: no evidence') : to === 'closed' ? t('no se puede cerrar: falta responsable', 'cannot close: no owner') : t('asigna un responsable para empezarla', 'assign an owner to start it'), 'err');
   return;
  }
  patch(i.id, { status: to, closedAt: to === 'closed' ? Date.now() : undefined });
  note(i.id, to === 'closed' ? t(`cerrada por ${i.owner} con evidencia`, `closed by ${i.owner} with evidence`) : to === 'doing' ? (i.status === 'closed' ? t('reabierta', 'reopened') : t('en curso', 'in progress')) : t('regresó a abiertas', 'back to open'), to === 'closed' ? 'ok' : 'move');
  if (to === 'closed') setOpenId(null);
 }
 function add(e: React.FormEvent) {
  e.preventDefault();
  if (!draft.defect.trim()) return setErr(t('Escribe el defecto.', 'Write the defect.'));
  if (!validLot(draft.lot)) return setErr(t('El lote son 3 a 5 números.', 'The batch is 3 to 5 digits.'));
  const id = nextId(items);
  setState(s => ({ items: [{ id, line: draft.line, lot: draft.lot, defect: draft.defect.trim(), sev: draft.sev, status: 'open', owner: '', action: '', photo: '', at: Date.now() }, ...s.items], log: [{ at: Date.now(), id, tone: 'new' as const, text: `${t('registrada', 'logged')} · ${draft.line} · ${t('lote', 'batch')} ${draft.lot} · ${(es ? draft.sev : SEV_EN[draft.sev]).toUpperCase()}` }, ...s.log].slice(0, 40) }));
  setDraft({ ...draft, lot: '', defect: '' }); setErr(''); setHanded(null);
 }
 async function attach(f: File | undefined) { if (!f) return; try { patch(target.current, { photo: await shrink(f) }); note(target.current, t('evidencia adjunta', 'evidence attached'), 'info'); } catch { setErr(t('No se pudo leer la foto.', 'Could not read the photo.')); } }
 const summary = () => summaryText(items, es);
 async function copy() { try { await navigator.clipboard.writeText(summary()); setCopied(true); } catch { setCopied(false); } }
 const SevIcon = ({ s }: { s: Sev }) => s === 'Crítica' ? <WarningOctagon size={15} weight="fill"/> : s === 'Mayor' ? <Warning size={15} weight="fill"/> : <Info size={15} weight="fill"/>;
 const counts: [Status | 'crit', string, number][] = [['open', label.open, items.filter(i => i.status === 'open').length], ['doing', label.doing, items.filter(i => i.status === 'doing').length], ['closed', label.closed, items.filter(i => i.status === 'closed').length], ['crit', t('Fuera de tiempo', 'Overdue'), late]];

 return <div className="sh">
  <header className="sh-top">
   <div><span className="sh-kicker">{t('Planta de ensamble · Calidad', 'Assembly plant · Quality')}</span><strong>{t('Incidencias del turno', 'Shift incidents')}</strong></div>
   <div className="sh-clock" aria-label={t('Reloj del turno', 'Shift clock')}>
    <span className="sh-time">{clock(now)}</span>
    <span className="sh-shift">{t(`Turno ${shift.name.toLowerCase()}`, `${shift.name} shift`)} · {t(`entrega al ${shift.next} en ${Math.floor(shift.left)} h ${String(Math.round((shift.left % 1) * 60)).padStart(2, '0')} min`, `handover in ${Math.floor(shift.left)} h ${String(Math.round((shift.left % 1) * 60)).padStart(2, '0')} min`)}</span>
    <span className="sh-progress"><i style={{ width: `${shift.progress * 100}%` }}/></span>
   </div>
  </header>

  <dl className="sh-kpis">{counts.map(([k, name, n]) => <div key={k} className={`k-${k}`}><dt>{name}</dt><dd key={n}>{String(n).padStart(2, '0')}</dd></div>)}</dl>
  {stats.avg !== null && <p className="sh-speed"><Clock size={16} weight="fill" aria-hidden="true"/>{t('Cierre promedio', 'Average close')} <b>{fmtHours(stats.avg)}</b><span>{t(`${stats.onTime} de ${stats.n} dentro de tiempo`, `${stats.onTime} of ${stats.n} on time`)}</span>{stats.bySev.filter(([, h]) => h !== null).map(([s, h]) => <em key={s}>{es ? s : SEV_EN[s]} {fmtHours(h!)}</em>)}</p>}

  <form className="sh-new" onSubmit={add}>
   <label>{t('Línea', 'Line')}<select value={draft.line} onChange={e => setDraft({ ...draft, line: e.target.value })}>{['L1', 'L2', 'L3'].map(l => <option key={l}>{l}</option>)}</select></label>
   <label>{t('Lote', 'Batch')}<input value={draft.lot} inputMode="numeric" placeholder="4480" onChange={e => setDraft({ ...draft, lot: e.target.value })}/></label>
   <label className="grow">{t('Defecto', 'Defect')}<input value={draft.defect} placeholder={t('Ej. soldadura incompleta', 'e.g. incomplete weld')} onChange={e => setDraft({ ...draft, defect: e.target.value })}/></label>
   <fieldset className="sh-sevpick"><legend>{t('Severidad', 'Severity')}</legend>{(['Crítica', 'Mayor', 'Menor'] as Sev[]).map(s => <button type="button" key={s} className={`sev-${RANK[s]}`} aria-pressed={draft.sev === s} onClick={() => setDraft({ ...draft, sev: s })}><SevIcon s={s}/>{es ? s : SEV_EN[s]}</button>)}</fieldset>
   <button type="submit" className="sh-log-it">{t('Registrar', 'Log it')}</button>
   {err && <p className="sh-err" role="alert">{err}</p>}
  </form>
  <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={e => { void attach(e.target.files?.[0]); e.target.value = ''; }}/>

  <div className="sh-work">
   <div className="sh-filters" role="group" aria-label={t('Filtrar incidencias', 'Filter incidents')}>
    {['', 'L1', 'L2', 'L3'].map(l => <button type="button" key={l || 'all'} aria-pressed={fLine === l} onClick={() => setFLine(l)}>{l || t('Todas las líneas', 'All lines')}</button>)}
    <span aria-hidden="true"/>
    {(['', 'Crítica', 'Mayor', 'Menor'] as (Sev | '')[]).map(v => <button type="button" key={v || 'any'} aria-pressed={fSev === v} className={v ? `sev-${RANK[v]}` : ''} onClick={() => setFSev(v)}>{v ? (es ? v : SEV_EN[v]) : t('Toda severidad', 'Any severity')}</button>)}
   </div>
   <div className="sh-coltabs" role="tablist" aria-label={t('Columna', 'Column')}>{(['open', 'doing', 'closed'] as Status[]).map(c => <button type="button" role="tab" key={c} aria-selected={tab === c} className={`tab-${c}`} onClick={() => setTab(c)}>{label[c]}<b>{items.filter(i => i.status === c && (!fLine || i.line === fLine) && (!fSev || i.sev === fSev)).length}</b></button>)}</div>
   <div className="sh-board" data-tab={tab}>
    {(['open', 'doing', 'closed'] as Status[]).map(col => {
     const all = items.filter(i => i.status === col && (!fLine || i.line === fLine) && (!fSev || i.sev === fSev)).sort((a, b) => col === 'closed' ? b.at - a.at : RANK[a.sev] - RANK[b.sev] || a.at - b.at); // cerradas: lo más reciente arriba
     const list = more.includes(col) ? all : all.slice(0, PER_COL);
     return <section key={col} className={`sh-col c-${col}${over === col ? ' is-over' : ''}`} aria-label={label[col]}
      onDragOver={e => { if (drag) { e.preventDefault(); setOver(col); } }} onDragLeave={() => setOver(o => o === col ? null : o)}
      onDrop={e => { e.preventDefault(); setOver(null); const i = items.find(x => x.id === drag); if (i) move(i, col); setDrag(null); }}>
      <h3><i aria-hidden="true"/>{label[col]}<span key={all.length}>{all.length}</span></h3>
      {!all.length && <p className="sh-empty">{col === 'closed' ? t('Nada cerrado todavía.', 'Nothing closed yet.') : t('Suelta aquí una incidencia.', 'Drop an incident here.')}</p>}
      {list.map(i => {
       const open = openId === i.id, pct = Math.min(1, age(i) / SLA[i.sev]), overdue = col !== 'closed' && pct >= 1;
       return <article key={i.id} ref={flip(i.id)} className={`sh-card sev-${RANK[i.sev]}${open ? ' is-open' : ''}${overdue ? ' is-late' : ''}${shake === i.id ? ' is-shake' : ''}${drag === i.id ? ' is-drag' : ''}`}
        draggable onDragStart={e => { setDrag(i.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrag(null); setOver(null); }}>
        <button className="sh-card-head" aria-expanded={open} onClick={() => setOpenId(open ? null : i.id)}>
         <span className="sh-row1"><span className="sh-sev"><SevIcon s={i.sev}/>{es ? i.sev : SEV_EN[i.sev]}</span><code>{i.id}</code><DotsSixVertical className="sh-grip" size={16} aria-hidden="true"/></span>
         <strong>{i.defect}</strong>
         <span className="sh-chips"><span>{i.line}</span><span>{t('lote', 'batch')} {i.lot}</span></span>
         {col !== 'closed' && <span className={`sh-sla${overdue ? ' late' : ''}`}><Clock size={13}/><span className="sh-sla-bar"><i style={{ width: `${pct * 100}%` }}/></span><em>{overdue ? t(`fuera de tiempo · ${ago(i.at)}`, `overdue · ${ago(i.at)}`) : `${ago(i.at)} / ${SLA[i.sev]} h`}</em></span>}
         <span className="sh-who">{i.owner ? <i title={i.owner}>{i.owner.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').slice(0, 2)}</i> : <em>{t('sin responsable', 'no owner')}</em>}{i.owner && <small>{i.owner}</small>}{i.photo && <Camera className="sh-cam" size={16} weight="fill" aria-label={t('Con evidencia', 'With evidence')}/>}</span>
        </button>
        {!open && col !== 'closed' && <button type="button" className={`sh-next to-${col === 'open' ? 'doing' : 'closed'}`} onClick={() => move(i, col === 'open' ? 'doing' : 'closed')}>{col === 'open' ? t('Pasar a en curso', 'Move to in progress') : t('Cerrar', 'Close')}<ArrowRight size={14} weight="bold"/></button>}
        {open && col !== 'closed' && <div className="sh-edit">
         <label>{t('Responsable', 'Owner')}<select value={i.owner} onChange={e => { const o = e.target.value; patch(i.id, { owner: o, status: o ? 'doing' : 'open' }); note(i.id, o ? t(`asignada a ${o} · en curso`, `assigned to ${o} · in progress`) : t('sin responsable', 'unassigned'), 'move'); }}><option value="">{t('Sin asignar', 'Unassigned')}</option>{OWNERS.map(o => <option key={o}>{o}</option>)}</select></label>
         <label>{t('Siguiente acción', 'Next action')}<input value={i.action} placeholder={t('¿Qué sigue?', 'What’s next?')} onChange={e => patch(i.id, { action: e.target.value })} onBlur={e => e.target.value && note(i.id, `${t('acción', 'action')}: ${e.target.value}`, 'info')}/></label>
         <div className="sh-evidence">
          {i.photo && i.photo !== 'demo' ? <img src={i.photo} alt={t('Evidencia', 'Evidence')}/> : i.photo ? <span className="sh-demo-photo">{t('foto de ejemplo', 'sample photo')}</span> : null}
          <button type="button" onClick={() => { target.current = i.id; file.current?.click(); }}><Camera size={16}/>{i.photo ? t('Cambiar foto', 'Change photo') : t('Tomar foto de evidencia', 'Take evidence photo')}</button>
         </div>
         <button type="button" className="sh-close" disabled={!i.photo || !i.owner} onClick={() => move(i, 'closed')}>
          {!i.owner ? t('Asigna un responsable para cerrar', 'Assign an owner to close') : !i.photo ? t('Sin evidencia no se cierra', 'No evidence, no closing') : t('Cerrar incidencia', 'Close incident')}</button>
        </div>}
        {open && col === 'closed' && <div className="sh-edit"><p className="sh-closed">{i.owner} · {i.action || t('sin nota', 'no note')}</p>{i.photo && i.photo !== 'demo' && <img className="sh-proof" src={i.photo} alt={t('Evidencia', 'Evidence')}/>}<button type="button" onClick={() => move(i, 'doing')}>{t('Reabrir', 'Reopen')}</button></div>}
       </article>;
      })}
      {all.length > PER_COL && <button type="button" className="sh-more" onClick={() => setMore(m => m.includes(col) ? m.filter(x => x !== col) : [...m, col])}>{more.includes(col) ? t('Ver menos', 'Show fewer') : t(`Ver ${all.length - PER_COL} más`, `Show ${all.length - PER_COL} more`)}</button>}
     </section>;
    })}
   </div>

   <aside className="sh-console" aria-label={t('Bitácora del turno', 'Shift log')}>
    <header><TerminalWindow size={16}/><span>{t('bitácora', 'log')} · {shift.name.toLowerCase()}</span><i/><i/><i/></header>
    <ol ref={consoleEnd} aria-live="polite">
     <li className="sh-prompt"><time>{clock(now)}</time><span>$</span><b className="sh-cursor"/></li>
     {log.map((l, n) => <li key={l.at + l.id + n} className={`t-${l.tone}`}><time>{clock(l.at)}</time><span>{l.id}</span><p>{l.text}</p></li>)}
    </ol>
   </aside>
  </div>

  <div className="sh-hand">
   <button type="button" className="sh-go" onClick={() => { setHanded(new Date().toLocaleTimeString(es ? 'es-MX' : 'en-US', { hour: '2-digit', minute: '2-digit' })); setCopied(false); note('TURNO', t(`entregado con ${pending.length} pendientes`, `handed over with ${pending.length} open`), 'ok'); }}>{t('Entregar turno', 'Hand over shift')}<ArrowRight size={18}/></button>
   <button type="button" className="sh-reset" onClick={() => void exportExcel()}>{t('Exportar Excel', 'Export Excel')}</button>
   <button type="button" className="sh-reset" onClick={() => { const items = sample(); setState({ items, log: sampleLog(items) }); setHanded(null); setOpenId(null); }}>{t('Volver al ejemplo', 'Reset sample')}</button>
   <span className="sh-tip">{t('Arrastra o usa el botón de cada tarjeta.', 'Drag cards or use their button.')}</span>
   {handed && <div className="sh-summary" role="status">
    <header><strong>{t(`Para el turno ${shift.next} · ${handed}`, `For the next shift · ${handed}`)}</strong><span>{t(`${pending.length} pendientes`, `${pending.length} open`)}{orphan ? t(` · ${orphan} sin responsable`, ` · ${orphan} without owner`) : ''}{late ? t(` · ${late} fuera de tiempo`, ` · ${late} overdue`) : ''}</span></header>
    <ol>{pending.map((i, n) => <li key={i.id} style={{ ['--i' as string]: n }} className={i.owner ? '' : 'no-owner'}><span className={`sh-sev sev-${RANK[i.sev]}`}><SevIcon s={i.sev}/>{es ? i.sev : SEV_EN[i.sev]}</span><b>{i.defect}</b><small>{i.id} · {i.line} · {i.owner || t('sin responsable', 'no owner')}{i.action ? ` · ${i.action}` : ''}</small></li>)}</ol>
    {!pending.length && <p>{t('Todo cerrado: turno limpio.', 'Everything closed: clean shift.')}</p>}
    {closedNow.length > 0 && <><p className="sh-sum-sub">{t(`Cerradas con evidencia (${closedNow.length})`, `Closed with evidence (${closedNow.length})`)}</p>
     <ul className="sh-proofs">{closedNow.map(i => <li key={i.id}>{i.photo && i.photo !== 'demo' ? <img src={i.photo} alt={t(`Evidencia de ${i.id}`, `Evidence for ${i.id}`)}/> : <span className="sh-demo-photo">{t('foto', 'photo')}</span>}<b>{i.defect}</b><small>{i.id} · {i.line} · {i.owner}</small></li>)}</ul></>}
    <div className="sh-send"><button type="button" onClick={() => window.print()}>{t('Imprimir o guardar PDF', 'Print or save PDF')}</button><button type="button" onClick={copy}>{copied ? t('Copiado', 'Copied') : t('Copiar resumen', 'Copy summary')}</button><a href={`https://wa.me/?text=${encodeURIComponent(summary())}`} target="_blank" rel="noreferrer">{t('Mandar por WhatsApp', 'Send via WhatsApp')}</a></div>
   </div>}
  </div>
  <p className="sh-note">{t('Se guarda en este navegador: puedes usarlo en un turno real y tomar las fotos con el celular.', 'It is saved in this browser: you can use it on a real shift and take the photos with your phone.')}</p>
 </div>;
}
