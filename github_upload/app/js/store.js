// Shared application state, business rules and actions.
// One state object drives every screen. Persisted in localStorage (demo session only).
import { PERSONS, ROUTES, PRECONFIRMED } from './data.js';

export const STORAGE_KEY = 'devoreo.ul01.demo.v1';
const UI_KEY = 'devoreo.ul01.ui.v1';

let SRC = null; // loaded sources (seed, bom, eml, cert availability)
let state = null;
let ui = null;
const listeners = new Set();

export const getSources = () => SRC;
export const getState = () => state;
export const getUi = () => ui;
export const subscribe = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

function freshState() {
  const init = SRC.seed.initial_state;
  return {
    schema: 1,
    sessionStartedAt: new Date().toISOString(),
    personId: 'eng',
    inbox: [],            // imported messages (dedup by Message-ID)
    deliveries: [],       // every delivery attempt incl. duplicates
    change: { status: SRC.seed.change.status, mapping: null, confirmed: init.change_confirmed },
    clarifications: [],
    impact: { confirmed: init.impact_reviewed },
    tasks: [],
    testOrder: init.test_ordered ? {} : null,
    reports: [],
    risk: { status: SRC.seed.risk.status },
    deviations: [],
    partner: { selection: { company: '', site: '', activity: '', cert: '' }, confirmed: init.partner_confirmed },
    certMode: { simulateMissing: false, sourceLinkOnly: false },
    supplements: [],
    packages: [],
    drafts: [],
    questions: [],
    route: { status: init.regulatory_route, history: [] },
    release: init.release,
    service: init.service,
    audit: [],
    seq: {},
  };
}

function freshUi() {
  return { screen: 'akte', revision: 'R2', viewer: null, forms: {}, flash: null, auditOpen: false, openPackage: null };
}

export function init(sources) {
  SRC = sources;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { state = null; }
  if (!state || state.schema !== 1) state = freshState();
  try { ui = { ...freshUi(), ...JSON.parse(localStorage.getItem(UI_KEY)) }; } catch { ui = freshUi(); }
  ui.flash = null;
  ui.confirmReset = false;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(UI_KEY, JSON.stringify({ ...ui, flash: null }));
  } catch { /* storage unavailable: state stays in memory */ }
}

export function setUi(patch, rerender = true) {
  Object.assign(ui, patch);
  persist();
  if (rerender) emit();
}

export function setForm(key, value) {
  ui.forms[key] = value;
  persist();
}

// Clears ONLY this demo's keys; source files are untouched.
export function resetDemo() {
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(UI_KEY); } catch { /* storage unavailable */ }
  state = freshState();
  ui = freshUi();
  audit('Demo zurückgesetzt', 'Sitzung', 'Neuer Demo-Durchlauf gestartet');
  persist();
  emit();
}

// ---------------------------------------------------------------- helpers
export const person = (id = state.personId) => PERSONS.find(p => p.id === id);
export const nowIso = () => new Date().toISOString();
const nextId = (prefix, pad = 2) => {
  state.seq[prefix] = (state.seq[prefix] || 0) + 1;
  return `${prefix}-${String(state.seq[prefix]).padStart(pad, '0')}`;
};

export function audit(action, object, detail = '', extra = {}) {
  const p = person();
  state.audit.push({
    id: state.audit.length + 1, ts: nowIso(),
    personId: p.id, actor: p.name, role: p.role, title: p.title,
    action, object, detail, ...extra,
  });
}

