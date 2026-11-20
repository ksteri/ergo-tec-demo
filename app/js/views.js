// Screen rendering. Pure functions of (state, ui, sources) -> HTML strings.
import { PERSONS, ROLE_LABEL, ROUTES, EXTERNAL_KIND, SCENARIOS } from './data.js';
import {
  getState, getUi, getSources, guards, person, assessReport, reportUid, seedReports, evalPartner, COMPANIES, ACTIVITIES,
  openDeviations, acceptedReport, currentPackage, openQuestions, formalBlockers, releaseBlockers, nextAction, certAvailable, gapList,
  registerRows, openExclusions, worklist, routeLabel, evidenceSnapshot, hash, addDays,
} from './store.js';
import { fmt } from './export.js';

export const runtime = { zip: {}, busy: null };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attr = o => Object.entries(o).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
const badge = (t, tone = 'neutral') => `<span class="badge ${tone}">${esc(t)}</span>`;
// Reads a form field; seeds the default once so render and click handler agree.
export const F = (key, def) => {
  const f = getUi().forms;
  if (f[key] === undefined && def !== undefined) f[key] = def;
  return f[key] ?? '';
};

// Button with visible reasons when disabled.
function btn(label, act, reasons = [], { kind = 'primary', data = {}, small = false } = {}) {
  const dis = reasons.length > 0;
  return `<div class="act">
    <button class="btn ${kind}${small ? ' sm' : ''}" data-act="${act}" ${attr(data)} ${dis ? 'disabled aria-disabled="true"' : ''}>${label}</button>
    ${dis ? `<ul class="why">${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  </div>`;
}
const docBtn = (file, page, title, label) =>
  `<button class="link" data-act="open-doc" ${attr({ file, page, title })}>${esc(label || title)}${page > 1 ? ` · S. ${page}` : ''}</button>`;
const input = (key, def, ph = '', type = 'text') => `<input class="inp" type="${type}" data-form="${key}" value="${esc(F(key, def))}" placeholder="${esc(ph)}">`;
const textarea = (key, def = '', ph = '') => `<textarea class="inp" rows="2" data-form="${key}" placeholder="${esc(ph)}">${esc(F(key, def))}</textarea>`;
const card = (title, body, { cls = '', aside = '' } = {}) => `<section class="card ${cls}" data-card="${esc(title)}"><header><h3>${title}</h3>${aside}</header>${body}</section>`;
const kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

// ------------------------------------------------------------------ chrome
export function header() {
  const s = getState(), ui = getUi(), p = person(), n = nextAction();
  const rev = ui.revision === 'R1' ? 'R1 / A · historisch freigegeben' : `R2 / B · ${s.release ? 'durch OEM freigegeben' : 'geplant'}`;
  const opts = Object.keys(ROLE_LABEL).map(r => `<optgroup label="${ROLE_LABEL[r]}">${PERSONS.filter(x => x.role === r).map(x =>
    `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)} – ${esc(x.title)}</option>`).join('')}</optgroup>`).join('');
  return `
  <div class="demo-strip">MUSTERPROJEKT / SIMULIERTE SCHNITTSTELLEN · synthetische Daten · keine Konformitätsbewertung · keine Serienfreigabe · Rollen sind simuliert, keine Zugriffskontrolle</div>
  <div class="topbar">
    <div class="brand"><span class="logo">D</span><div><strong>Devoreo</strong><small>Digitale Produktakte</small></div></div>
    <div class="ctx">
      <div class="ctx-item"><small>Projekt</small><strong>UL-01 Untersuchungsliege · Standard</strong></div>
      <div class="ctx-item"><small>Revision</small><strong>${rev}</strong></div>
      <div class="ctx-item"><small>Testdatensatz</small><strong>${esc(SCENARIOS[s.scenario].short)}</strong></div>
      <div class="ctx-item role"><small>Demorolle (${ROLE_LABEL[p.role]})</small>
        <select id="role-select" aria-label="Demorolle">${opts}</select></div>
    </div>
    <button class="next" data-act="next" title="Rolle wechseln und zur Aktion springen">
      <small>Nächster Schritt · ${esc(n.role)}${n.who && n.who !== p.id ? ' · Klick wechselt die Rolle' : ''}</small><strong>${esc(n.text)} →</strong></button>
    <div class="tools">
      <button class="btn ghost sm" data-act="toggle-worklist" title="Offene Aufgaben der aktuellen Demorolle">Arbeitsliste (${worklist().filter(w => w.who === p.id).length})</button>
      <button class="btn ghost sm" data-act="toggle-audit">Verlauf (${s.audit.length})</button>
      ${ui.confirmReset
        ? `<span class="confirm-reset">Nur die Demo-Daten dieses Browsers löschen? <button class="btn secondary sm danger" data-act="reset-confirm">Zurücksetzen</button> <button class="btn ghost sm" data-act="reset-cancel">Abbrechen</button></span>`
        : '<button class="btn ghost sm danger" data-act="reset">Demo zurücksetzen</button>'}
    </div>
  </div>`;
}

const SCREENS = [
  ['akte', '1', 'Projektakte'], ['eingang', '2', 'Eingang & Änderung'], ['matrix', '3', 'Nachweismatrix'],
  ['partner', '4', 'Partner & Zertifikate'], ['pruefung', '5', 'Prüfauftrag & Bericht'], ['uebergabe', '6', 'Übergabe & OEM'], ['service', '7', 'Service & Verlauf'],
];

function screenStatus(id) {
  const s = getState();
  switch (id) {
    case 'akte': return s.release ? 'done' : 'info';
    case 'eingang': return s.tasks.some(t => t.kind === 'qm-r04') ? 'done' : s.inbox.length ? 'work' : 'todo';
    case 'matrix': return s.risk.status === 'closed' ? 'done' : 'gap';
    case 'partner': return s.partner.confirmed ? 'done' : 'todo';
    case 'pruefung': return s.risk.status === 'closed' && !openDeviations().length ? 'done' : openDeviations().length ? 'gap' : s.testOrder ? 'work' : 'todo';
    case 'uebergabe': return s.release ? 'done' : s.packages.length ? 'work' : 'todo';
    case 'service': return s.service?.oemAwareAt ? 'done' : s.service ? 'work' : 'todo';
  }
}

export function nav() {
  const ui = getUi();
  return `<nav class="nav">${SCREENS.map(([id, n, label]) =>
    `<button class="nav-item ${ui.screen === id ? 'active' : ''}" data-act="goto" data-screen="${id}">
      <span class="num">${n}</span><span>${label}</span><i class="dot ${screenStatus(id)}"></i></button>`).join('')}
    <div class="nav-legend"><i class="dot done"></i>erledigt <i class="dot gap"></i>Lücke <i class="dot work"></i>in Arbeit</div>
  </nav>`;
}

export function flash() {
  const f = getUi().flash;
  return f ? `<div class="flash ${f.type}" role="status">${esc(f.text)}<button class="x" data-act="close-flash" aria-label="Schließen">×</button></div>` : '';
}

export function auditDrawer() {
  if (!getUi().auditOpen) return '';
  return `<div class="drawer"><header><h3>Verlauf / Audit-Trail</h3><button class="btn ghost sm" data-act="toggle-audit">Schließen</button></header>${timeline()}</div>`;
}

export function worklistDrawer() {
  if (!getUi().worklistOpen) return '';
  const p = person(), all = worklist();
  const mine = all.filter(w => w.who === p.id);
  const others = PERSONS.filter(x => x.id !== p.id).map(x => [x, all.filter(w => w.who === x.id).length]).filter(([, n]) => n);
  const rows = mine.map(w => `<tr><td><strong>${esc(w.next)}</strong><div class="muted small">${esc(w.reason)}</div></td><td>${esc(w.project)}<br>${esc(w.revision)}</td><td>${esc(w.source)}</td><td>${esc(w.due)}</td>
    <td><button class="btn secondary sm" data-act="open-work" data-screen="${w.screen}" data-card="${esc(w.card)}">Öffnen</button></td></tr>`).join('');
  return `<div class="drawer wide"><header><h3>Arbeitsliste · ${esc(p.name)}</h3><button class="btn ghost sm" data-act="toggle-worklist">Schließen</button></header>
    <p class="muted small">Jede Übergabe landet beim Empfänger: Projekt, Revision, Grund, Quelle, Fälligkeit und nächste Aktion. Demorolle wechseln, um andere Listen zu sehen.</p>
    ${mine.length ? `<table class="tbl"><thead><tr><th>Nächste Aktion / Grund</th><th>Projekt / Revision</th><th>Quelle</th><th>Fällig</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Keine offenen Aufgaben für diese Rolle.</p>'}
    ${others.length ? `<p class="muted small">Offen bei anderen: ${others.map(([x, n]) => `${esc(x.name)} (${n})`).join(' · ')}</p>` : ''}</div>`;
}

function timeline(limit) {
  const items = [...getState().audit].reverse().slice(0, limit);
  if (!items.length) return '<p class="muted">Noch keine Einträge.</p>';
  return `<ol class="timeline">${items.map(a => `<li class="${a.internal ? 'internal' : ''}">
    <time>${fmt(a.ts)}</time><div><strong>${esc(a.action)}</strong> · ${esc(a.object)}
    <div class="muted">${esc(a.actor)} (${esc(a.title)})${a.version ? ` · Version ${esc(a.version)}` : ''}${a.internal ? ' · intern' : ''}</div>
    ${a.detail ? `<div>${esc(a.detail)}</div>` : ''}</div></li>`).join('')}</ol>`;
}

// ------------------------------------------------------------------ 1 Projektakte
function bomTable(rows, highlight = '020', other) {
  return `<table class="tbl"><thead><tr><th>Pos.</th><th>Artikel</th><th>Bezeichnung</th><th>Menge</th><th>Lieferant</th></tr></thead><tbody>
  ${rows.map(r => {
    const o = other?.find(x => x.position === r.position);
    const changed = o && o.article_id !== r.article_id;
    return `<tr class="${changed || (!other && r.position === highlight && false) ? 'changed' : ''}"><td>${r.position}</td><td>${changed ? `<mark>${r.article_id}</mark>` : r.article_id}</td><td>${changed ? `<mark>${esc(r.description)}</mark>` : esc(r.description)}</td><td>${r.quantity}</td><td>${esc(r.supplier)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function processSteps() {
  const s = getState(), pkg = currentPackage();
  const steps = [
    ['PCN übernommen', s.inbox.some(m => m.kind === 'pcn')], ['Zuordnung bestätigt', s.change.confirmed], ['Auswirkung bewertet', s.impact.confirmed],
    ['Prüfauftrag', !!s.testOrder], ['R-04 Nachweis angenommen', s.risk.status === 'closed'], ['Keine offene Abweichung', !openDeviations().length && s.risk.status === 'closed'],
    ['Pflichtpunkte belegt / ausgeschlossen', !openExclusions().length], ['Partner bestätigt', s.partner.confirmed], ['Formales Paket', !!pkg], ['OEM-Annahme', !!pkg?.acceptance],
    ['RA-Weg bestätigt', ['internal_confirmed', 'external_fulfilled'].includes(s.route.status)], ['OEM-Freigabe R2/B', !!s.release], ['Service-Zeitsprung', !!s.service],
  ];
  return `<ol class="steps">${steps.map(([l, ok]) => `<li class="${ok ? 'ok' : ''}"><i></i>${l}</li>`).join('')}</ol>`;
}

function preconfirmedList() {
  const rows = registerRows();
  const n = st => rows.filter(r => r.status === st).length;
  return `<div class="preconf"><div class="preconf-head">REGELREGISTER MDR ANHANG I – 23 ABSCHNITTE · VORBESTÄTIGTE PUNKTE GELTEN NUR FÜR DEN SYNTHETISCHEN DEMOFALL</div>
  ${kv([['Nachweis (Nr. 20.1 → R-04)', rows.find(r => r.no === 20).status === 'nachweis' ? badge('belegt', 'ok') : badge('offen', 'bad')],
    ['Vorbestätigt (Demo)', `${n('vorbestätigt')} Abschnitte`], ['Nicht anwendbar (begründet)', `${n('nicht anwendbar')} Abschnitte`],
    ['Offen', `${openExclusions().length} Ausschlussvorschläge ohne QM-Bestätigung`]])}
  <button class="link" data-act="goto" data-screen="matrix">Register in der Nachweismatrix öffnen</button></div>`;
}

const REG_TONE = { nachweis: 'ok', 'nicht anwendbar': 'neutral', vorbestätigt: 'neutral', offen: 'bad' };
function registerCard() {
  const ui = getUi(), filter = ui.regFilter || 'alle';
  const rows = registerRows();
  const shown = rows.filter(r => filter === 'alle' || r.status === filter || (filter === 'offen' && r.status === 'offen'));
  const filters = [['alle', 'Alle'], ['offen', 'Offen'], ['nicht anwendbar', 'Nicht anwendbar'], ['vorbestätigt', 'Vorbestätigt'], ['nachweis', 'Nachweis']]
    .map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" data-act="reg-filter" data-filter="${k}">${l} (${k === 'alle' ? rows.length : rows.filter(r => r.status === k).length})</button>`).join('');
  const body = shown.map(r => {
    const key = `ex_${r.no}`;
    let detail = '';
    if (r.demo === 'r04') detail = `Nr. 20.1 → R-04 → PA-04 → ${acceptedReport() ? `${acceptedReport().id} v${acceptedReport().version}` : 'Nachweis offen'} <span class="muted small">(übrige Punkte von Nr. 20 vorbestätigt)</span>`;
    else if (r.status === 'vorbestätigt') detail = '<span class="muted small">Nur für den synthetischen Demofall vorbestätigt – keine Konformitätsaussage.</span>';
    else if (r.status === 'nicht anwendbar') detail = `${esc(r.exclusion.reason)}<div class="muted small">Bestätigt: ${esc(r.exclusion.by)}, ${fmt(r.exclusion.at)}</div>`;
    else detail = `<div class="muted small">Ausschluss vorgeschlagen (Entwicklung). Fachliche Bestätigung mit Begründung erforderlich.</div>
      ${textarea(key, r.na)}${btn('Ausschluss bestätigen', 'exclude-req', guards.excludeReq(r.no, F(key, r.na)), { data: { no: r.no }, small: true })}`;
    return `<tr><td>${r.no}</td><td>${esc(r.title)}<div class="muted small">Kap. ${r.ch}</div></td><td>${badge(r.status, REG_TONE[r.status])}</td><td>${detail}</td></tr>`;
  }).join('');
  return card('Regelregister MDR Anhang I', `
    <p class="muted small">Navigation über die 23 Abschnitte von Anhang I (Kurzbezeichnungen). Durchgängig bis zum Prüfnachweis verknüpft ist nur Nr. 20.1. Aus den Musterdaten wird keine vollständige Konformitätsbewertung abgeleitet.</p>
    <div class="seg">${filters}</div>
    <div class="table-scroll"><table class="tbl reg"><thead><tr><th>Nr.</th><th>Abschnitt</th><th>Status</th><th>Verknüpfung / Begründung</th></tr></thead><tbody>${body || '<tr><td colspan="4" class="muted">Keine Einträge für diesen Filter.</td></tr>'}</tbody></table></div>
    ${openExclusions().length ? `<div class="row">${btn(`Alle ${openExclusions().length} Vorschläge mit ihrer Begründung bestätigen`, 'exclude-all', guards.excludeAll(), { kind: 'secondary' })}</div>` : ''}`);
}

function scenarioCard() {
  const s = getState(), ui = getUi();
  return card('Testdatensatz', `${Object.entries(SCENARIOS).map(([k, sc]) => `<div class="scenario ${s.scenario === k ? 'on' : ''}">
      <strong>${esc(sc.label)}</strong> ${s.scenario === k ? badge('aktiv', 'ok') : ''}<p class="muted small">${esc(sc.text)}</p>
      ${s.scenario === k ? '' : ui.confirmScenario === k
        ? `<span class="confirm-reset">Demo mit diesem Datensatz neu starten? <button class="btn secondary sm danger" data-act="scenario-confirm" data-scenario="${k}">Neu starten</button> <button class="btn ghost sm" data-act="reset-cancel">Abbrechen</button></span>`
        : `<button class="btn ghost sm" data-act="pick-scenario" data-scenario="${k}">Zu diesem Datensatz wechseln</button>`}</div>`).join('')}`);
}

export function screenAkte() {
  const s = getState(), ui = getUi(), src = getSources();
  const tabs = `<div class="seg">${['R1', 'R2'].map(r => `<button class="${ui.revision === r ? 'on' : ''}" data-act="set-revision" data-rev="${r}">${r === 'R1' ? 'R1 / A – historisch' : 'R2 / B – geplant'}</button>`).join('')}</div>`;
  if (ui.revision === 'R1') {
    const pb17 = seedReports().find(r => r.id === 'PB-17');
    return `<div class="page-head"><h2>Projektakte</h2>${tabs}</div>
      <div class="readonly">Historisch freigegebener Stand R1 / Hubantrieb A – schreibgeschützt. Bleibt auch nach Änderungen an R2 unverändert.</div>
      <div class="grid2">
        ${card('Konfiguration R1', `${kv([['Status', badge('historisch freigegeben', 'ok')], ['Hubantrieb', 'A (MH-A), Pos. 020'], ['Stückliste', 'data/BOM_R1.csv']])}${bomTable(src.bom.R1)}`)}
        ${card('Nachweis R-04 (historisch)', `${kv([
          ['Anforderung', 'MDR Anhang I 20.1'], ['Risiko', 'R-04 Unbeabsichtigtes Absenken'], ['Bericht', `${pb17.id} v${pb17.version} – ${pb17.document_status}, ${pb17.result}`],
          ['Geprüfte Konfiguration', `${pb17.revision} / ${pb17.part}`], ['Gültigkeit', badge('nur R1/A', 'neutral')]])}
          <p>${docBtn(pb17.file, 2, 'PB-17 v1.0 – geprüfte Konfiguration', 'PB-17 öffnen')}</p>`)}
      </div>`;
  }
  const closed = s.risk.status === 'closed', acc = acceptedReport();
  return `<div class="page-head"><h2>Projektakte</h2>${tabs}</div>
    <div class="grid2">
      ${card('Konfiguration R2 (geplant)', `${kv([['Status', s.release ? badge(`durch OEM freigegeben (${s.release.packageId})`, 'ok') : badge('geplant – nicht freigegeben', 'warn')], ['Änderung', 'PCN-01: Pos. 020 MH-A → MH-B'], ['Stückliste', 'data/BOM_R2.csv']])}${bomTable(src.bom.R2, '020', src.bom.R1)}`)}
      ${card('Nachweisstatus R2/B', `
        ${closed ? `<div class="evidence ok"><strong>R-04 · Nachweis angenommen</strong><span>${acc.id} v${acc.version} (R2/B, Endfassung, Bestanden) · QM: ${esc(s.risk.closedBy)}, ${fmt(s.risk.at)}</span></div>`
          : `<button class="evidence gap" data-act="open-gap"><strong>R-04 · Nachweis fehlt für R2/B</strong><span>MDR Anh. I 20.1 → Halteverhalten → PA-04. Vorhanden ist nur PB-17 (R1/A). Klicken: Matrix und PB-17 Seite 2 öffnen.</span></button>`}
        ${openDeviations().map(d => `<div class="evidence gap"><strong>${d.id} · blockierende Abweichung</strong><span>${esc(d.title)} – ${esc(d.status)}</span></div>`).join('')}
        <p class="muted small">Geschlossen wird nur der Demo-Nachweispunkt R-04, nicht alle Produktrisiken.</p>
        ${preconfirmedList()}`)}
    </div>
    <div class="grid2">${card('Ablauf R2/B', processSteps())}${scenarioCard()}</div>`;
}

// ------------------------------------------------------------------ 2 Eingang
export function screenEingang() {
  const s = getState(), src = getSources(), m = src.eml;
  const imported = s.inbox.find(x => x.messageId === m.messageId);
  const dupCount = s.deliveries.filter(d => d.messageId === m.messageId).length;
  const map = s.change.mapping;
  const posSel = F('mapPos', map?.position || '020');
  const mapClar = s.clarifications.filter(c => c.kind === 'zuordnung');
  const task = s.tasks.find(t => t.kind === 'qm-r04');
  const artClar = s.clarifications.filter(c => c.kind === 'artikel');
  const clarTable = list => `<table class="tbl"><tbody>${list.map(c => `<tr><td>${c.id}</td><td>${esc(c.article || c.source)}</td><td>${esc(c.reason)}${c.resolution ? `<div class="muted small">Geklärt: ${esc(c.resolution)}</div>` : ''}</td><td>${esc(c.owner || '')}</td><td>${badge(c.status, c.status === 'geklärt' ? 'ok' : 'warn')}</td></tr>`).join('')}</tbody></table>`;

  const inbox = card('Posteingang (simuliert)', `
    <div class="mail ${imported ? 'imported' : ''}">
      <div class="mail-head"><strong>${esc(m.subject)}</strong>${imported ? badge('übernommen', 'ok') : badge('neu', 'warn')}</div>
      ${kv([['Von', esc(m.from)], ['An', esc(m.to)], ['Datum', esc(m.date)], ['Message-ID', `<code>${esc(m.messageId)}</code>`], ['Quelle', '<code>documents/PCN-01.eml</code>']])}
      <p class="mail-body">${esc(m.body)}</p>
      <div class="attach"><span>Anlagen:</span>
        ${docBtn(src.seed.change.source, 1, 'PCN-01 Lieferantenmitteilung', 'PCN-01_Lieferantenmitteilung.pdf')}
        ${docBtn(src.seed.change.attachment, 1, 'DB-B Datenblatt Hubantrieb B', 'DB-B_Datenblatt.pdf')}</div>
    </div>
    <div class="row">
      ${btn(imported ? 'Erneut zustellen (Duplikat testen)' : 'E-Mail übernehmen', 'deliver-pcn', guards.importPcn(), { kind: imported ? 'secondary' : 'primary' })}
      ${btn('Negativtest: unbekannter Artikel', 'deliver-unknown', guards.importPcn(), { kind: 'secondary' })}
    </div>
    <p class="muted small">Zustellungen: ${dupCount} · Vorgänge: ${imported ? 1 : 0} (Deduplizierung über Message-ID). Kein echter Mailzugang.</p>
    ${artClar.length ? `<h4>Klärungsliste</h4>${clarTable(artClar)}` : ''}`);

  const mapping = card('Zuordnung zur Stückliste', map ? `
    <div class="suggest"><span class="muted">Vorschlag (Regel):</span> ${esc(map.rule)}</div>
    ${kv([['Altartikel', map.old], ['Vorgeschlagener Nachfolger', map.proposed], ['Hinweis', 'PCN-01 schlägt B vor – keine Einbaufreigabe, keine Autorisierung.']])}
    ${kv([['Projekt / Variante', 'UL-01 / Standard'], ['Vorgeschlagene Position', `${map.position} (Stückliste R1)`]])}
    ${s.change.confirmed ? `<div class="done-note">${map.corrected ? `Korrigiert von Position ${map.correctedFrom} auf ${map.position}: „${esc(map.correctionReason)}“<br>` : ''}Bestätigt durch ${esc(map.confirmedBy)}, ${fmt(map.at)} – Position ${map.position}. Der Änderungsfall liegt bei der Entwicklung.</div>`
      : `${s.change.status === 'in_clarification' ? `<div class="evidence gap"><strong>In Klärung</strong><span>Die Zuordnung bleibt offen, bis sie bestätigt oder korrigiert wird.</span></div>` : ''}
        <div class="row">${btn(`Zuordnung bestätigen (Pos. ${map.position})`, 'confirm-mapping', guards.confirmMapping())}</div>
        <details class="sub" data-open-key="open_mapFix" ${F('open_mapFix') ? 'open' : ''}><summary>Zuordnung korrigieren</summary>
          <label class="lbl">Richtige Position
            <select class="inp" data-form="mapPos">${src.bom.R1.map(r => `<option value="${r.position}" ${r.position === posSel ? 'selected' : ''}>${r.position} – ${r.article_id} ${esc(r.description)}</option>`).join('')}</select></label>
          <label class="lbl">Begründung der Korrektur${textarea('mapReason', '', 'z. B. Artikel ist laut Konstruktion an einer anderen Position verbaut')}</label>
          ${btn('Korrektur speichern', 'correct-mapping', guards.correctMapping(posSel, F('mapReason')), { kind: 'secondary', small: true })}</details>
        <details class="sub" data-open-key="open_mapClar" ${F('open_mapClar') ? 'open' : ''}><summary>Zuordnung unklar – Klärungsauftrag</summary>
          <label class="lbl">Was ist unklar?${textarea('mapClarify', '', 'z. B. Meldung nennt keine Variante; MH-A könnte in mehreren Varianten verbaut sein')}</label>
          ${btn('Klärungsauftrag anlegen', 'clarify-mapping', guards.clarifyMapping(F('mapClarify')), { kind: 'secondary', small: true })}</details>`}
    ${mapClar.length ? `<h4>Klärungsaufträge Zuordnung</h4>${clarTable(mapClar)}` : ''}` : '<p class="muted">Erst nach Übernahme einer Mitteilung.</p>');

  const diff = card('Stücklistenvergleich R1 ↔ R2', `<div class="diff">
    <div><h4>R1 / historisch</h4>${bomTable(src.bom.R1, '020', src.bom.R2)}</div>
    <div><h4>R2 / geplant</h4>${bomTable(src.bom.R2, '020', src.bom.R1)}</div></div>`);

  const impact = card('Auswirkungsbewertung (Entwicklung)', s.impact.confirmed
    ? `<div class="done-note">Bestätigt durch ${esc(s.impact.by)}, ${fmt(s.impact.at)}</div>${kv([['Betroffen', 'R-04, PA-04'], ['Bewertung', esc(s.impact.text)]])}`
    : `${kv([['Betroffenes Risiko', `R-04 Unbeabsichtigtes Absenken ${docBtn('documents/R-04_Risikomanagementauszug.pdf', 1, 'R-04 Risikomanagementauszug', 'Auszug')}`], ['Prüfanweisung', `PA-04 ${docBtn('documents/PA-04_Pruefanweisung.pdf', 1, 'PA-04 Prüfanweisung', 'öffnen')}`], ['Bestehender Nachweis', 'PB-17 belegt nur R1/A → für R2/B nicht verwendbar']])}
      <label class="lbl">Begründung${textarea('impactText', 'Pos. 020 Hubantrieb ändert sich (MH-A → MH-B). Halteverhalten unter Last (R-04) ist für R2/B neu nachzuweisen; PB-17 gilt nur für R1/A.')}</label>
      ${btn('Auswirkungsbewertung bestätigen', 'confirm-impact', guards.confirmImpact({ text: F('impactText') }))}`);

  const qmTask = card('QM-Aufgabe', task
    ? kv([['Aufgabe', `${task.id} – ${esc(task.title)}`], ['Verantwortlich', esc(task.owner)], ['Quelle', esc(task.source)], ['Grund', esc(task.reason)], ['Fällig', esc(task.due)], ['Status', badge(task.status, task.status === 'erledigt' ? 'ok' : 'warn')], ['Erstellt', `${esc(task.createdBy)}, ${fmt(task.at)}`]])
    : `${kv([['Verantwortlich', 'Dr. M. Weber (QM)'], ['Quelle', 'PCN-01 / Auswirkungsbewertung']])}
      <label class="lbl">Grund${textarea('taskReason', 'Neuer Haltenachweis nach PA-04 für R2/B erforderlich (R-04).')}</label>
      <label class="lbl">Fällig am${input('taskDue', '2026-12-04', '', 'date')}</label>
      ${btn('QM-Aufgabe erstellen', 'create-task', guards.createQmTask({ reason: F('taskReason'), due: F('taskDue', '2026-12-04') }))}`);

  return `<div class="page-head"><h2>Eingang & Änderung</h2><span class="muted">PCN-01 · MusterHub → Ergo-Tec</span></div>
    <div class="grid2">${inbox}${mapping}</div>${diff}<div class="grid2">${impact}${qmTask}</div>`;
}

// ------------------------------------------------------------------ 3 Matrix
export function screenMatrix() {
  const s = getState();
  const acc = acceptedReport();
  const found = acc || seedReports().find(r => r.id === 'PB-17');
  const ok = !!acc;
  const cmp = [['Revision', 'R2', found.revision], ['Hubantrieb', 'B', found.part], ['Artikel', 'MH-B', found.part === 'A' ? 'MH-A' : 'MH-B'], ['Dokumentstatus', 'Endfassung', found.document_status], ['Ergebnis', 'Bestanden', found.result], ['QM-Annahme', 'ja', acc ? 'ja' : 'nein']];
  const chain = [['Anforderung', 'MDR Anhang I 20.1', 'mechanische Risiken'], ['Risiko', 'R-04', 'Unbeabsichtigtes Absenken'], ['Schutzmaßnahme', 'Halteverhalten', 'unter Last'], ['Prüfanweisung', 'PA-04', 'Halteversuch'], ['Nachweis', ok ? `${acc.id} v${acc.version}` : 'fehlt für R2/B', ok ? 'angenommen' : 'gefunden: PB-17 (R1/A)']];
  return `<div class="page-head"><h2>Nachweismatrix</h2><span class="muted">Anforderung → Risiko → Schutzmaßnahme → Prüfanweisung → Bericht → Fachentscheid</span></div>
    ${card('Nachweiskette', `<div class="chain">${chain.map(([k, v, d], i) => `<div class="link-box ${i === 4 ? (ok ? 'ok' : 'gap') : ''}"><small>${k}</small><strong>${esc(v)}</strong><span>${esc(d)}</span></div>`).join('<span class="arrow">→</span>')}</div>
      <div class="row">${docBtn('documents/R-04_Risikomanagementauszug.pdf', 1, 'R-04 Risikomanagementauszug', 'R-04 Auszug')} ${docBtn('documents/PA-04_Pruefanweisung.pdf', 1, 'PA-04 Prüfanweisung', 'PA-04')} ${docBtn(found.file, 2, `${found.id} v${found.version} – geprüfte Konfiguration`, `${found.id} v${found.version}`)}</div>`)}
    <div class="grid2">
      ${card(`Erwartet R2/B vs. gefunden ${found.revision}/${found.part}`, `<table class="tbl cmp"><thead><tr><th>Merkmal</th><th>Erwartet</th><th>Gefunden (${found.id} v${found.version})</th></tr></thead><tbody>
        ${cmp.map(([k, e, f]) => `<tr class="${e === f ? '' : 'mismatch'}"><td>${k}</td><td>${e}</td><td>${esc(f)} ${e === f ? '✓' : '✗'}</td></tr>`).join('')}</tbody></table>`)}
      ${card('Bewertung', ok
        ? `<div class="evidence ok"><strong>R-04 geschlossen (nur Demo-Nachweispunkt)</strong><span>${acc.id} v${acc.version} von ${esc(acc.review.by)} angenommen: „${esc(acc.review.reason)}“</span></div>`
        : `<div class="evidence gap"><strong>Warum der Nachweis nicht passt</strong><span>PB-17 ist eine gültige Endfassung mit „Bestanden“ – aber für R1 mit Hubantrieb A (Seite 2, „Geprüfte Konfiguration“). R2 verbaut Hubantrieb B (Pos. 020, PCN-01). Das Halteverhalten hängt vom Antrieb ab; der alte Bericht kann R-04 für R2/B daher nicht belegen. Benötigt: PB nach PA-04 für R2/B, Endfassung, Bestanden, von autorisiertem QM angenommen.</span></div>
          ${btn('Zu Prüfauftrag & Bericht', 'goto', [], { kind: 'secondary', data: { screen: 'pruefung' } })}`)}
    </div>
    ${registerCard()}`;
}

// ------------------------------------------------------------------ 4 Partner
function partnerResult(ev, avail, confirmed) {
  if (ev.status === 'incomplete') return `<p class="muted">${esc(ev.reasons[0])}</p>`;
  const list = ev.checks.length ? `<ul class="checks">${ev.checks.map(c => `<li class="${c.ok ? 'ok' : 'no'}"><i></i><span><strong>${esc(c.label)}</strong><br><span class="muted small">${esc(c.text)}</span></span></li>`).join('')}</ul>` : '';
  if (ev.status === 'match') {
    const src = avail ? docBtn('documents/Ergo-Tec_Public_Certificates.pdf', ev.cert.page, `Zertifikat ${ev.cert.id}`, 'Zertifikat ansehen')
      : `<a href="${esc(ev.cert.url)}" target="_blank" rel="noopener">Original S. ${ev.cert.page}</a> (lokal nicht verfügbar)`;
    return `${list}<div class="evidence ok"><strong>Alle Prüfpunkte erfüllt</strong><span>${confirmed ? 'Von QM bestätigt.' : 'Nächster Schritt: QM prüft das Zertifikat und bestätigt mit Begründung.'} ${src}</span></div>`;
  }
  const next = ev.checks.length
    ? 'Andere Auswahl treffen. Für die Fertigung von UL-01 passt laut Quelle nur ISO 13485 Z-25-014-S am Standort Gewerbestraße 2. Soll der Partner selbst nachliefern, Klärungsfall anlegen.'
    : 'Ergo-Tec GmbH als Hersteller wählen. Fragen an MusterHub laufen über einen Klärungsfall.';
  return `${list}<div class="evidence gap"><strong>Nicht bestätigbar</strong><span>${ev.checks.length ? '' : `${esc(ev.reasons[0])}<br>`}${next}</span></div>`;
}

export function screenPartner() {
  const s = getState(), src = getSources();
  const sel = s.partner.selection, ev = evalPartner(sel);
  const lock = s.partner.confirmed ? 'disabled' : '';
  const company = COMPANIES.find(c => c.id === sel.company);
  const sites = company ? company.sites.map(id => src.seed.partners.find(p => p.id === id)) : [];
  const select = (field, opts, ph) => `<select class="inp" data-partner="${field}" ${lock}><option value="">${ph}</option>${opts.map(([v, l]) => `<option value="${v}" ${sel[field] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const certs = sel.company === 'ERGO' ? src.seed.certificates.map(c => [c.id, `${c.standard} – ${c.id} (${c.standard === 'ISO 13485' ? 'Medizinprodukte' : 'Maschinenbau'})`]) : [];
  const avail = certAvailable();
  const clar = s.clarifications.filter(c => c.kind === 'partner');
  const certCard = card('Zertifikatsquelle (öffentlich)', `
    ${kv([['Lokale Datei', avail ? `${badge('vorhanden', 'ok')} <code>documents/Ergo-Tec_Public_Certificates.pdf</code>` : `${badge('nicht verfügbar', 'bad')} keine Ersatzdatei – kein erzeugtes Zertifikat`],
      ['Original', `<a href="${esc(src.certUrl)}" target="_blank" rel="noopener">${esc(src.certUrl)}</a>`],
      ['Seiten', avail ? `${docBtn('documents/Ergo-Tec_Public_Certificates.pdf', 1, 'Ergo-Tec Zertifikat ISO 9001 (S. 1)', 'S. 1 ISO 9001')} ${docBtn('documents/Ergo-Tec_Public_Certificates.pdf', 3, 'Ergo-Tec Zertifikat ISO 13485 (S. 3)', 'ISO 13485')}` : 'nur über Original-Link'],
      ['Verifizierung', 'Keine aktuelle unabhängige Prüfung der Gültigkeit durch den Prototyp.']])}
    <label class="switch"><input type="checkbox" data-act="toggle-cert-missing" ${s.certMode.simulateMissing ? 'checked' : ''}> Testschalter: fehlende lokale Datei simulieren</label>`);
  return `<div class="page-head"><h2>Partner & Zertifikate</h2><span class="muted">Wer fertigt UL-01, und deckt dessen Zertifikat genau das ab?</span></div>
    <div class="grid2">
      ${card('Auswahl', `
        <div class="form-grid">
          <label class="lbl">Unternehmen${select('company', COMPANIES.map(c => [c.id, c.name]), '– wählen –')}</label>
          <label class="lbl">Standort${select('site', sites.map(p => [p.id, `${p.address} (${p.demo_activity || 'Lieferant'})`]), '– wählen –')}</label>
          <label class="lbl">Tätigkeit${select('activity', ACTIVITIES.map(a => [a, a === 'Fertigung' ? 'Fertigung (Produktion UL-01)' : a]), '– wählen –')}</label>
          <label class="lbl">Zertifikat${select('cert', certs, certs.length ? '– wählen –' : 'kein Zertifikat in der Quelle')}</label>
        </div>
        <p class="muted small">QM bestätigt den Fertigungspartner für die Akte. Dafür muss ein Zertifikat aus der Quelle die Fertigung von UL-01 an diesem Standort abdecken.</p>
      `)}
      ${card('Prüfung', partnerResult(ev, avail, s.partner.confirmed) + `
        ${s.partner.confirmed ? `<div class="done-note">Bestätigt durch ${esc(s.partner.confirmedBy)}, ${fmt(s.partner.at)}: ${esc(s.partner.reason)}</div>`
          : `<label class="lbl">QM-Begründung${textarea('partnerReason', 'ISO 13485 Z-25-014-S deckt Produktion von Patienten-Positioniersystemen am Standort Gewerbestraße 2 ab (Quelle S. 3).')}</label>
          <div class="row">${btn('Partner bestätigen (QM)', 'partner-confirm', guards.partnerConfirm(F('partnerReason')))}
          ${ev.status === 'clarify' ? btn('Klärungsfall anlegen', 'partner-clarify', guards.partnerClarify(), { kind: 'secondary' }) : ''}</div>`}
        <p class="muted small">Ein Zertifikat belegt das Qualitätsmanagement des Partners, nicht die Sicherheit von UL-01. Risiko R-04 bleibt davon unberührt.</p>
        ${clar.length ? `<h4>Klärungsfälle</h4><table class="tbl"><tbody>${clar.map(c => `<tr><td>${c.id}</td><td>${esc(c.reason)}</td><td>${badge(c.status, 'warn')}</td></tr>`).join('')}</tbody></table>` : ''}`)}
    </div>
    ${certCard}`;
}

// ------------------------------------------------------------------ 5 Prüfung
function reportCard(rep) {
  const a = assessReport(rep);
  const key = `rev_${rep.uid}`;
  const reason = F(key, '');
  const rv = rep.review;
  const dev = getState().deviations.find(d => d.reportUid === rep.uid);
  return `<article class="report ${rv?.status === 'angenommen' ? 'accepted' : a.suitable ? '' : 'unsuitable'}">
    <header><div><strong>${rep.id} v${rep.version}</strong> <span class="muted">${esc(rep.file.split('/').pop())}</span></div>
      <div>${badge(`Dokument: ${rep.document_status}`, rep.document_status === 'Endfassung' ? 'neutral' : 'warn')} ${badge(`Ergebnis: ${rep.result}`, rep.result === 'Bestanden' ? 'ok' : rep.result === 'Offen' ? 'warn' : 'bad')} ${badge(`Review: ${rv ? rv.status : 'ausstehend'}`, rv?.status === 'angenommen' ? 'ok' : rv ? 'bad' : 'warn')}</div></header>
    <div class="report-body">
      <div>
        <div class="sim-label">simulierter Import / vorbereitete Metadaten (seed.json) – keine KI-Extraktion</div>
        ${kv([['Konfiguration', `${rep.revision} / ${rep.part}`], ['Version', rep.version], ['Auftrag / Prüfpunkt', 'PA-04 / R-04'], ['Importiert', `${esc(rep.importedBy)}, ${fmt(rep.importedAt)}`], ['Vorschau', `${docBtn(rep.file, 2, `${rep.id} v${rep.version} – Seite 2`, 'Konfiguration & Ergebnis')} · ${docBtn(rep.file, 1, `${rep.id} v${rep.version}`, 'Deckblatt')}`]])}
        ${dev ? `<div class="evidence gap"><strong>${dev.id} angelegt</strong><span>${esc(dev.title)}</span></div>` : ''}
      </div>
      <div class="review">
        <h4>Regelprüfung für R-04</h4>
        ${a.suitable ? '<p class="ok-text">Formal geeignet: R2/B, Endfassung, Bestanden. Fachliche QM-Bewertung erforderlich.</p>' : `<ul class="issues">${a.issues.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>`}
        ${rv ? `<div class="done-note">${rv.status === 'angenommen' ? 'Angenommen' : 'Als nicht geeignet dokumentiert'} · ${esc(rv.by)} (${rv.role}) · ${fmt(rv.at)} · Version ${rv.version}<br>„${esc(rv.reason)}“</div>`
          : `<label class="lbl">Begründung QM${textarea(key, '', a.suitable ? 'z. B. Konfiguration R2/B und Kriterium nach PA-04 nachvollziehbar dokumentiert.' : 'z. B. nicht geeignet, weil …')}</label>
          <div class="row">${btn('Als Nachweis für R-04 annehmen', 'accept-report', guards.acceptReport(rep, reason), { data: { uid: rep.uid } })}
          ${btn('Nicht geeignet dokumentieren', 'reject-report', guards.rejectReport(rep, reason), { kind: 'secondary', data: { uid: rep.uid } })}</div>`}
      </div>
    </div></article>`;
}

export function screenPruefung() {
  const s = getState();
  const task = s.tasks.find(t => t.kind === 'qm-r04');
  const pick = F('labPick', 'PB-18@2.0');
  const labOpts = seedReports().map(r => {
    const uid = reportUid(r);
    const done = s.reports.some(x => x.uid === uid);
    return `<label class="pick ${pick === uid ? 'on' : ''}"><input type="radio" name="lab" value="${uid}" data-form="labPick" data-rerender="1" ${pick === uid ? 'checked' : ''}>
      <strong>${r.id} v${r.version}</strong><span>${r.revision}/${r.part} · ${r.document_status} · ${r.result}</span><small>${esc(r.file.split('/').pop())}${done ? ' · importiert' : ''}</small></label>`;
  }).join('');
  const owners = PERSONS.filter(x => ['eng', 'qm1', 'qm2'].includes(x.id));
  const devs = s.deviations.map(d => {
    const ck = `corr_${d.id}`, ek = `eff_${d.id}`, ro = `rwo_${d.id}`, rt = `rwt_${d.id}`, rd = `rwd_${d.id}`;
    const rwF = { owner: F(ro, 'eng'), text: F(rt, 'Ursache des nicht bestandenen Halteversuchs klären, Haltebremse MH-B nacharbeiten, Prüfmuster neu aufbauen'), due: F(rd, addDays(d.at, 10)) };
    return `<article class="deviation ${d.status === 'geschlossen' ? 'closed' : ''}">
      <header><strong>${d.id}</strong> ${esc(d.title)} ${badge(d.status, d.status === 'geschlossen' ? 'ok' : 'bad')} ${d.status !== 'geschlossen' ? badge('blockiert Übergabe & Freigabe', 'bad') : ''}</header>
      <p class="muted small">Ablauf: offen → in Nacharbeit → Korrektur dokumentiert → Wirksamkeit geprüft → geschlossen</p>
      <div class="grid3 tight">
        <div><h4>1 · Nacharbeit zuweisen</h4>${d.rework ? `<div class="done-note">${esc(d.rework.owner)} · fällig ${esc(d.rework.due)}<br>${esc(d.rework.text)}<br><span class="muted">${esc(d.rework.by)}, ${fmt(d.rework.at)}</span></div>`
          : `<label class="lbl">Verantwortlich<select class="inp" data-form="${ro}">${owners.map(o => `<option value="${o.id}" ${rwF.owner === o.id ? 'selected' : ''}>${esc(o.name)} – ${esc(o.title)}</option>`).join('')}</select></label>
            <label class="lbl">Was ist nachzuarbeiten?${textarea(rt)}</label><label class="lbl">Fällig am${input(rd, rwF.due, '', 'date')}</label>
            ${btn('Nacharbeit zuweisen', 'assign-rework', guards.assignRework(d, rwF), { data: { id: d.id }, small: true })}`}</div>
        <div><h4>2 · Korrekturmaßnahme</h4>${d.correction ? `<div class="done-note">${esc(d.correction.text)}<br>${esc(d.correction.by)}, ${fmt(d.correction.at)}</div>`
          : `${textarea(ck, '', 'z. B. Haltebremse MH-B justiert, Prüfmuster neu aufgebaut')}${btn('Korrektur dokumentieren', 'dev-correction', guards.devCorrection(d, F(ck)), { data: { id: d.id }, small: true })}`}</div>
        <div><h4>3 · Wirksamkeit & Abschluss</h4>${d.effectiveness ? `<div class="done-note">${esc(d.effectiveness.text)}<br>${esc(d.effectiveness.by)}, ${fmt(d.effectiveness.at)} · Bezug ${esc(d.effectiveness.evidence)}</div>`
          : `${textarea(ek, '', 'z. B. Wiederholungsprüfung PB-18 v2.0 bestanden, Korrektur wirksam')}${btn('Wirksamkeit bestätigen & schließen', 'dev-close', guards.devClose(d, F(ek)), { data: { id: d.id }, small: true })}`}</div>
      </div>
      <p class="muted small">Eine spätere positive Berichtsannahme schließt die Abweichung nicht automatisch. Ein neuer Bericht ist eine eigene Version.</p></article>`;
  }).join('');
  return `<div class="page-head"><h2>Prüfauftrag & Bericht</h2><span>${s.risk.status === 'closed' ? badge('R-04 Nachweispunkt geschlossen', 'ok') : badge('R-04 offen', 'bad')} ${openDeviations().length ? badge(`${openDeviations().length} blockierende Abweichung(en)`, 'bad') : ''}</span></div>
    <div class="grid2">
      ${card('Prüfauftrag', s.testOrder
        ? kv([['Auftrag', `${s.testOrder.id} nach ${s.testOrder.instruction} ${docBtn('documents/PA-04_Pruefanweisung.pdf', 1, 'PA-04 Prüfanweisung', 'öffnen')}`], ['Zielkonfiguration', esc(s.testOrder.target)], ['Risiko', 'R-04'], ['Erstellt', `${esc(s.testOrder.by)}, ${fmt(s.testOrder.at)}`], ['Status', badge(s.testOrder.status, 'neutral')]])
        : `${kv([['QM-Aufgabe', task ? `${task.id} – fällig ${task.due}` : '–'], ['Prüfanweisung', `PA-04 ${docBtn('documents/PA-04_Pruefanweisung.pdf', 1, 'PA-04 Prüfanweisung', 'öffnen')}`], ['Zielkonfiguration', 'UL-01 / Standard / R2 / Hubantrieb B']])}
          ${btn('Prüfauftrag erstellen', 'create-order', guards.createTestOrder())}`)}
      ${card('Simulierter Laboreingang', `<p class="sim-label">Simulierte Prüfstelle: Auswahl einer vorbereiteten PDF-Datei. Metadaten stammen aus seed.json.</p>
        <div class="picks">${labOpts}</div>
        ${btn('Bericht übernehmen', 'import-report', guards.importReport(pick), { data: { uid: pick } })}`)}
    </div>
    ${s.reports.length ? card('Eingegangene Berichte & QM-Bewertung', [...s.reports].reverse().map(reportCard).join('')) : ''}
    ${devs ? card('Abweichungen', devs) : ''}`;
}

// ------------------------------------------------------------------ 6 Übergabe
const CHECK = (ok, label, extra = '') => `<li class="${ok ? 'ok' : 'no'}"><i></i>${label}${extra ? ` <span class="muted">${extra}</span>` : ''}</li>`;

function packageCard(pkg) {
  const s = getState();
  const entries = runtime.zip[pkg.id];
  const accReason = F(`acc_${pkg.id}`, '');
  return `<article class="pkg ${pkg.status}">
    <header><div><strong>${pkg.id}</strong> ${badge(pkg.status, pkg.status === 'angenommen' ? 'ok' : pkg.status === 'ersetzt' ? 'neutral' : 'warn')} ${pkg.sourceLinkOnly ? badge('QUELLLINK-PROTOTYP – keine vollständige Akte', 'bad') : ''} ${s.release?.packageId === pkg.id ? badge('Basis der Freigabe', 'ok') : ''}</div>
      <span class="muted small">Snapshot ${pkg.hash} · eingefroren ${fmt(pkg.at)} · ${esc(pkg.by)}</span></header>
    <div class="row">
      <button class="btn secondary sm" data-act="download-pkg" data-id="${pkg.id}">ZIP herunterladen</button>
      <button class="btn secondary sm" data-act="open-pkg" data-id="${pkg.id}">${entries ? 'Inhalt aktualisieren' : 'ZIP öffnen & Inhalt prüfen'}</button>
      ${pkg.supersededBy ? `<span class="muted small">ersetzt durch ${pkg.supersededBy}; Inhalt unverändert</span>` : ''}
    </div>
    ${entries ? `<table class="tbl files"><thead><tr><th>Datei im ZIP</th><th>Größe</th><th></th></tr></thead><tbody>${entries.map(e => `<tr><td><code>${esc(e.name)}</code></td><td>${(e.size / 1024).toFixed(1)} KB</td><td>${e.pdf ? `<button class="link" data-act="open-blob" data-url="${e.url}" data-title="${esc(`${pkg.id} / ${e.name}`)}">Vorschau</button>` : `<a class="link" href="${e.url}" target="_blank">öffnen</a>`}</td></tr>`).join('')}</tbody></table>` : ''}
    ${pkg.acceptance ? `<div class="done-note">Angenommen durch ${esc(pkg.acceptance.by)}, ${fmt(pkg.acceptance.at)} · Version ${pkg.acceptance.hash}${pkg.acceptance.reason ? ` · „${esc(pkg.acceptance.reason)}“` : ''}</div>`
      : pkg.status !== 'ersetzt' ? `<div class="row end">${input(`acc_${pkg.id}`, '', 'Kommentar zur Annahme (optional)')}${btn(`${pkg.id} (Version ${pkg.hash}) annehmen`, 'accept-pkg', guards.acceptPackage(pkg), { data: { id: pkg.id } })}</div>` : ''}
  </article>`;
}

export function screenUebergabe() {
  const s = getState(), src = getSources();
  const pkg = currentPackage();
  const avail = certAvailable();
  const qDoc = F('qDoc', '04_PB-18 Prüfbericht');
  const routeDefault = s.route.status === 'unresolved' ? 'internal_confirmed' : s.route.status === 'external_required' ? 'external_fulfilled' : s.route.status;
  const routeSel = F('route', routeDefault);
  const exportErr = getUi().exportError;
  const stale = pkg && !s.release && hash(evidenceSnapshot()) !== pkg.hash;
  const readiness = `<ul class="checks">
    ${CHECK(s.change.confirmed && s.impact.confirmed, 'Änderung bestätigt und bewertet')}
    ${CHECK(s.risk.status === 'closed', 'R-04: geeigneter Nachweis von QM angenommen')}
    ${CHECK(!openDeviations().length, 'Keine blockierenden Abweichungen', openDeviations().map(d => d.id).join(', '))}
    ${CHECK(s.partner.confirmed, 'Partner / Zertifikat bestätigt')}
    ${CHECK(!openExclusions().length, 'Übrige Pflichtpunkte MDR Anhang I belegt oder begründet ausgeschlossen', openExclusions().length ? `offen: Nr. ${openExclusions().map(r => r.no).join(', ')}` : 'vorbestätigte Punkte gelten nur für den Demofall')}
    ${CHECK(avail || s.certMode.sourceLinkOnly, 'Zertifikats-PDF lokal vorhanden', avail ? '' : s.certMode.sourceLinkOnly ? 'Quelllink-Prototypmodus aktiv' : 'fehlt')}
  </ul>`;
  const questions = s.questions.map(q => {
    const ak = `ans_${q.id}`, ck = `chg_${q.id}`;
    return `<article class="question"><header><strong>${q.id}</strong> zu ${q.packageId} · ${esc(q.doc)} · S. ${esc(q.page)} ${q.answer ? badge('beantwortet', 'ok') : badge('offen', 'warn')}</header>
      <p>„${esc(q.text)}“ <span class="muted small">– ${esc(q.by)}, ${fmt(q.at)}</span></p>
      ${q.answer ? `<div class="done-note">${esc(q.answer.text)}<br>${esc(q.answer.by)}, ${fmt(q.answer.at)} · ${q.answer.changesEvidence ? `Nachweisstand geändert → ${q.answer.newPackageId || 'neues Paket'}` : 'Nachweisstand unverändert'}</div>`
        : `${textarea(ak, '', 'Antwort QM')}<label class="switch"><input type="checkbox" data-form="${ck}" data-check="1" ${F(ck) ? 'checked' : ''}> Antwort ändert den Nachweisstand (QM-Stellungnahme wird Teil der Akte → neues Paket)</label>
          ${btn('Antwort speichern', 'answer-q', guards.answerQuestion(q, F(ak)), { data: { id: q.id }, small: true })}`}</article>`;
  }).join('');

  return `<div class="page-head"><h2>Übergabe & OEM</h2><span class="muted">BeispielMed (OEM, fiktiv) · Pakete sind eingefrorene Snapshots</span></div>
    <div class="grid2">
      ${card('Übergabebereitschaft', `${readiness}
        ${!avail ? `<div class="evidence gap"><strong>Zertifikats-PDF fehlt lokal</strong><span>Formale Übergabe gesperrt, bis die Datei ergänzt ist – oder ausdrücklich im Quelllink-Prototypmodus (keine vollständige Akte). Original: ${esc(src.certUrl)}</span></div>
          ${btn(s.certMode.sourceLinkOnly ? 'Quelllink-Prototypmodus deaktivieren' : 'Quelllink-Prototypmodus aktivieren', 'toggle-sourcelink', guards.toggleSourceLink(), { kind: 'secondary', small: true })}` : ''}
        ${exportErr ? `<div class="evidence gap"><strong>${exportErr.kind === 'draft' ? 'Export' : 'Übergabe'} fehlgeschlagen</strong><span>${esc(exportErr.text)}. Es wurde nichts gespeichert; der Vorgang bleibt offen.</span></div>
          <div class="row">${btn('Erneut versuchen', 'export-retry', [])}</div>` : ''}
        ${stale ? `<div class="evidence gap"><strong>Nachweisstand geändert</strong><span>Seit ${pkg.id} hat sich der Nachweisstand geändert. Für Annahme und Freigabe ist ein neues Paket nötig; ${pkg.id} bleibt unverändert.</span></div>` : ''}
        <div class="row">
          ${btn('Arbeitsstand exportieren (mit Lückenliste)', 'export-draft', guards.exportDraft(), { kind: 'secondary' })}
          ${btn(pkg ? 'Paket übergeben / erneut bereitstellen' : 'Paket übergeben', 'export-formal', guards.exportFormal())}
        </div>
        <label class="switch"><input type="checkbox" data-act="toggle-export-error" ${s.tests.exportError ? 'checked' : ''}> Testschalter: Exportfehler simulieren</label>
        ${s.drafts.length ? `<h4>Arbeitsstände</h4><table class="tbl"><tbody>${s.drafts.map(d => `<tr><td>${d.id}</td><td>${badge('ARBEITSSTAND', 'warn')}</td><td>${d.gaps.length} Lücken</td><td>${fmt(d.at)}</td><td><button class="link" data-act="download-draft" data-id="${d.id}">ZIP</button></td></tr>`).join('')}</tbody></table>` : ''}`)}
      ${card('Regulatorischer Weg (RA)', `
        ${kv([['Testdatensatz', esc(SCENARIOS[s.scenario].label)], ['Verfahrensstatus', badge(routeLabel(), ['internal_confirmed', 'external_fulfilled'].includes(s.route.status) ? 'ok' : 'warn')],
          ...(s.route.classification ? [['Einordnung', esc(s.route.classification)], ['Beleg', esc(s.route.evidence)]] : [])])}
        ${s.route.status === 'external_required' ? '<p class="muted small">Eine erforderliche Genehmigung braucht das Ergebnis der zuständigen Stelle; eine Mitteilung wird nach den einschlägigen Vorgaben erledigt. Bis dahin bleibt die Freigabe gesperrt.</p>' : ''}
        ${s.release ? '<p class="muted small">Nach der Freigabe eingefroren.</p>' : `
        <label class="lbl">Neuer Status<select class="inp" data-form="route">${Object.entries(ROUTES).map(([k, v]) => `<option value="${k}" ${routeSel === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${routeSel === 'external_required' ? `<label class="lbl">Art<select class="inp" data-form="routeKind"><option value="">– wählen –</option>${Object.entries(EXTERNAL_KIND).map(([k, v]) => `<option value="${k}" ${F('routeKind') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
        <label class="lbl">Regulatorische Einordnung${textarea('routeClass', s.scenario === 'external' ? 'Wesentliche Änderung – Genehmigung der zuständigen Stelle erforderlich (synthetische Annahme)' : 'Klasse I, Austausch einer gleichwertigen Komponente – Bewertung im Herstellerprozess (Demo-Annahme)')}</label>
        <label class="lbl">Dokumentierte Begründung${textarea('routeReason', '', routeSel === 'external_fulfilled' ? 'z. B. Genehmigung der zuständigen Stelle liegt vor' : 'z. B. Änderung im Rahmen der bestehenden Konformitätsbewertung; keine benannte Stelle erforderlich')}</label>
        <label class="lbl">${routeSel === 'external_fulfilled' ? 'Beleg: Ergebnis der zuständigen Stelle / Nachweis der Mitteilung' : 'Beleg'}${input('routeEvidence', '', routeSel === 'external_fulfilled' ? 'z. B. Bescheid-Nr. (simuliert)' : 'z. B. interne Bewertung RA-BW-01')}</label>
        ${btn('Status setzen', 'set-route', guards.setRoute({ route: routeSel, kind: F('routeKind'), classification: F('routeClass'), reason: F('routeReason'), evidence: F('routeEvidence') }))}`}
        ${s.route.history.length ? `<ol class="mini">${s.route.history.map(h => `<li>${fmt(h.at)} · ${esc(h.by)}: ${esc(routeLabel(h.from))} → <strong>${esc(routeLabel(h.to, h.kind))}</strong> – ${esc(h.reason)}${h.evidence ? ` <span class="muted">(Beleg: ${esc(h.evidence)})</span>` : ''}</li>`).join('')}</ol>` : ''}`)}
    </div>
    ${card('Übergabepakete', s.packages.length ? [...s.packages].reverse().map(packageCard).join('') : '<p class="muted">Noch kein formales Paket. Inhalt: Index-PDF, BOM R2, R-04 + Bewertungsvermerk, PA-04, angenommene PB-18-Version, QMS-Quelle, Anforderungsmatrix, Entscheidungsprotokoll. Ausgeschlossen: Entwürfe, abgelehnte Berichte, interne Notizen.</p>')}
    <div class="grid2">
      ${card('OEM-Rückfragen', `${questions || '<p class="muted">Keine Rückfragen.</p>'}
        <h4>Neue Rückfrage (OEM)</h4>
        <div class="form-grid">
          <label class="lbl">Dokument<select class="inp" data-form="qDoc">${['04_PB-18 Prüfbericht', '02_R-04 Risikomanagementauszug', '03_PA-04 Prüfanweisung', '05_QMS-Quelle Zertifikate', '06_Anforderungsmatrix'].map(d => `<option ${qDoc === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
          <label class="lbl">Seite${input('qPage', '2', '', 'number')}</label>
        </div>
        <label class="lbl">Frage${textarea('qText', '', 'z. B. Welche Prüflast wurde für R2/B angewendet?')}</label>
        ${btn('Rückfrage senden', 'ask-q', guards.askQuestion({ doc: qDoc, text: F('qText') }), { kind: 'secondary' })}`)}
      ${card('Separate OEM-Freigabe R2/B', s.release
        ? `<div class="evidence ok"><strong>Serienstand R2/B freigegeben durch ${esc(s.release.by)}</strong><span>${fmt(s.release.at)} · Basis ${s.release.packageId} (${s.release.hash}) · ${esc(routeLabel(s.release.route, s.release.routeKind))}</span></div>
          ${kv([['EU-Konformitätserklärung', esc(s.release.doc)], ['Kennzeichnung', esc(s.release.label)], ['Betroffene Serienlose', esc(s.release.lots)], ['Begründung', esc(s.release.reason)]])}
          <p class="muted small">Herstellerentscheidung im Demofall – keine CE-Kennzeichnung oder Zulassung durch den Prototyp. R1 und bereits ausgelieferte Geräte bleiben unverändert.</p>`
        : `<p class="muted small">Eigene Herstelleraktion, nur für einen freigabeberechtigten OEM-Vertreter. Ein angenommenes Paket ist noch keine Freigabe. Im Klasse-I-Musterfall verantwortet BeispielMed die Konformität.</p>
          <label class="lbl">Geltungsbereich der EU-Konformitätserklärung${textarea('relDoc', 'EU-Konformitätserklärung UL-01 / Standard um Revision R2 (Hubantrieb B) ergänzt (Demo)')}</label>
          <label class="lbl">Kennzeichnung${textarea('relLabel', 'Typenschild und Etikett mit Revision R2 aktualisiert; Gebrauchsanweisung unverändert (Demo)')}</label>
          <label class="lbl">Betroffene Serienlose${input('relLots', 'ab Serienlos L-2027-01', 'z. B. ab Serienlos L-2027-01')}</label>
          <label class="lbl">Begründung${textarea('releaseReason', '', 'z. B. P-01 geprüft, R-04 belegt, Verfahrensstatus geklärt')}</label>
          ${btn('Serienstand R2/B freigeben', 'release', guards.release({ doc: F('relDoc'), label: F('relLabel'), lots: F('relLots'), reason: F('releaseReason') }))}`)}
    </div>`;
}

// ------------------------------------------------------------------ 7 Service
const SV_STEPS = ['eingegangen', 'zugeordnet', 'regulatorisch bewertet', 'nachverfolgt'];

export function screenService() {
  const s = getState(), sv = s.service;
  const pkg = sv && s.packages.find(p => p.id === sv.packageId);
  const as = sv?.assessment;
  const duty = F('svDuty', '');
  const repF = { serial: F('repSerial', sv?.serial || ''), part: F('repPart', sv ? `MH-${sv.part}` : ''), protocol: F('repProtocol', 'PP-SV01-01 Funktions- und Halteprüfung nach Instandsetzung'), tech: F('repTech', 'P. Wagner (Servicetechniker)'), controlDue: F('repDue', sv ? addDays(sv.simulatedNow, 365) : '') };
  const caseCard = sv ? card('Servicefall SV-01', `
      <ol class="steps inline">${SV_STEPS.map(st => `<li class="${SV_STEPS.indexOf(st) <= SV_STEPS.indexOf(sv.status) ? 'ok' : ''}"><i></i>${st}</li>`).join('')}</ol>
      ${kv([['Meldung', 'Liege bleibt gelegentlich nicht auf eingestellter Höhe (Ursache nicht bestätigt, keine Aussage zu Personenschaden)'], ['Bezug', 'R-04 Unbeabsichtigtes Absenken'],
        ['RA-Aufgabe', sv.raTask ? `${sv.raTask} · J. Krüger (RA)` : '–'],
        ['Kenntnis OEM', sv.oemAwareAt ? `${fmt(sv.oemAwareSim)} (simuliert) · erfasst ${fmt(sv.oemAwareAt)} durch ${esc(sv.oemAwareBy)}` : '–'],
        ['Prüffrist', sv.reviewDue ? `${sv.reviewDue} <span class="muted small">Hinweis: MDR Art. 87 nennt Meldefristen von höchstens 15 Tagen ab Kenntnis, in schweren Fällen kürzer. Die Bewertung trifft RA.</span>` : '–']])}
      <div class="row">${btn('RA-Bewertungsaufgabe erstellen', 'create-ra', guards.createRaTask())}${btn('Kenntniszeitpunkt OEM erfassen', 'oem-aware', guards.oemAware(), { kind: 'secondary' })}</div>
      <h4>Regulatorische Bewertung (RA)</h4>
      ${as ? `${kv([['Meldepflicht', esc(as.duty)], ...(as.duty === 'ja' ? [['Adressat', esc(as.addressee)], ['Frist', esc(as.deadline)]] : []), ['Bewertung', esc(as.text)], ['Nächste Maßnahme', esc(as.next)], ['Bewertet', `${esc(as.by)}, ${fmt(as.at)}`]])}`
        : `<div class="form-grid">
          <label class="lbl">Meldepflicht<select class="inp" data-form="svDuty"><option value="">– beurteilen –</option><option value="nein" ${duty === 'nein' ? 'selected' : ''}>nein</option><option value="ja" ${duty === 'ja' ? 'selected' : ''}>ja</option></select></label>
          ${duty === 'ja' ? `<label class="lbl">Adressat${input('svAddr', 'zuständige Behörde (Demo)')}</label><label class="lbl">Frist${input('svDeadline', sv.reviewDue || '', '', 'date')}</label>` : ''}
        </div>
        <label class="lbl">Fachliche Bewertung${textarea('svText', '', 'z. B. kein schwerwiegendes Vorkommnis; Trend zu R-04 beobachten')}</label>
        <label class="lbl">Nächste Maßnahme${textarea('svNext', '', 'z. B. Gerät instand setzen, Halteverhalten prüfen, weitere Meldungen auswerten')}</label>
        ${btn('Bewertung speichern', 'ra-assess', guards.raAssess({ duty, addressee: F('svAddr'), deadline: F('svDeadline'), text: F('svText'), next: F('svNext') }))}`}
      ${as?.duty === 'ja' ? (sv.externalReport ? `<div class="done-note">Externe Meldung dokumentiert: ${esc(sv.externalReport.ref)} · ${esc(sv.externalReport.by)}, ${fmt(sv.externalReport.at)} (simuliert, kein Versand)</div>`
        : `<label class="lbl">Externe Meldung (eigene Handlung, simuliert – kein Versand)${input('svRef', '', 'Referenz / Aktenzeichen')}</label>${btn('Externe Meldung dokumentieren', 'report-external', guards.reportExternal(F('svRef')), { kind: 'secondary', small: true })}`) : ''}
      ${as ? (sv.followUp ? `<div class="done-note">Nachverfolgt: ${esc(sv.followUp.text)} · ${esc(sv.followUp.by)}, ${fmt(sv.followUp.at)}</div>`
        : `<label class="lbl">Nachverfolgung${textarea('svFollow', '', 'z. B. Instandsetzung REP-01 erfolgt, keine weiteren Meldungen')}</label>${btn('Nachverfolgung dokumentieren', 'follow-up', guards.followUp(F('svFollow')), { kind: 'secondary', small: true })}`) : ''}
      <p class="muted small">Keine automatische Behördenmeldung. Die Bewertung erfolgt fachlich durch OEM/RA.</p>`) : '';
  const repairCard = sv?.opened ? card('Reparatur im Bestand', `
      <p class="muted small">Eigener Servicevorgang für ein ausgeliefertes Gerät. Die Freigabe von R2/B für künftige Seriengeräte löst keinen Umbau bereits ausgelieferter Liegen aus.</p>
      ${s.repairs.length ? `<table class="tbl"><thead><tr><th>Vorgang</th><th>Gerät</th><th>Ersatzteil</th><th>Prüfprotokoll</th><th>Fachperson</th><th>Nächste Kontrolle</th></tr></thead><tbody>${s.repairs.map(r => `<tr><td>${r.id}</td><td>${esc(r.serial)}<div class="muted small">${esc(r.maker)} · ${esc(r.build)}</div></td><td>${esc(r.part)}</td><td>${esc(r.protocol)}</td><td>${esc(r.tech)}</td><td>${esc(r.controlDue)}</td></tr>`).join('')}</tbody></table>`
        : `<div class="form-grid">
          <label class="lbl">Seriennummer${input('repSerial', repF.serial)}</label>
          <label class="lbl">Herstellerangaben<input class="inp" value="BeispielMed (fiktiv) · UL-01 / Standard · ${sv.revision}/${sv.part}" disabled></label>
          <label class="lbl">Ersatzteil<select class="inp" data-form="repPart">${['MH-B', 'MH-A'].map(a => `<option value="${a}" ${repF.part === a ? 'selected' : ''}>${a}${a === `MH-${sv.part}` ? ' (wie verbaut)' : ' (abweichend vom Baustand)'}</option>`).join('')}</select></label>
          <label class="lbl">Nächste Kontrolle fällig${input('repDue', repF.controlDue, '', 'date')}</label>
        </div>
        <label class="lbl">Prüfprotokoll${input('repProtocol', repF.protocol)}</label>
        <label class="lbl">Verantwortliche Fachperson${input('repTech', repF.tech)}</label>
        ${btn('Reparatur dokumentieren', 'record-repair', guards.recordRepair(repF))}`}`) : '';
  return `<div class="page-head"><h2>Service & Verlauf</h2><span class="muted">Synthetischer Fall – keine Patientendaten, keine automatische Meldung, kein Retrofit</span></div>
    <div class="grid2">
      ${card('Synthetischer Zeitsprung', sv
        ? `<div class="evidence ok"><strong>Aktiv – simulierte Zeit ${fmt(sv.simulatedNow)}</strong><span>${sv.serial} · ${sv.revision}/${sv.part} · ausgeliefert mit ${sv.packageId} · ${sv.delivery} (aktiviert ${fmt(sv.activatedAt)})</span></div>`
        : `<p>Simuliert die Auslieferung von <strong>SN-DEMO-002</strong> (R2/B) mit dem tatsächlich angenommenen Paket dieses Durchlaufs und Lieferbezug LIEF-DEMO-002. Ausdrücklich zu aktivieren.</p>
          ${btn('Zeitsprung aktivieren', 'activate-service', guards.activateService())}`)}
      ${card('Seriennummernsuche', `<div class="row">${input('serial', '', 'Seriennummer, z. B. SN-DEMO-002')}<button class="btn secondary" data-act="search-serial">Suchen</button></div>
        ${sv?.opened ? `<h4>Gebauter Zustand ${sv.serial}</h4>${kv([['Produkt', 'UL-01 / Standard'], ['Revision', `${sv.revision} / Hubantrieb ${sv.part} (MH-B, Pos. 020)`], ['Lieferbezug', sv.delivery], ['Serienlos', esc(sv.lots || '–')], ['Akte', `${sv.packageId} · Snapshot ${pkg?.hash} ${badge(pkg?.status || '', 'neutral')}`], ['Freigabe', `${esc(s.release.by)}, ${fmt(s.release.at)}`]])}
          <div class="row"><button class="btn secondary sm" data-act="goto-pkg" data-id="${sv.packageId}">Akte ${sv.packageId} öffnen</button> ${docBtn(sv.source, 1, 'SV-01 Servicefall', 'SV-01 Servicefall')}</div>` : ''}`)}
    </div>
    ${caseCard}
    ${repairCard}
    ${card('Audit-Trail (vollständig)', timeline())}`;
}

export function screen() {
  const id = getUi().screen;
  return ({ akte: screenAkte, eingang: screenEingang, matrix: screenMatrix, partner: screenPartner, pruefung: screenPruefung, uebergabe: screenUebergabe, service: screenService }[id] || screenAkte)();
}

export { gapList };