// FNV-1a over a stable JSON string; enough for demo dedup of snapshots.
export function hash(obj) {
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const reportUid = r => `${r.id}@${r.version}`;
export const seedReports = () => SRC.seed.reports;
export const certAvailable = () => SRC.certLocalAvailable && !state.certMode.simulateMissing;

// ---------------------------------------------------------------- rules
export function assessReport(rep) {
  const exp = SRC.seed.risk;
  const issues = [];
  if (rep.revision !== exp.expected_revision || rep.part !== exp.expected_part)
    issues.push({ code: 'config', text: `Falsche Konfiguration: Bericht belegt ${rep.revision}/${rep.part}, erwartet ${exp.expected_revision}/${exp.expected_part}.` });
  if (rep.document_status !== 'Endfassung')
    issues.push({ code: 'draft', text: `Dokumentstatus „${rep.document_status}“ – nur eine Endfassung kann als Nachweis dienen.` });
  if (rep.result === 'Nicht bestanden')
    issues.push({ code: 'negative', text: 'Ergebnis „Nicht bestanden“ – erzeugt eine blockierende Abweichung.' });
  else if (rep.result !== 'Bestanden')
    issues.push({ code: 'open', text: `Ergebnis „${rep.result}“ – kein abgeschlossenes Prüfergebnis.` });
  return { suitable: issues.length === 0, issues };
}

const certById = id => SRC.seed.certificates.find(c => c.id === id);
const partnerById = id => SRC.seed.partners.find(p => p.id === id);

export const COMPANIES = [
  { id: 'ERGO', name: 'Ergo-Tec GmbH', sites: ['ERGO-MAIN', 'ERGO-STORE'] },
  { id: 'SUP', name: 'MusterHub Antriebstechnik GmbH (fiktiv)', sites: ['SUP'] },
];
export const ACTIVITIES = ['Fertigung', 'Entwicklung', 'Lagerung'];

// Partner check as five plain-language checks; failed checks become the
// clarification reasons shown to QM.
export function evalPartner(sel) {
  if (sel.company === 'SUP' && sel.site && sel.activity)
    return { status: 'clarify', checks: [], reasons: ['MusterHub ist Lieferant des Bremsmoduls, nicht Hersteller von UL-01. In der Quelle liegt für MusterHub kein Zertifikat vor.'] };
  if (!sel.company || !sel.site || !sel.activity || !sel.cert)
    return { status: 'incomplete', checks: [], reasons: ['Unternehmen, Standort, Tätigkeit und Zertifikat auswählen.'] };
  const cert = certById(sel.cert);
  const site = partnerById(sel.site);
  const extra = cert.additional_site?.id === sel.site ? cert.additional_site : null;
  const atSite = sel.site === cert.site || !!extra;
  const scope = extra ? extra.scope : cert.scope;
  const medical = cert.standard === 'ISO 13485';
  const asOf = SRC.seed.as_of;
  const valid = asOf >= cert.from && asOf <= cert.to;
  const covered = atSite && (extra ? sel.activity === 'Lagerung' : medical && sel.activity !== 'Lagerung');
  const checks = [
    { label: 'Norm passt zu Medizinprodukten', ok: medical,
      text: medical ? 'ISO 13485 ist die QM-Norm für Medizinprodukte.'
        : `${cert.standard} ist ein allgemeines QM-Zertifikat. Laut Zertifikat gilt es für „${cert.scope}“, nicht für Medizinprodukte.` },
    { label: 'Standort steht im Zertifikat', ok: atSite,
      text: atSite ? `${site.address} ist im Zertifikat genannt.` : `${site.address} ist in diesem Zertifikat nicht genannt.` },
    { label: 'Gewählte Tätigkeit ist abgedeckt', ok: atSite && covered,
      text: !atSite ? 'Nicht prüfbar, weil der Standort fehlt.'
        : covered ? `Geltungsbereich am Standort: „${scope}“.`
        : `Geltungsbereich am Standort: „${scope}“. „${sel.activity}“ ist davon nicht erfasst.` },
    { label: 'Fertigung von UL-01 wird bestätigt', ok: sel.activity === 'Fertigung',
      text: sel.activity === 'Fertigung' ? 'Bestätigt wird, wer UL-01 fertigt.'
        : `Bestätigt wird, wer UL-01 fertigt. „${sel.activity}“ ist dafür nicht der richtige Umfang.` },
    { label: 'Gültig am Demo-Stichtag', ok: valid, text: `${cert.from} bis ${cert.to}, Stichtag ${asOf}.` },
  ];
  const reasons = checks.filter(c => !c.ok).map(c => c.text);
  return { status: reasons.length ? 'clarify' : 'match', checks, reasons, cert, scope, site };
}

export const openDeviations = () => state.deviations.filter(d => d.status !== 'geschlossen');
export const acceptedReport = () => state.reports.find(r => r.review?.status === 'angenommen');
export const currentPackage = () => [...state.packages].reverse().find(p => p.status !== 'ersetzt');
export const openQuestions = () => state.questions.filter(q => !q.answer);

// Evidence snapshot used for formal packages. Excludes the running log so
// an unchanged evidence state yields the same hash (same package).
export function evidenceSnapshot() {
  const acc = acceptedReport();
  const sel = state.partner.selection;
  const ev = evalPartner(sel);
  return {
    product: 'UL-01', variant: 'Standard', revision: 'R2', part: 'B',
    bom: SRC.bom.R2,
    change: { id: 'PCN-01', mapping: state.change.mapping },
    risk: { id: 'R-04', status: state.risk.status, closedBy: state.risk.closedBy, reason: state.risk.reason, reportUid: state.risk.reportUid, at: state.risk.at },
    report: acc ? { uid: acc.uid, id: acc.id, version: acc.version, file: acc.file, document_status: acc.document_status, result: acc.result, review: acc.review } : null,
    instruction: 'PA-04',
    partner: { selection: sel, scope: ev.scope || null, certId: ev.cert?.id || null, confirmedBy: state.partner.confirmedBy, reason: state.partner.reason },
    cert: certAvailable() ? { mode: 'local', file: 'documents/Ergo-Tec_Public_Certificates.pdf', pages: [1, 3], url: SRC.certUrl }
      : { mode: 'source_link', url: SRC.certUrl },
    deviations: state.deviations.map(d => ({ id: d.id, status: d.status, correction: d.correction?.text, effectiveness: d.effectiveness?.text })),
    supplements: state.supplements.map(s => ({ id: s.id, text: s.text, ref: s.ref, by: s.by })),
    preconfirmed: PRECONFIRMED.map(p => p.id),
  };
}

// ---------------------------------------------------------------- guards
// Each guard returns an array of German reasons; empty = allowed.
const roleNeed = (roles, opts = {}) => {
  const p = person();
  const r = [];
  if (!roles.includes(p.role)) r.push(`Nur Rolle ${roles.map(x => ({ einkauf: 'Einkauf/Entwicklung', qm: 'QM', oem: 'OEM', service: 'Service' })[x]).join(' oder ')} – aktuell: ${p.name}, ${p.title}.`);
  else if (opts.authorized && !p.authorized) r.push(`${p.name} ist nicht freigabeberechtigt (${p.title}).`);
  if (opts.ra && !p.ra) r.push(`Nur Regulatory Affairs (RA) – aktuell: ${p.name}.`);
  return r;
};
const need = (cond, text) => (cond ? [] : [text]);
const blank = v => !v || !String(v).trim();

export const guards = {
  importPcn: () => roleNeed(['einkauf']),
  confirmMapping: (pos) => [
    ...roleNeed(['einkauf']),
    ...need(state.inbox.some(m => m.messageId === SRC.eml.messageId), 'PCN-01 wurde noch nicht aus dem Posteingang übernommen.'),
    ...need(!state.change.confirmed, 'Zuordnung bereits bestätigt.'),
    ...(pos && SRC.bom.R1.find(r => r.position === pos)?.article_id !== SRC.seed.change.old_article
      ? [`Position ${pos} enthält nicht den abgekündigten Artikel ${SRC.seed.change.old_article} – Zuordnung unzulässig.`] : []),
  ],
  confirmImpact: (f) => [
    ...roleNeed(['einkauf']),
    ...need(state.change.confirmed, 'Zuerst die Zuordnung PCN-01 → Position 020 bestätigen.'),
    ...need(!state.impact.confirmed, 'Auswirkungsbewertung bereits bestätigt.'),
    ...need(!blank(f?.text), 'Begründung der Auswirkungsbewertung fehlt.'),
  ],
  createQmTask: (f) => [
    ...roleNeed(['einkauf']),
    ...need(state.impact.confirmed, 'Auswirkungsbewertung ist noch nicht bestätigt.'),
    ...need(!state.tasks.some(t => t.kind === 'qm-r04'), 'QM-Aufgabe für R-04 existiert bereits (keine Dublette).'),
    ...need(!blank(f?.reason) && !blank(f?.due), 'Grund und Fälligkeit sind Pflichtfelder.'),
  ],
  createTestOrder: () => [
    ...roleNeed(['qm']),
    ...need(state.tasks.some(t => t.kind === 'qm-r04'), 'Keine QM-Aufgabe vorhanden – Auswirkungsbewertung und Aufgabe zuerst anlegen.'),
    ...need(!state.testOrder, 'Prüfauftrag existiert bereits.'),
  ],
  importReport: (uid) => [
    ...roleNeed(['qm']),
    ...need(!!state.testOrder, 'Kein Prüfauftrag PA-04 vorhanden – Laboreingang nicht zuordenbar.'),
    ...need(!state.reports.some(r => r.uid === uid), `${uid.replace('@', ' v')} wurde bereits importiert (Dublette verworfen).`),
  ],
  acceptReport: (rep, reason) => {
    const a = assessReport(rep);
    return [
      ...roleNeed(['qm'], { authorized: true }),
      ...a.issues.map(i => i.text),
      ...need(!rep.review, `Bewertung bereits dokumentiert (${rep.review?.status}).`),
      ...need(state.risk.status !== 'closed', 'R-04 ist bereits mit einem angenommenen Nachweis geschlossen.'),
      ...need(!blank(reason), 'Begründung der QM-Bewertung fehlt.'),
    ];
  },
  rejectReport: (rep, reason) => [
    ...roleNeed(['qm']),
    ...need(!rep.review, `Bewertung bereits dokumentiert (${rep.review?.status}).`),
    ...need(!blank(reason), 'Begründung der QM-Bewertung fehlt.'),
  ],
  devCorrection: (d, text) => [
    ...roleNeed(['qm']),
    ...need(!d.correction, 'Korrektur bereits dokumentiert.'),
    ...need(!blank(text), 'Beschreibung der Korrekturmaßnahme fehlt.'),
  ],
  devClose: (d, text) => [
    ...roleNeed(['qm'], { authorized: true }),
    ...need(!!d.correction, 'Zuerst die Korrekturmaßnahme separat dokumentieren.'),
    ...need(!!acceptedReport(), 'Wirksamkeit nicht belegbar: kein angenommener positiver R2/B-Nachweis.'),
    ...need(d.status !== 'geschlossen', 'Abweichung bereits geschlossen.'),
    ...need(!blank(text), 'Wirksamkeitsnachweis / Begründung fehlt.'),
  ],
  partnerClarify: () => [
    ...roleNeed(['qm', 'einkauf']),
    ...need(evalPartner(state.partner.selection).status === 'clarify', 'Auswahl erfordert keine Klärung.'),
  ],
  partnerConfirm: (reason) => {
    const ev = evalPartner(state.partner.selection);
    return [
      ...roleNeed(['qm'], { authorized: true }),
      ...(ev.status === 'match' ? [] : ev.status === 'incomplete' ? ['Auswahl unvollständig.'] : ['Nicht alle Prüfpunkte erfüllt (siehe Prüfung).']),
      ...need(!state.partner.confirmed, 'Partner bereits bestätigt.'),
      ...need(!blank(reason), 'Begründung der QM-Bestätigung fehlt.'),
    ];
  },
  toggleSourceLink: () => roleNeed(['qm'], { authorized: true }),
  exportDraft: () => [
    ...roleNeed(['qm', 'einkauf']),
    ...need(state.inbox.length > 0, 'Noch keine Änderung im Projekt erfasst.'),
  ],
  exportFormal: () => [
    ...roleNeed(['qm'], { authorized: true }),
    ...formalBlockers(),
  ],
  acceptPackage: (pkg) => [
    ...roleNeed(['oem'], { authorized: true }),
    ...need(pkg.status !== 'ersetzt', `${pkg.id} ist durch ein neueres Paket ersetzt.`),
    ...need(!pkg.acceptance, `${pkg.id} wurde bereits angenommen.`),
  ],
  askQuestion: (f) => [
    ...roleNeed(['oem']),
    ...need(state.packages.length > 0, 'Kein übergebenes Paket vorhanden.'),
    ...need(!blank(f?.text) && !blank(f?.doc), 'Dokument und Frage angeben.'),
  ],
  answerQuestion: (q, text) => [
    ...roleNeed(['qm'], { authorized: true }),
    ...need(!q.answer, 'Rückfrage bereits beantwortet.'),
    ...need(!blank(text), 'Antworttext fehlt.'),
  ],
  setRoute: (route, reason) => [
    ...roleNeed(['oem'], { ra: true }),
    ...need(!state.release, 'R2/B bereits freigegeben – regulatorischer Weg ist eingefroren.'),
    ...need(route && route !== state.route.status, 'Neuen Status wählen.'),
    ...need(!blank(reason), 'Dokumentierte Begründung fehlt.'),
  ],
  release: (reason) => [
    ...roleNeed(['oem'], { authorized: true }),
    ...releaseBlockers(),
    ...need(!blank(reason), 'Begründung der Freigabeentscheidung fehlt.'),
  ],
  activateService: () => [
    ...roleNeed(['service']),
    ...need(!!state.release, 'Zeitsprung erst nach gültiger OEM-Freigabe von R2/B möglich.'),
    ...need(!state.service, 'Zeitsprung bereits aktiviert.'),
  ],
  createRaTask: () => [
    ...roleNeed(['service']),
    ...need(!!state.service?.opened, 'Zuerst Seriennummer suchen und Baustand öffnen.'),
    ...need(!state.service?.raTask, 'RA-Bewertungsaufgabe existiert bereits.'),
  ],
  oemAware: () => [
    ...roleNeed(['oem']),
    ...need(!!state.service?.raTask, 'Noch keine RA-Bewertungsaufgabe aus SV-01.'),
    ...need(!state.service?.oemAwareAt, 'Kenntniszeitpunkt bereits erfasst.'),
  ],
};

export function formalBlockers() {
  const r = [];
  if (!state.change.confirmed) r.push('Änderung PCN-01 nicht bestätigt.');
  if (!state.impact.confirmed) r.push('Auswirkungsbewertung fehlt.');
  if (state.risk.status !== 'closed') r.push('R-04: kein von QM angenommener geeigneter Nachweis.');
  openDeviations().forEach(d => r.push(`Blockierende Abweichung ${d.id} offen.`));
  if (!state.partner.confirmed) r.push('Partner / Zertifikat nicht durch QM bestätigt.');
  if (!certAvailable() && !state.certMode.sourceLinkOnly)
    r.push('Zertifikats-PDF lokal nicht vorhanden – Datei ergänzen oder Quelllink-Prototypmodus ausdrücklich aktivieren.');
  return r;
}

export function releaseBlockers() {
  const r = [];
  const pkg = currentPackage();
  if (state.release) r.push(`R2/B bereits freigegeben (${state.release.packageId}).`);
  if (!pkg) r.push('Kein formales Übergabepaket vorhanden.');
  else if (!pkg.acceptance) r.push(`Aktuelles Paket ${pkg.id} ist vom OEM nicht angenommen.`);
  if (pkg?.sourceLinkOnly) r.push(`${pkg.id} ist ein Quelllink-Prototyp und keine vollständige Akte.`);
  if (state.risk.status !== 'closed') r.push('R-04 offen.');
  openDeviations().forEach(d => r.push(`Abweichung ${d.id} offen.`));
  if (!state.partner.confirmed) r.push('Partnerbestätigung fehlt.');
  if (openQuestions().length) r.push(`${openQuestions().length} offene OEM-Rückfrage(n).`);
  if (state.route.status === 'unresolved') r.push('Regulatorischer Weg ungeklärt (RA).');
  if (state.route.status === 'external_pending') r.push('Externe Voraussetzung ausstehend (RA).');
  return r;
}

// ---------------------------------------------------------------- actions
function run(name, args, fn) {
  const reasons = guards[name](...args);
  if (reasons.length) {
    ui.flash = { type: 'error', text: `Aktion nicht zulässig: ${reasons.join(' ')}` };
    emit();
    return false;
  }
  const res = fn();
  persist();
  emit();
  return res ?? true;
}

const flash = (text, type = 'ok') => { ui.flash = { type, text }; };

export const actions = {
  switchPerson(id) {
    state.personId = id;
    audit('Demorolle gewechselt', 'Sitzung', `${person().name} – ${person().title}`, { internal: true });
    persist(); emit();
  },

  // Simulated mail delivery. Dedup by Message-ID.
  deliverPcn() {
    return run('importPcn', [], () => {
      const m = SRC.eml;
      state.deliveries.push({ messageId: m.messageId, at: nowIso() });
      if (state.inbox.some(x => x.messageId === m.messageId)) {
        audit('Duplikat verworfen', 'PCN-01', `Message-ID ${m.messageId} bereits übernommen`);
        flash(`Duplikat erkannt: ${m.messageId} ist bereits übernommen – kein zweiter Vorgang.`, 'warn');
        return;
      }
      state.inbox.push({ ...m, kind: 'pcn', attachment: SRC.seed.change.attachment, source: SRC.seed.change.source, importedAt: nowIso() });
      const pos = SRC.bom.R1.find(r => r.article_id === SRC.seed.change.old_article);
      state.change.status = 'mapped_suggested';
      state.change.mapping = { position: pos.position, old: SRC.seed.change.old_article, proposed: SRC.seed.change.proposed_article, rule: `Artikel ${SRC.seed.change.old_article} in BOM R1 an Position ${pos.position} gefunden` };
      audit('E-Mail übernommen', 'PCN-01', `Message-ID ${m.messageId}; Vorschlag Pos. ${pos.position} ${SRC.seed.change.old_article} → ${SRC.seed.change.proposed_article}`);
      flash('PCN-01 übernommen. Zuordnungsvorschlag erstellt – bitte bestätigen oder korrigieren.');
    });
  },

  // Negative test: synthetic message with an article not in the BOM.
  deliverUnknown() {
    return run('importPcn', [], () => {
      const id = '<TEST-UNBEKANNT-01@demo.local>';
      state.deliveries.push({ messageId: id, at: nowIso() });
      if (state.inbox.some(x => x.messageId === id)) {
        audit('Duplikat verworfen', 'Testnachricht', id);
        flash(`Duplikat erkannt: ${id} – kein zweiter Klärungsfall.`, 'warn');
        return;
      }
      state.inbox.push({ messageId: id, kind: 'test', from: 'test@demo.local', subject: 'Testnachricht – Abkündigung Artikel MH-X9', date: nowIso(), body: 'In der App erzeugte Negativtest-Nachricht (keine Quelldatei). Artikel MH-X9 entfällt.', importedAt: nowIso() });
      state.clarifications.push({ id: nextId('KL'), kind: 'artikel', article: 'MH-X9', source: id, status: 'offen', reason: 'Artikel MH-X9 in keiner Stückliste UL-01 gefunden – keine automatische Verknüpfung.', at: nowIso() });
      audit('Klärungsfall angelegt', 'MH-X9', 'Unbekannter Artikel – nicht automatisch verknüpft');
      flash('Unbekannter Artikel MH-X9 → Klärungsliste. Keine Verknüpfung mit der Stückliste.', 'warn');
    });
  },

  confirmMapping(pos) {
    return run('confirmMapping', [pos], () => {
      const corrected = pos !== state.change.mapping.position;
      state.change.mapping = { ...state.change.mapping, position: pos, confirmedBy: person().name, at: nowIso(), corrected };
      state.change.confirmed = true;
      state.change.status = 'confirmed';
      audit('Zuordnung bestätigt', 'PCN-01', `Position ${pos}: ${state.change.mapping.old} → ${state.change.mapping.proposed}${corrected ? ' (korrigiert)' : ''}. Hinweis: PCN ist keine Einbaufreigabe.`);
      flash(`Zuordnung PCN-01 → Position ${pos} bestätigt.`);
    });
  },

  confirmImpact(f) {
    return run('confirmImpact', [f], () => {
      state.impact = { confirmed: true, by: person().name, at: nowIso(), text: f.text.trim(), affects: ['R-04', 'PA-04'] };
      state.risk.gap = true;
      audit('Auswirkungsbewertung bestätigt', 'R-04', f.text.trim(), { reason: f.text.trim() });
      flash('Auswirkungsbewertung bestätigt: R-04 benötigt neuen Nachweis für R2/B.');
    });
  },

  createQmTask(f) {
    return run('createQmTask', [f], () => {
      const t = { id: nextId('AUF'), kind: 'qm-r04', title: 'Neuen Haltenachweis R-04 für R2/B beschaffen und bewerten', owner: 'Dr. M. Weber (QM)', source: 'PCN-01 / Auswirkungsbewertung', reason: f.reason.trim(), due: f.due, status: 'offen', createdBy: person().name, at: nowIso() };
      state.tasks.push(t);
      audit('QM-Aufgabe erstellt', t.id, `Verantwortlich ${t.owner}; fällig ${t.due}; Grund: ${t.reason}`);
      flash(`${t.id} an QM übergeben.`);
    });
  },

  createTestOrder() {
    return run('createTestOrder', [], () => {
      state.testOrder = { id: 'TA-01', instruction: 'PA-04', target: 'UL-01 / Standard / R2 / Hubantrieb B (MH-B)', risk: 'R-04', by: person().name, at: nowIso(), status: 'beauftragt' };
      const t = state.tasks.find(x => x.kind === 'qm-r04');
      if (t) t.status = 'in Bearbeitung';
      audit('Prüfauftrag erstellt', 'TA-01', 'Prüfanweisung PA-04, Zielkonfiguration R2/B');
      flash('Prüfauftrag TA-01 nach PA-04 erstellt (simulierte Prüfstelle).');
    });
  },

  importReport(uid) {
    return run('importReport', [uid], () => {
      const meta = seedReports().find(r => reportUid(r) === uid);
      const rep = { ...meta, uid, importedAt: nowIso(), importedBy: person().name, review: null };
      state.reports.push(rep);
      state.testOrder.status = 'Bericht eingegangen';
      audit('Bericht importiert (simuliert)', `${meta.id} v${meta.version}`, `${meta.revision}/${meta.part}, ${meta.document_status}, ${meta.result} – vorbereitete Metadaten aus seed.json`);
      const a = assessReport(meta);
      if (a.issues.some(i => i.code === 'negative') && meta.revision === 'R2') {
        const d = { id: nextId('AB'), reportUid: uid, status: 'offen', blocking: true, title: `Halteversuch R2/B nicht bestanden (${meta.id} v${meta.version})`, at: nowIso(), by: 'System (Regel)' };
        state.deviations.push(d);
        audit('Blockierende Abweichung angelegt', d.id, d.title);
        flash(`${meta.id} v${meta.version} importiert – blockierende Abweichung ${d.id} angelegt.`, 'warn');
      } else {
        flash(`${meta.id} v${meta.version} importiert. QM-Bewertung erforderlich.`);
      }
    });
  },

  acceptReport(uid, reason) {
    const rep = state.reports.find(r => r.uid === uid);
    return run('acceptReport', [rep, reason], () => {
      rep.review = { status: 'angenommen', by: person().name, role: 'QM', at: nowIso(), reason: reason.trim(), version: rep.version };
      state.risk = { ...state.risk, status: 'closed', closedBy: person().name, at: nowIso(), reason: reason.trim(), reportUid: uid };
      const t = state.tasks.find(x => x.kind === 'qm-r04');
      if (t) t.status = 'erledigt';
      audit('Nachweis angenommen', `${rep.id} v${rep.version}`, `R-04 Demo-Nachweispunkt geschlossen. Begründung: ${reason.trim()}`, { reason: reason.trim(), version: rep.version });
      const od = openDeviations();
      flash(`R-04 Nachweispunkt geschlossen.${od.length ? ` Abweichung ${od.map(d => d.id).join(', ')} bleibt offen – separat abschließen.` : ''}`);
    });
  },

  rejectReport(uid, reason) {
    const rep = state.reports.find(r => r.uid === uid);
    return run('rejectReport', [rep, reason], () => {
      rep.review = { status: 'abgelehnt', by: person().name, role: 'QM', at: nowIso(), reason: reason.trim(), version: rep.version };
      audit('Nachweis abgelehnt', `${rep.id} v${rep.version}`, reason.trim(), { reason: reason.trim(), version: rep.version });
      flash(`${rep.id} v${rep.version} als nicht geeignet dokumentiert. R-04 bleibt offen.`, 'warn');
    });
  },

  devCorrection(id, text) {
    const d = state.deviations.find(x => x.id === id);
    return run('devCorrection', [d, text], () => {
      d.correction = { text: text.trim(), by: person().name, at: nowIso() };
      d.status = 'Korrektur dokumentiert';
      audit('Korrekturmaßnahme dokumentiert', d.id, text.trim());
      flash(`Korrektur zu ${d.id} dokumentiert. Wirksamkeit separat nachweisen.`);
    });
  },

  devClose(id, text) {
    const d = state.deviations.find(x => x.id === id);
    return run('devClose', [d, text], () => {
      const acc = acceptedReport();
      d.effectiveness = { text: text.trim(), by: person().name, at: nowIso(), evidence: acc.uid };
      d.status = 'geschlossen';
      audit('Wirksamkeit bestätigt, Abweichung geschlossen', d.id, `${text.trim()} (Bezug ${acc.id} v${acc.version})`, { reason: text.trim() });
      flash(`${d.id} geschlossen.`);
    });
  },

  setPartner(field, value) {
    if (state.partner.confirmed) return;
    const sel = { ...state.partner.selection, [field]: value };
    if (field === 'company') { sel.site = ''; sel.cert = ''; }
    state.partner.selection = sel;
    persist(); emit();
  },

  partnerClarify() {
    return run('partnerClarify', [], () => {
      const ev = evalPartner(state.partner.selection);
      const c = { id: nextId('KL'), kind: 'partner', status: 'offen', reason: ev.reasons.join(' '), selection: { ...state.partner.selection }, at: nowIso() };
      state.clarifications.push(c);
      audit('Klärungsfall Partner angelegt', c.id, c.reason);
      flash(`${c.id} angelegt – Partner nicht bestätigt.`, 'warn');
    });
  },

  partnerConfirm(reason) {
    return run('partnerConfirm', [reason], () => {
      const ev = evalPartner(state.partner.selection);
      state.partner = { ...state.partner, confirmed: true, confirmedBy: person().name, at: nowIso(), reason: reason.trim(), certId: ev.cert.id };
      audit('Partner bestätigt', `Ergo-Tec / ${ev.cert.id}`, `${ev.cert.standard}, Geltungsbereich „${ev.scope}“. Begründung: ${reason.trim()}. Zertifikat belegt keine Produktsicherheit.`, { reason: reason.trim() });
      flash('Partnerbestätigung dokumentiert. Hinweis: schließt R-04 nicht.');
    });
  },

  toggleCertMissing() {
    state.certMode.simulateMissing = !state.certMode.simulateMissing;
    audit('Testschalter', 'Zertifikatsdatei', state.certMode.simulateMissing ? 'Lokale Datei als fehlend simuliert' : 'Lokale Datei wieder verwendet', { internal: true });
    persist(); emit();
  },

  toggleSourceLink() {
    return run('toggleSourceLink', [], () => {
      state.certMode.sourceLinkOnly = !state.certMode.sourceLinkOnly;
      audit('Quelllink-Prototypmodus', 'Übergabe', state.certMode.sourceLinkOnly ? 'aktiviert – Paket ist KEINE vollständige Akte' : 'deaktiviert');
    });
  },

  // Package records; the ZIP itself is built in export.js from the stored snapshot.
  registerDraft(snapshot, gaps) {
    let res;
    run('exportDraft', [], () => {
      const h = hash({ snapshot, gaps });
      const ex = state.drafts.find(d => d.hash === h);
      if (ex) {
        audit('Arbeitsstand erneut bereitgestellt', ex.id, 'Unveränderter Stand – kein neuer Arbeitsstand');
        flash(`Unveränderter Stand: ${ex.id} erneut bereitgestellt.`, 'warn');
        res = ex; return;
      }
      const d = { id: nextId('AS'), hash: h, at: nowIso(), by: person().name, snapshot, gaps };
      state.drafts.push(d);
      audit('Arbeitsstand exportiert', d.id, `${gaps.length} offene Punkte – ARBEITSSTAND, keine Übergabe`);
      flash(`${d.id} erzeugt (Arbeitsstand mit Lückenliste).`);
      res = d;
    });
    return res;
  },

  registerFormal() {
    let res;
    run('exportFormal', [], () => {
      const snapshot = evidenceSnapshot();
      const h = hash(snapshot);
      const cur = currentPackage();
      if (cur && cur.hash === h) {
        audit('Paket erneut bereitgestellt', cur.id, 'Unveränderter Nachweisstand – identisches Paket');
        flash(`Unveränderter Stand: ${cur.id} wird erneut bereitgestellt (kein neues Paket).`, 'warn');
        res = cur; return;
      }
      const pkg = {
        id: `P-${String(state.packages.length + 1).padStart(2, '0')}`, hash: h, at: nowIso(), by: person().name,
        status: 'übergeben', snapshot, sourceLinkOnly: snapshot.cert.mode === 'source_link',
        log: recipientLog(),
      };
      if (cur) { cur.status = 'ersetzt'; cur.supersededBy = pkg.id; }
      state.packages.push(pkg);
      audit('Formales Paket erzeugt', pkg.id, `Snapshot ${h}${pkg.sourceLinkOnly ? ' – QUELLLINK-PROTOTYP, keine vollständige Akte' : ''}${cur ? `; ${cur.id} bleibt unverändert (ersetzt)` : ''}`);
      flash(`${pkg.id} eingefroren und an OEM übergeben.`);
      res = pkg;
    });
    return res;
  },

  acceptPackage(id, reason) {
    const pkg = state.packages.find(p => p.id === id);
    return run('acceptPackage', [pkg], () => {
      pkg.acceptance = { by: person().name, at: nowIso(), hash: pkg.hash, reason: (reason || '').trim() };
      pkg.status = 'angenommen';
      audit('Paket angenommen', pkg.id, `Version/Snapshot ${pkg.hash}${reason ? `: ${reason.trim()}` : ''}`, { version: pkg.hash });
      flash(`${pkg.id} (Snapshot ${pkg.hash}) angenommen.`);
    });
  },

  askQuestion(f) {
    return run('askQuestion', [f], () => {
      const pkg = currentPackage() || state.packages.at(-1);
      const q = { id: nextId('RF'), packageId: pkg.id, doc: f.doc, page: f.page || '1', text: f.text.trim(), by: person().name, at: nowIso() };
      state.questions.push(q);
      audit('OEM-Rückfrage', q.id, `${pkg.id} · ${q.doc} S. ${q.page}: ${q.text}`);
      flash(`${q.id} an QM gesendet.`);
    });
  },

  answerQuestion(id, text, changesEvidence) {
    const q = state.questions.find(x => x.id === id);
    let newPkg = null;
    const ok = run('answerQuestion', [q, text], () => {
      q.answer = { text: text.trim(), by: person().name, at: nowIso(), changesEvidence: !!changesEvidence };
      audit('Rückfrage beantwortet', q.id, text.trim());
      if (changesEvidence) {
        const s = { id: nextId('QM-ST'), text: text.trim(), ref: `${q.id} (${q.doc} S. ${q.page})`, by: person().name, at: nowIso() };
        state.supplements.push(s);
        audit('Nachweisstand ergänzt', s.id, `QM-Stellungnahme zu ${q.id} wird Teil der Akte`);
      }
      flash(changesEvidence ? 'Antwort gespeichert; Nachweisstand geändert – neues Paket wird erzeugt.' : 'Antwort gespeichert; Nachweisstand unverändert, Paket bleibt gültig.');
    });
    if (ok && changesEvidence) {
      newPkg = actions.registerFormal();
      if (newPkg) q.answer.newPackageId = newPkg.id;
      persist(); emit();
    }
    return newPkg;
  },

  setRoute(route, reason) {
    return run('setRoute', [route, reason], () => {
      const from = state.route.status;
      state.route.status = route;
      state.route.history.push({ from, to: route, reason: reason.trim(), by: person().name, at: nowIso() });
      audit('Regulatorischer Weg gesetzt', 'RA', `${ROUTES[from]} → ${ROUTES[route]}. Begründung: ${reason.trim()}`, { reason: reason.trim() });
      flash(`Regulatorischer Weg: ${ROUTES[route]}.`);
    });
  },

  release(reason) {
    return run('release', [reason], () => {
      const pkg = currentPackage();
      state.release = { by: person().name, at: nowIso(), packageId: pkg.id, hash: pkg.hash, route: state.route.status, reason: reason.trim() };
      audit('OEM-Freigabe R2/B', pkg.id, `Separate Herstellerentscheidung auf Basis ${pkg.id} (${pkg.hash}). Keine CE-/Behördenaussage. R1 unverändert. Begründung: ${reason.trim()}`, { reason: reason.trim(), version: pkg.hash });
      flash(`R2/B durch OEM freigegeben (Basis ${pkg.id}).`);
    });
  },

  activateService() {
    return run('activateService', [], () => {
      const fx = SRC.seed.service_fixture;
      const simAt = new Date(new Date(state.release.at).getTime() + 1000 * 60 * 60 * 24 * 183).toISOString();
      state.service = { activatedAt: nowIso(), simulatedNow: simAt, serial: fx.serial, revision: fx.revision, part: fx.part, delivery: fx.delivery_ref, packageId: state.release.packageId, source: fx.source, opened: false };
      audit('Synthetischer Zeitsprung aktiviert', fx.serial, `Simulierte Zeit ${simAt.slice(0, 10)}; Paket ${state.release.packageId}; Lieferung ${fx.delivery_ref}`);
      flash(`Zeitsprung aktiv: ${fx.serial} ausgeliefert mit ${state.release.packageId}.`);
    });
  },

  searchSerial(q) {
    const hit = state.service && q.trim().toUpperCase() === state.service.serial;
    if (hit && !state.service.opened) {
      state.service.opened = true;
      audit('Baustand geöffnet', state.service.serial, `R2/B, Paket ${state.service.packageId}, ${state.service.delivery}`);
    }
    ui.flash = hit ? { type: 'ok', text: `${state.service.serial} gefunden.` } : { type: 'warn', text: `Keine gebaute Einheit zu „${q}“ gefunden.` };
    persist(); emit();
  },

  createRaTask() {
    return run('createRaTask', [], () => {
      const t = { id: nextId('AUF'), kind: 'ra-sv01', title: 'SV-01: fachliche RA-Bewertung (keine automatische Behördenmeldung)', owner: 'J. Krüger (RA, BeispielMed)', source: `SV-01 / ${state.service.serial} / ${state.service.packageId}`, reason: 'Servicemeldung: Liege bleibt gelegentlich nicht auf eingestellter Höhe; Bezug R-04', due: '', status: 'offen', createdBy: person().name, at: nowIso() };
      state.tasks.push(t);
      state.service.raTask = t.id;
      audit('RA-Bewertungsaufgabe erstellt', t.id, t.source);
      flash(`${t.id} an OEM/RA übergeben.`);
    });
  },

  oemAware() {
    return run('oemAware', [], () => {
      state.service.oemAwareAt = nowIso();
      state.service.oemAwareSim = state.service.simulatedNow;
      state.service.oemAwareBy = person().name;
      audit('Kenntniszeitpunkt OEM erfasst', 'SV-01', `Simulierte Zeit ${state.service.simulatedNow.slice(0, 10)}; erfasst durch ${person().name}`);
      flash('Kenntniszeitpunkt dokumentiert. Keine automatische Behördenmeldung.');
    });
  },
};

// Recipient-specific decision log: OEM-relevant decisions only, no internal notes.
export function recipientLog() {
  const keep = ['Zuordnung bestätigt', 'Auswirkungsbewertung bestätigt', 'Prüfauftrag erstellt', 'Nachweis angenommen', 'Nachweis abgelehnt',
    'Blockierende Abweichung angelegt', 'Korrekturmaßnahme dokumentiert', 'Wirksamkeit bestätigt, Abweichung geschlossen', 'Partner bestätigt',
    'Rückfrage beantwortet', 'Nachweisstand ergänzt', 'Quelllink-Prototypmodus'];
  return state.audit.filter(a => !a.internal && keep.includes(a.action)).map(a => ({ ts: a.ts, actor: a.actor, title: a.title, action: a.action, object: a.object, detail: a.detail }));
}

export function gapList() {
  const g = [];
  if (!state.change.confirmed) g.push('PCN-01: Zuordnung nicht bestätigt');
  if (!state.impact.confirmed) g.push('Auswirkungsbewertung offen');
  if (!state.testOrder) g.push('Prüfauftrag PA-04 nicht erstellt');
  if (state.risk.status !== 'closed') g.push('R-04: Nachweis für R2/B fehlt (PB-17 belegt nur R1/A)');
  openDeviations().forEach(d => g.push(`Abweichung ${d.id} offen: ${d.title}`));
  if (!state.partner.confirmed) g.push('Partner / Zertifikat nicht bestätigt');
  if (!certAvailable()) g.push('Zertifikats-PDF lokal nicht vorhanden');
  return g;
}

// The single "next required action" shown in the header.
// Next step for the demo: who (persona), where (screen) and which card to
// jump to. The header button switches to that persona.
export function nextAction() {
  const s = state;
  const step = (who, text, screen, card) => ({ who, role: PERSONS.find(p => p.id === who).name, text, screen, card });
  if (!s.inbox.some(m => m.kind === 'pcn')) return step('eng', 'PCN-01 aus dem Posteingang übernehmen', 'eingang', 'Posteingang (simuliert)');
  if (!s.change.confirmed) return step('eng', 'Zuordnung Position 020 (MH-A → MH-B) bestätigen', 'eingang', 'Zuordnung zur Stückliste');
  if (!s.impact.confirmed) return step('eng', 'Auswirkungsbewertung bestätigen', 'eingang', 'Auswirkungsbewertung (Entwicklung)');
  if (!s.tasks.some(t => t.kind === 'qm-r04')) return step('eng', 'QM-Aufgabe für R-04 erstellen', 'eingang', 'QM-Aufgabe');
  if (!s.testOrder) return step('qm1', 'Prüfauftrag nach PA-04 erstellen', 'pruefung', 'Prüfauftrag');
  if (!s.reports.length) return step('qm1', 'Prüfbericht aus simuliertem Laboreingang übernehmen', 'pruefung', 'Simulierter Laboreingang');
  if (s.reports.some(r => !r.review)) return step('qm1', 'Importierten Bericht bewerten', 'pruefung', 'Eingegangene Berichte & QM-Bewertung');
  if (s.risk.status !== 'closed') return step('qm1', 'Geeigneten Bericht R2/B Endfassung importieren und annehmen', 'pruefung', 'Simulierter Laboreingang');
  const od = openDeviations();
  if (od.length) return step('qm1', `Abweichung ${od[0].id}: ${od[0].correction ? 'Wirksamkeit nachweisen und schließen' : 'Korrekturmaßnahme dokumentieren'}`, 'pruefung', 'Abweichungen');
  if (!s.partner.confirmed) return step('qm1', 'Partner & Zertifikat prüfen und bestätigen', 'partner', 'Auswahl');
  const pkg = currentPackage();
  if (!pkg) return step('qm1', 'Formales Übergabepaket erzeugen', 'uebergabe', 'Übergabebereitschaft');
  if (openQuestions().length) return step('qm1', `Rückfrage ${openQuestions()[0].id} beantworten`, 'uebergabe', 'OEM-Rückfragen');
  if (!pkg.acceptance) return step('oem1', `Paket ${pkg.id} prüfen und annehmen`, 'uebergabe', 'Übergabepakete');
  if (!['internal_confirmed', 'external_fulfilled'].includes(s.route.status)) return step('ra1', 'Regulatorischen Weg festlegen', 'uebergabe', 'Regulatorischer Weg (RA)');
  if (!s.release) return step('oem1', 'R2/B separat freigeben', 'uebergabe', 'Separate OEM-Freigabe R2/B');
  if (!s.service) return step('svc', 'Synthetischen Zeitsprung aktivieren', 'service', 'Synthetischer Zeitsprung');
  if (!s.service.opened) return step('svc', `${s.service.serial} suchen und Baustand öffnen`, 'service', 'Seriennummernsuche');
  if (!s.service.raTask) return step('svc', 'RA-Bewertungsaufgabe aus SV-01 erstellen', 'service', 'Servicefall SV-01');
  if (!s.service.oemAwareAt) return step('oem1', 'Kenntniszeitpunkt erfassen', 'service', 'Servicefall SV-01');
  return { who: null, role: '–', text: 'Demo-Durchlauf abgeschlossen', screen: 'service', card: null };
}
