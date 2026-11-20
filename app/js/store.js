// Shared application state, business rules and actions.
// One state object drives every screen. Persisted in localStorage (demo session only).
import { PERSONS, ROUTES, EXTERNAL_KIND, SCENARIOS, ANNEX_I } from './data.js';

export const STORAGE_KEY = 'devoreo.ul01.demo.v1';
const UI_KEY = 'devoreo.ul01.ui.v1';
const SCHEMA = 2;

let SRC = null; // loaded sources (seed, bom, eml, cert availability)
let state = null;
let ui = null;
const listeners = new Set();

export const getSources = () => SRC;
export const getState = () => state;
export const getUi = () => ui;
export const subscribe = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

function freshRoute(scenario) {
  if (scenario !== 'external') return { status: 'unresolved', history: [] };
  const entry = {
    from: 'unresolved', to: 'external_required', kind: 'genehmigung', by: 'Testdatensatz', at: new Date().toISOString(),
    classification: 'Wesentliche Änderung – Genehmigung der zuständigen Stelle erforderlich (synthetische Annahme)',
    reason: 'Vorgabe des Testdatensatzes „Externe Genehmigung ausstehend“.', evidence: 'Testdatensatz (kein reales Verfahren)',
  };
  return { status: 'external_required', kind: 'genehmigung', classification: entry.classification, evidence: entry.evidence, history: [entry] };
}

function freshState(scenario = 'classI') {
  const init = SRC.seed.initial_state;
  return {
    schema: SCHEMA,
    scenario,
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
    exclusions: {},       // MDR Annex I section no. -> confirmed justified exclusion
    partner: { selection: { company: '', site: '', activity: '', cert: '' }, confirmed: init.partner_confirmed },
    certMode: { simulateMissing: false, sourceLinkOnly: false },
    tests: { exportError: false },
    supplements: [],
    packages: [],
    drafts: [],
    questions: [],
    route: freshRoute(scenario),
    release: init.release,
    service: init.service,
    repairs: [],
    audit: [],
    seq: {},
  };
}

function freshUi() {
  return { screen: 'akte', revision: 'R2', viewer: null, forms: {}, flash: null, auditOpen: false, worklistOpen: false, openPackage: null, regFilter: 'alle', exportError: null };
}

export function init(sources) {
  SRC = sources;
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { state = null; }
  if (!state || state.schema !== SCHEMA) state = freshState();
  try { ui = { ...freshUi(), ...JSON.parse(localStorage.getItem(UI_KEY)) }; } catch { ui = freshUi(); }
  ui.flash = null;
  ui.confirmReset = false;
  ui.confirmScenario = null;
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

// Clears ONLY this demo's keys; source files are untouched. Keeps the
// current test dataset unless another one is given.
export function resetDemo(scenario = state?.scenario || 'classI') {
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(UI_KEY); } catch { /* storage unavailable */ }
  state = freshState(scenario);
  ui = freshUi();
  audit('Demo zurückgesetzt', 'Sitzung', `Neuer Demo-Durchlauf · Testdatensatz: ${SCENARIOS[scenario].label}`);
  persist();
  emit();
}

// ---------------------------------------------------------------- helpers
export const person = (id = state.personId) => PERSONS.find(p => p.id === id);
export const nowIso = () => new Date().toISOString();
export const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * 864e5).toISOString().slice(0, 10);
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
export const routeLabel = (status = state.route.status, kind = state.route.kind) =>
  status === 'external_required' && kind ? `Externe ${EXTERNAL_KIND[kind]} erforderlich` : ROUTES[status];

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

// MDR Annex I register with the live status of each section.
export function registerRows() {
  return ANNEX_I.map(a => {
    if (a.demo === 'r04') return { ...a, status: state.risk.status === 'closed' ? 'nachweis' : 'offen', link: 'R-04' };
    if (a.demo === 'pre') return { ...a, status: 'vorbestätigt' };
    const ex = state.exclusions[a.no];
    return { ...a, status: ex ? 'nicht anwendbar' : 'offen', exclusion: ex || null };
  });
}
export const openExclusions = () => registerRows().filter(r => r.demo === 'na' && r.status === 'offen');

export const openDeviations = () => state.deviations.filter(d => d.status !== 'geschlossen');
export const acceptedReport = () => state.reports.find(r => r.review?.status === 'angenommen');
export const currentPackage = () => [...state.packages].reverse().find(p => p.status !== 'ersetzt');
export const openQuestions = () => state.questions.filter(q => !q.answer);
const openMappingClarification = () => state.clarifications.find(c => c.kind === 'zuordnung' && c.status === 'offen');

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
    deviations: state.deviations.map(d => ({ id: d.id, status: d.status, rework: d.rework?.text, correction: d.correction?.text, effectiveness: d.effectiveness?.text })),
    supplements: state.supplements.map(s => ({ id: s.id, text: s.text, ref: s.ref, by: s.by })),
    register: registerRows().map(r => ({ no: r.no, title: r.title, status: r.status, reason: r.exclusion?.reason || null, by: r.exclusion?.by || null })),
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
const posHasOld = pos => SRC.bom.R1.find(r => r.position === pos)?.article_id === SRC.seed.change.old_article;

export const guards = {
  importPcn: () => roleNeed(['einkauf']),
  confirmMapping: () => [
    ...roleNeed(['einkauf']),
    ...need(state.inbox.some(m => m.messageId === SRC.eml.messageId), 'PCN-01 wurde noch nicht aus dem Posteingang übernommen.'),
    ...need(!state.change.confirmed, 'Zuordnung bereits bestätigt.'),
  ],
  correctMapping: (pos, reason) => [
    ...guards.confirmMapping(),
    ...need(!!state.change.mapping && pos !== state.change.mapping.position, 'Gewählte Position entspricht dem Vorschlag – dafür „Zuordnung bestätigen“ verwenden.'),
    ...(pos && !posHasOld(pos) ? [`Position ${pos} enthält nicht den abgekündigten Artikel ${SRC.seed.change.old_article} – Korrektur unzulässig. Bei Unklarheit Klärungsauftrag anlegen.`] : []),
    ...need(!blank(reason), 'Begründung der Korrektur fehlt.'),
  ],
  clarifyMapping: (reason) => [
    ...guards.confirmMapping(),
    ...need(!openMappingClarification(), `Klärungsauftrag ${openMappingClarification()?.id} ist bereits offen.`),
    ...need(!blank(reason), 'Beschreiben, was an der Zuordnung unklar ist.'),
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
  excludeReq: (no, reason) => {
    const row = registerRows().find(r => r.no === Number(no));
    return [
      ...roleNeed(['qm'], { authorized: true }),
      ...need(row?.demo === 'na', `Nr. ${no} ist im Demofall nicht als Ausschluss vorgesehen.`),
      ...need(row?.status === 'offen', `Ausschluss Nr. ${no} ist bereits bestätigt.`),
      ...need(!blank(reason), 'Ein Ausschluss braucht eine fachliche Begründung.'),
    ];
  },
  excludeAll: () => [
    ...roleNeed(['qm'], { authorized: true }),
    ...need(openExclusions().length > 0, 'Keine offenen Ausschlussvorschläge.'),
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
  assignRework: (d, f) => [
    ...roleNeed(['qm']),
    ...need(!d.rework, `Nacharbeit zu ${d.id} ist bereits zugewiesen.`),
    ...need(!blank(f?.owner), 'Verantwortliche Person wählen.'),
    ...need(!blank(f?.text), 'Beschreiben, was nachzuarbeiten ist.'),
    ...need(!blank(f?.due), 'Fälligkeit fehlt.'),
  ],
  devCorrection: (d, text) => [
    ...roleNeed(['einkauf', 'qm']),
    ...need(!!d.rework, 'Zuerst die Nacharbeit zuweisen (Verantwortliche Person und Frist).'),
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
  setRoute: (f) => {
    const to = f?.route;
    return [
      ...roleNeed(['oem'], { ra: true }),
      ...need(!state.release, 'R2/B bereits freigegeben – Verfahrensstatus ist eingefroren.'),
      ...need(to && (to !== state.route.status || (to === 'external_required' && f.kind && f.kind !== state.route.kind)), 'Neuen Status wählen.'),
      ...(state.scenario === 'external' && ['internal_confirmed', 'unresolved'].includes(to)
        ? ['Testdatensatz „Externe Genehmigung ausstehend“: Ein interner Herstellerweg ist hier nicht zulässig.'] : []),
      ...(to === 'external_required' && blank(f.kind) ? ['Art der externen Voraussetzung wählen (Mitteilung oder Genehmigung).'] : []),
      ...(to === 'external_fulfilled' && state.route.status !== 'external_required'
        ? ['„Externe Voraussetzung erfüllt“ setzt eine zuvor festgestellte externe Mitteilung oder Genehmigung voraus.'] : []),
      ...need(!blank(f?.classification), 'Regulatorische Einordnung fehlt.'),
      ...need(!blank(f?.reason), 'Dokumentierte Begründung fehlt.'),
      ...need(!blank(f?.evidence), to === 'external_fulfilled'
        ? 'Beleg fehlt: Ergebnis der zuständigen Stelle bzw. Nachweis der erledigten Mitteilung angeben.'
        : 'Beleg fehlt (z. B. interne Bewertung, Dokumentnummer).'),
    ];
  },
  release: (f) => [
    ...roleNeed(['oem'], { authorized: true }),
    ...releaseBlockers(),
    ...need(!blank(f?.doc), 'Geltungsbereich der EU-Konformitätserklärung dokumentieren.'),
    ...need(!blank(f?.label), 'Kennzeichnung dokumentieren.'),
    ...need(!blank(f?.lots), 'Betroffene Serienlose angeben.'),
    ...need(!blank(f?.reason), 'Begründung der Freigabeentscheidung fehlt.'),
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
  raAssess: (f) => [
    ...roleNeed(['oem'], { ra: true }),
    ...need(!!state.service?.oemAwareAt, 'Zuerst den Kenntniszeitpunkt beim OEM erfassen.'),
    ...need(!state.service?.assessment, 'Servicefall ist bereits bewertet.'),
    ...need(!blank(f?.duty), 'Meldepflicht beurteilen (ja / nein).'),
    ...(f?.duty === 'ja' && (blank(f?.addressee) || blank(f?.deadline)) ? ['Bei Meldepflicht Adressat und Frist angeben.'] : []),
    ...need(!blank(f?.text), 'Fachliche Bewertung fehlt.'),
    ...need(!blank(f?.next), 'Nächste Maßnahme fehlt.'),
  ],
  reportExternal: (ref) => [
    ...roleNeed(['oem'], { ra: true }),
    ...need(state.service?.assessment?.duty === 'ja', 'Nur bei festgestellter Meldepflicht.'),
    ...need(!state.service?.externalReport, 'Externe Meldung bereits dokumentiert.'),
    ...need(!blank(ref), 'Aktenzeichen / Referenz der Meldung angeben.'),
  ],
  followUp: (text) => [
    ...roleNeed(['oem'], { ra: true }),
    ...need(!!state.service?.assessment, 'Zuerst den Servicefall regulatorisch bewerten.'),
    ...need(state.service?.assessment?.duty !== 'ja' || !!state.service?.externalReport, 'Meldepflicht festgestellt: externe Meldung zuerst als eigene Handlung dokumentieren.'),
    ...need(!state.service?.followUp, 'Nachverfolgung bereits dokumentiert.'),
    ...need(!blank(text), 'Ergebnis der Nachverfolgung fehlt.'),
  ],
  recordRepair: (f) => [
    ...roleNeed(['service']),
    ...need(!!state.service?.opened, 'Zuerst Seriennummer suchen und Baustand öffnen.'),
    ...need(f?.serial === state.service?.serial, 'Seriennummer muss einem gebauten Gerät entsprechen.'),
    ...(f?.part && f.part !== `MH-${state.service?.part}` ? [`Ersatzteil ${f.part} weicht vom Baustand ${state.service.revision}/${state.service.part} ab – Umbau nur über eine eigene Änderungsbewertung.`] : []),
    ...need(!blank(f?.part), 'Ersatzteil wählen.'),
    ...need(!blank(f?.protocol), 'Prüfprotokoll angeben.'),
    ...need(!blank(f?.tech), 'Verantwortliche Fachperson angeben.'),
    ...need(!blank(f?.controlDue), 'Fälligkeit der nächsten Kontrolle angeben.'),
  ],
};

export function formalBlockers() {
  const r = [];
  if (!state.change.confirmed) r.push('Änderung PCN-01 nicht bestätigt.');
  if (!state.impact.confirmed) r.push('Auswirkungsbewertung fehlt.');
  if (state.risk.status !== 'closed') r.push('R-04: kein von QM angenommener geeigneter Nachweis.');
  openDeviations().forEach(d => r.push(`Blockierende Abweichung ${d.id} offen.`));
  const ex = openExclusions();
  if (ex.length) r.push(`MDR Anhang I Nr. ${ex.map(x => x.no).join(', ')}: weder belegt noch begründet ausgeschlossen.`);
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
  if (pkg && !state.release && hash(evidenceSnapshot()) !== pkg.hash) r.push(`Nachweisstand hat sich seit ${pkg.id} geändert – neues Paket erforderlich.`);
  if (state.risk.status !== 'closed') r.push('R-04 offen.');
  openDeviations().forEach(d => r.push(`Abweichung ${d.id} offen.`));
  if (openExclusions().length) r.push('Nicht alle anwendbaren Pflichtpunkte belegt oder begründet ausgeschlossen.');
  if (!state.partner.confirmed) r.push('Partnerbestätigung fehlt.');
  if (openQuestions().length) r.push(`${openQuestions().length} offene OEM-Rückfrage(n).`);
  if (state.route.status === 'unresolved') r.push('Verfahrensstatus ungeklärt (RA).');
  if (state.route.status === 'external_required') r.push(`${routeLabel()} – Ergebnis der zuständigen Stelle fehlt (RA).`);
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
      state.clarifications.push({ id: nextId('KL'), kind: 'artikel', article: 'MH-X9', source: id, status: 'offen', owner: 'A. Becker (Einkauf)', reason: 'Artikel MH-X9 in keiner Stückliste UL-01 gefunden – keine automatische Verknüpfung.', at: nowIso() });
      audit('Klärungsfall angelegt', 'MH-X9', 'Unbekannter Artikel – nicht automatisch verknüpft');
      flash('Unbekannter Artikel MH-X9 → Klärungsliste. Keine Verknüpfung mit der Stückliste.', 'warn');
    });
  },

  confirmMapping() {
    return run('confirmMapping', [], () => {
      const m = state.change.mapping;
      Object.assign(m, { confirmedBy: person().name, at: nowIso(), corrected: false });
      settleMapping(`Position ${m.position}: ${m.old} → ${m.proposed}. Hinweis: PCN ist keine Einbaufreigabe.`);
      audit('Zuordnung bestätigt', 'PCN-01', `Position ${m.position}: ${m.old} → ${m.proposed}. Hinweis: PCN ist keine Einbaufreigabe.`);
      flash(`Zuordnung PCN-01 → Position ${m.position} bestätigt. Änderungsfall liegt jetzt bei der Entwicklung.`);
    });
  },

  correctMapping(pos, reason) {
    return run('correctMapping', [pos, reason], () => {
      const m = state.change.mapping;
      const from = m.position;
      Object.assign(m, { position: pos, confirmedBy: person().name, at: nowIso(), corrected: true, correctedFrom: from, correctionReason: reason.trim() });
      settleMapping(`Korrigiert von Position ${from} auf ${pos}: ${reason.trim()}`);
      audit('Zuordnung korrigiert', 'PCN-01', `Vorschlag Pos. ${from} → bestätigt Pos. ${pos}. Begründung: ${reason.trim()}`, { reason: reason.trim() });
      flash(`Zuordnung korrigiert und bestätigt: Position ${pos}.`);
    });
  },

  clarifyMapping(reason) {
    return run('clarifyMapping', [reason], () => {
      const c = { id: nextId('KL'), kind: 'zuordnung', source: 'PCN-01', status: 'offen', owner: 'A. Becker (Einkauf)', reason: reason.trim(), at: nowIso() };
      state.clarifications.push(c);
      state.change.status = 'in_clarification';
      audit('Klärungsauftrag Zuordnung', c.id, reason.trim(), { reason: reason.trim() });
      flash(`${c.id} angelegt – Zuordnung bleibt in Klärung, bis sie bestätigt oder korrigiert wird.`, 'warn');
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
      const t = { id: nextId('AUF'), kind: 'qm-r04', title: 'Neuen Haltenachweis R-04 für R2/B beschaffen und bewerten', who: 'qm1', owner: 'Dr. M. Weber (QM)', source: 'PCN-01 / Auswirkungsbewertung', reason: f.reason.trim(), due: f.due, status: 'offen', createdBy: person().name, at: nowIso() };
      state.tasks.push(t);
      audit('QM-Aufgabe erstellt', t.id, `Verantwortlich ${t.owner}; fällig ${t.due}; Grund: ${t.reason}`);
      flash(`${t.id} an QM übergeben.`);
    });
  },

  excludeReq(no, reason) {
    return run('excludeReq', [no, reason], () => {
      state.exclusions[Number(no)] = { reason: reason.trim(), by: person().name, at: nowIso() };
      audit('Ausschluss bestätigt', `MDR Anhang I Nr. ${no}`, `Nicht anwendbar: ${reason.trim()}`, { reason: reason.trim() });
      flash(`Nr. ${no} begründet als nicht anwendbar bestätigt.`);
    });
  },

  // Confirms every open proposal with its proposed justification.
  excludeAll() {
    return run('excludeAll', [], () => {
      const rows = openExclusions();
      rows.forEach(r => { state.exclusions[r.no] = { reason: r.na, by: person().name, at: nowIso() }; });
      audit('Ausschlüsse bestätigt', 'MDR Anhang I', rows.map(r => `Nr. ${r.no}: ${r.na}`).join(' · '));
      flash(`${rows.length} Ausschlüsse mit Begründung bestätigt.`);
    });
  },

  createTestOrder() {
    return run('createTestOrder', [], () => {
      state.testOrder = { id: 'TA-01', instruction: 'PA-04', target: 'UL-01 / Standard / R2 / Hubantrieb B (MH-B)', risk: 'R-04', by: person().name, at: nowIso(), due: addDays(nowIso(), 14), status: 'beauftragt' };
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
        flash(`${meta.id} v${meta.version} importiert – blockierende Abweichung ${d.id} angelegt. Nacharbeit zuweisen.`, 'warn');
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

  // Deviation: offen → in Nacharbeit → Korrektur dokumentiert → (Wirksamkeit geprüft) geschlossen.
  assignRework(id, f) {
    const d = state.deviations.find(x => x.id === id);
    return run('assignRework', [d, f], () => {
      const owner = PERSONS.find(p => p.id === f.owner);
      d.rework = { who: owner.id, owner: `${owner.name} (${owner.title})`, text: f.text.trim(), due: f.due, by: person().name, at: nowIso() };
      d.status = 'in Nacharbeit';
      audit('Nacharbeit zugewiesen', d.id, `${d.rework.owner}, fällig ${f.due}: ${f.text.trim()}`);
      flash(`Nacharbeit zu ${d.id} an ${owner.name} zugewiesen (fällig ${f.due}).`);
    });
  },

  devCorrection(id, text) {
    const d = state.deviations.find(x => x.id === id);
    return run('devCorrection', [d, text], () => {
      d.correction = { text: text.trim(), by: person().name, at: nowIso() };
      d.status = 'Korrektur dokumentiert';
      audit('Korrekturmaßnahme dokumentiert', d.id, text.trim());
      flash(`Korrektur zu ${d.id} dokumentiert. Wirksamkeit separat durch QM nachweisen.`);
    });
  },

  devClose(id, text) {
    const d = state.deviations.find(x => x.id === id);
    return run('devClose', [d, text], () => {
      const acc = acceptedReport();
      d.effectiveness = { text: text.trim(), by: person().name, at: nowIso(), evidence: acc.uid };
      d.status = 'geschlossen';
      audit('Wirksamkeit bestätigt, Abweichung geschlossen', d.id, `${text.trim()} (Bezug ${acc.id} v${acc.version})`, { reason: text.trim() });
      flash(`${d.id}: Wirksamkeit geprüft, Abweichung geschlossen.`);
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
      const c = { id: nextId('KL'), kind: 'partner', status: 'offen', owner: 'Dr. M. Weber (QM)', reason: ev.reasons.join(' '), selection: { ...state.partner.selection }, at: nowIso() };
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

  toggleExportError() {
    state.tests.exportError = !state.tests.exportError;
    audit('Testschalter', 'Export', state.tests.exportError ? 'Exportfehler wird simuliert' : 'Exportfehler-Simulation aus', { internal: true });
    persist(); emit();
  },

  toggleSourceLink() {
    return run('toggleSourceLink', [], () => {
      state.certMode.sourceLinkOnly = !state.certMode.sourceLinkOnly;
      audit('Quelllink-Prototypmodus', 'Übergabe', state.certMode.sourceLinkOnly ? 'aktiviert – Paket ist KEINE vollständige Akte' : 'deaktiviert');
    });
  },

  // Exports run in two steps so a failed ZIP build changes nothing:
  // *Candidate() checks the rules and prepares the record without storing
  // it, the caller builds the ZIP, and only then commit*() stores it.
  draftCandidate() {
    const reasons = guards.exportDraft();
    if (reasons.length) { ui.flash = { type: 'error', text: `Aktion nicht zulässig: ${reasons.join(' ')}` }; emit(); return null; }
    const snapshot = { ...evidenceSnapshot(), route: state.route.status };
    const gaps = gapList();
    const h = hash({ snapshot, gaps });
    const ex = state.drafts.find(d => d.hash === h);
    if (ex) return { draft: ex, existing: true };
    return { draft: { id: `AS-${String((state.seq.AS || 0) + 1).padStart(2, '0')}`, hash: h, at: nowIso(), by: person().name, snapshot, gaps }, existing: false };
  },

  commitDraft({ draft, existing }) {
    if (existing) {
      audit('Arbeitsstand erneut bereitgestellt', draft.id, 'Unveränderter Stand – kein neuer Arbeitsstand');
    } else {
      nextId('AS');
      state.drafts.push(draft);
      audit('Arbeitsstand exportiert', draft.id, `${draft.gaps.length} offene Punkte – ARBEITSSTAND, keine Übergabe`);
    }
    persist();
    return draft;
  },

  formalCandidate() {
    const reasons = guards.exportFormal();
    if (reasons.length) { ui.flash = { type: 'error', text: `Aktion nicht zulässig: ${reasons.join(' ')}` }; emit(); return null; }
    const snapshot = evidenceSnapshot();
    const h = hash(snapshot);
    const cur = currentPackage();
    if (cur && cur.hash === h) return { pkg: cur, existing: true };
    return {
      existing: false,
      pkg: {
        id: `P-${String(state.packages.length + 1).padStart(2, '0')}`, hash: h, at: nowIso(), by: person().name,
        recipient: 'BeispielMed Systeme GmbH (fiktiv)', status: 'übergeben', snapshot, sourceLinkOnly: snapshot.cert.mode === 'source_link',
        log: recipientLog(),
      },
    };
  },

  commitFormal({ pkg, existing }) {
    if (existing) {
      audit('Paket erneut bereitgestellt', pkg.id, 'Unveränderter Nachweisstand – identisches Paket');
      persist();
      return pkg;
    }
    const cur = currentPackage();
    if (cur) { cur.status = 'ersetzt'; cur.supersededBy = pkg.id; }
    state.packages.push(pkg);
    state.questions.filter(q => q.answer?.changesEvidence && !q.answer.newPackageId).forEach(q => { q.answer.newPackageId = pkg.id; });
    audit('Formales Paket erzeugt', pkg.id, `Empfänger ${pkg.recipient}; Snapshot ${pkg.hash}${pkg.sourceLinkOnly ? ' – QUELLLINK-PROTOTYP, keine vollständige Akte' : ''}${cur ? `; ${cur.id} bleibt unverändert (ersetzt)` : ''}`);
    persist();
    return pkg;
  },

  acceptPackage(id, reason) {
    const pkg = state.packages.find(p => p.id === id);
    return run('acceptPackage', [pkg], () => {
      pkg.acceptance = { by: person().name, at: nowIso(), hash: pkg.hash, reason: (reason || '').trim() };
      pkg.status = 'angenommen';
      audit('Paket angenommen', pkg.id, `Version/Snapshot ${pkg.hash}${reason ? `: ${reason.trim()}` : ''}`, { version: pkg.hash });
      flash(`${pkg.id} (Snapshot ${pkg.hash}) angenommen. Die Serienfreigabe ist eine eigene Entscheidung.`);
    });
  },

  askQuestion(f) {
    return run('askQuestion', [f], () => {
      const pkg = currentPackage() || state.packages.at(-1);
      const q = { id: nextId('RF'), packageId: pkg.id, doc: f.doc, page: f.page || '1', text: f.text.trim(), by: person().name, at: nowIso(), due: addDays(nowIso(), 5) };
      state.questions.push(q);
      audit('OEM-Rückfrage', q.id, `${pkg.id} · ${q.doc} S. ${q.page}: ${q.text}`);
      flash(`${q.id} als Aufgabe an QM gesendet.`);
    });
  },

  // Records the answer. If it changes the evidence, the caller builds the
  // next package through the normal export flow.
  answerQuestion(id, text, changesEvidence) {
    const q = state.questions.find(x => x.id === id);
    return run('answerQuestion', [q, text], () => {
      q.answer = { text: text.trim(), by: person().name, at: nowIso(), changesEvidence: !!changesEvidence };
      audit('Rückfrage beantwortet', q.id, text.trim());
      if (changesEvidence) {
        const s = { id: nextId('QM-ST'), text: text.trim(), ref: `${q.id} (${q.doc} S. ${q.page})`, by: person().name, at: nowIso() };
        state.supplements.push(s);
        audit('Nachweisstand ergänzt', s.id, `QM-Stellungnahme zu ${q.id} wird Teil der Akte`);
      }
      flash(changesEvidence ? 'Antwort gespeichert; Nachweisstand geändert – neues Paket wird erzeugt.' : 'Antwort gespeichert; Nachweisstand unverändert, Paket bleibt gültig.');
      return { changesEvidence: !!changesEvidence };
    });
  },

  setRoute(f) {
    return run('setRoute', [f], () => {
      const from = state.route.status, fromLabel = routeLabel();
      const kind = f.route === 'external_required' ? f.kind : f.route === 'external_fulfilled' ? state.route.kind : null;
      const entry = { from, to: f.route, kind, classification: f.classification.trim(), reason: f.reason.trim(), evidence: f.evidence.trim(), by: person().name, at: nowIso() };
      state.route = { ...state.route, status: f.route, kind, classification: entry.classification, evidence: entry.evidence, history: [...state.route.history, entry] };
      audit('Verfahrensstatus gesetzt', 'R2/B', `${fromLabel} → ${routeLabel(f.route, kind)}. Einordnung: ${entry.classification}. Begründung: ${entry.reason}. Beleg: ${entry.evidence}`, { reason: entry.reason });
      flash(`Verfahrensstatus: ${routeLabel(f.route, kind)}.`);
    });
  },

  release(f) {
    return run('release', [f], () => {
      const pkg = currentPackage();
      state.release = {
        by: person().name, at: nowIso(), packageId: pkg.id, hash: pkg.hash, route: state.route.status, routeKind: state.route.kind,
        doc: f.doc.trim(), label: f.label.trim(), lots: f.lots.trim(), reason: f.reason.trim(),
      };
      audit('OEM-Freigabe Serienstand R2/B', pkg.id, `Basis ${pkg.id} (${pkg.hash}). EU-Konformitätserklärung: ${state.release.doc}. Kennzeichnung: ${state.release.label}. Serienlose: ${state.release.lots}. Begründung: ${state.release.reason}. Keine CE-/Behördenaussage des Prototyps; R1 und ausgelieferte Geräte unverändert.`, { reason: state.release.reason, version: pkg.hash });
      flash(`Serienstand R2/B durch OEM freigegeben (Basis ${pkg.id}, ab ${state.release.lots}).`);
    });
  },

  activateService() {
    return run('activateService', [], () => {
      const fx = SRC.seed.service_fixture;
      const simAt = new Date(new Date(state.release.at).getTime() + 1000 * 60 * 60 * 24 * 183).toISOString();
      state.service = { activatedAt: nowIso(), simulatedNow: simAt, serial: fx.serial, revision: fx.revision, part: fx.part, delivery: fx.delivery_ref, lots: state.release.lots, packageId: state.release.packageId, source: fx.source, opened: false, status: 'eingegangen' };
      audit('Synthetischer Zeitsprung aktiviert', fx.serial, `Simulierte Zeit ${simAt.slice(0, 10)}; Paket ${state.release.packageId}; Lieferung ${fx.delivery_ref}`);
      flash(`Zeitsprung aktiv: ${fx.serial} ausgeliefert mit ${state.release.packageId}.`);
    });
  },

  searchSerial(q) {
    const hit = state.service && q.trim().toUpperCase() === state.service.serial;
    if (hit && !state.service.opened) {
      state.service.opened = true;
      state.service.status = 'zugeordnet';
      audit('Baustand geöffnet', state.service.serial, `R2/B, Paket ${state.service.packageId}, ${state.service.delivery}`);
    }
    ui.flash = hit ? { type: 'ok', text: `${state.service.serial} gefunden.` } : { type: 'warn', text: `Keine gebaute Einheit zu „${q}“ gefunden.` };
    persist(); emit();
  },

  createRaTask() {
    return run('createRaTask', [], () => {
      const t = { id: nextId('AUF'), kind: 'ra-sv01', title: 'SV-01: fachliche RA-Bewertung (keine automatische Behördenmeldung)', who: 'ra1', owner: 'J. Krüger (RA, BeispielMed)', source: `SV-01 / ${state.service.serial} / ${state.service.packageId}`, reason: 'Servicemeldung: Liege bleibt gelegentlich nicht auf eingestellter Höhe; Bezug R-04', due: '', status: 'offen', createdBy: person().name, at: nowIso() };
      state.tasks.push(t);
      state.service.raTask = t.id;
      audit('RA-Bewertungsaufgabe erstellt', t.id, t.source);
      flash(`${t.id} an OEM/RA übergeben.`);
    });
  },

  // Awareness starts the review deadline. MDR Art. 87 sets reporting
  // deadlines of at most 15 days from awareness (shorter in severe cases);
  // the app only shows this as a hint.
  oemAware() {
    return run('oemAware', [], () => {
      const sv = state.service;
      sv.oemAwareAt = nowIso();
      sv.oemAwareSim = sv.simulatedNow;
      sv.oemAwareBy = person().name;
      sv.reviewDue = addDays(sv.simulatedNow, 15);
      const t = state.tasks.find(x => x.id === sv.raTask);
      if (t) t.due = sv.reviewDue;
      audit('Kenntniszeitpunkt OEM erfasst', 'SV-01', `Simulierte Zeit ${sv.simulatedNow.slice(0, 10)}; Prüffrist ${sv.reviewDue}; erfasst durch ${person().name}`);
      flash(`Kenntniszeitpunkt dokumentiert. Prüffrist ${sv.reviewDue}. Keine automatische Behördenmeldung.`);
    });
  },

  raAssess(f) {
    return run('raAssess', [f], () => {
      const sv = state.service;
      sv.assessment = { duty: f.duty, addressee: (f.addressee || '').trim(), deadline: f.deadline || '', text: f.text.trim(), next: f.next.trim(), by: person().name, at: nowIso() };
      sv.status = 'regulatorisch bewertet';
      const t = state.tasks.find(x => x.id === sv.raTask);
      if (t) t.status = 'bewertet';
      audit('Servicefall regulatorisch bewertet', 'SV-01', `Meldepflicht: ${f.duty}${f.duty === 'ja' ? `; Adressat ${sv.assessment.addressee}; Frist ${sv.assessment.deadline}` : ''}. Bewertung: ${sv.assessment.text}. Nächste Maßnahme: ${sv.assessment.next}`, { reason: sv.assessment.text });
      flash(f.duty === 'ja' ? 'Bewertet: Meldepflicht festgestellt. Die externe Meldung ist eine eigene Handlung.' : 'Bewertet: keine Meldepflicht. Nächste Maßnahme dokumentiert.');
    });
  },

  reportExternal(ref) {
    return run('reportExternal', [ref], () => {
      state.service.externalReport = { ref: ref.trim(), by: person().name, at: nowIso() };
      audit('Externe Meldung dokumentiert (simuliert)', 'SV-01', `Referenz ${ref.trim()} – kein tatsächlicher Versand aus dem Prototyp`);
      flash('Externe Meldung als erledigt dokumentiert (simuliert, kein Versand).');
    });
  },

  followUp(text) {
    return run('followUp', [text], () => {
      const sv = state.service;
      sv.followUp = { text: text.trim(), by: person().name, at: nowIso() };
      sv.status = 'nachverfolgt';
      const t = state.tasks.find(x => x.id === sv.raTask);
      if (t) t.status = 'erledigt';
      audit('Servicefall nachverfolgt', 'SV-01', text.trim());
      flash('Servicefall SV-01 nachverfolgt.');
    });
  },

  // Repair of a delivered unit: its own service record. A release for future
  // series units never changes devices already in the field.
  recordRepair(f) {
    return run('recordRepair', [f], () => {
      const r = {
        id: nextId('REP'), serial: f.serial, maker: 'BeispielMed Systeme GmbH (fiktiv) · UL-01 / Standard', build: `${state.service.revision}/${state.service.part}`,
        part: f.part, protocol: f.protocol.trim(), tech: f.tech.trim(), controlDue: f.controlDue, by: person().name, at: nowIso(),
      };
      state.repairs.push(r);
      audit('Reparatur im Bestand dokumentiert', r.id, `${r.serial} · Ersatzteil ${r.part} (wie verbaut) · Prüfprotokoll ${r.protocol} · Fachperson ${r.tech} · nächste Kontrolle ${r.controlDue}`);
      flash(`${r.id} dokumentiert. Nächste Kontrolle fällig ${r.controlDue}.`);
    });
  },
};

// Shared tail of confirm/correct: settles the change and any open
// clarification about the mapping.
function settleMapping(note) {
  state.change.confirmed = true;
  state.change.status = 'confirmed';
  const c = openMappingClarification();
  if (c) { c.status = 'geklärt'; c.resolution = note; c.resolvedAt = nowIso(); }
}

// Recipient-specific decision log: OEM-relevant decisions only, no internal notes.
export function recipientLog() {
  const keep = ['Zuordnung bestätigt', 'Zuordnung korrigiert', 'Auswirkungsbewertung bestätigt', 'Prüfauftrag erstellt', 'Nachweis angenommen', 'Nachweis abgelehnt',
    'Blockierende Abweichung angelegt', 'Nacharbeit zugewiesen', 'Korrekturmaßnahme dokumentiert', 'Wirksamkeit bestätigt, Abweichung geschlossen',
    'Ausschluss bestätigt', 'Ausschlüsse bestätigt', 'Partner bestätigt', 'Rückfrage beantwortet', 'Nachweisstand ergänzt', 'Quelllink-Prototypmodus'];
  return state.audit.filter(a => !a.internal && keep.includes(a.action)).map(a => ({ ts: a.ts, actor: a.actor, title: a.title, action: a.action, object: a.object, detail: a.detail }));
}

export function gapList() {
  const g = [];
  if (!state.change.confirmed) g.push('PCN-01: Zuordnung nicht bestätigt');
  if (!state.impact.confirmed) g.push('Auswirkungsbewertung offen');
  if (!state.testOrder) g.push('Prüfauftrag PA-04 nicht erstellt');
  if (state.risk.status !== 'closed') g.push('R-04: Nachweis für R2/B fehlt (PB-17 belegt nur R1/A)');
  openDeviations().forEach(d => g.push(`Abweichung ${d.id} offen: ${d.title}`));
  openExclusions().forEach(r => g.push(`MDR Anhang I Nr. ${r.no} (${r.title}): Ausschluss nicht bestätigt`));
  if (!state.partner.confirmed) g.push('Partner / Zertifikat nicht bestätigt');
  if (!certAvailable()) g.push('Zertifikats-PDF lokal nicht vorhanden');
  return g;
}

// Every open handover with its recipient: the worklists. Each item names
// project, revision, reason, source, due date and the next action.
export function worklist() {
  const s = state;
  const items = [];
  const add = (who, next, reason, source, due, screen, card) => items.push({ who, next, reason, source, due: due || '–', screen, card, project: 'UL-01 / Standard', revision: 'R2/B' });
  const pcn = s.inbox.find(m => m.kind === 'pcn');
  const day = iso => (iso || '').slice(0, 10);
  if (!pcn) add('eng', 'PCN-01 übernehmen', 'Lieferantenmeldung MusterHub: Abkündigung MH-A', 'Posteingang', '', 'eingang', 'Posteingang (simuliert)');
  else if (!s.change.confirmed) add('eng', openMappingClarification() ? `Klärung ${openMappingClarification().id}: Zuordnung bestätigen oder korrigieren` : 'Zuordnung bestätigen oder korrigieren', 'Änderungsfall PCN-01 zuordnen', 'PCN-01', addDays(pcn.importedAt, 3), 'eingang', 'Zuordnung zur Stückliste');
  s.clarifications.filter(c => c.kind === 'artikel' && c.status === 'offen').forEach(c => add('eng', `Klärung ${c.id}: Artikel ${c.article} prüfen`, c.reason, c.source, addDays(c.at, 5), 'eingang', 'Posteingang (simuliert)'));
  if (s.change.confirmed && !s.impact.confirmed) add('eng', 'Auswirkung bewerten', 'R2 enthält Antrieb B, PB-17 nennt A', 'PCN-01 / Pos. 020', addDays(s.change.mapping.at, 5), 'eingang', 'Auswirkungsbewertung (Entwicklung)');
  if (s.impact.confirmed && !s.tasks.some(t => t.kind === 'qm-r04')) add('eng', 'QM-Aufgabe für R-04 erstellen', 'Neuer Haltenachweis erforderlich', 'Auswirkungsbewertung', addDays(s.impact.at, 2), 'eingang', 'QM-Aufgabe');
  const qmTask = s.tasks.find(t => t.kind === 'qm-r04');
  if (qmTask && !s.testOrder) add('qm1', 'Prüfauftrag nach PA-04 erstellen', qmTask.reason, `${qmTask.id} / PCN-01`, qmTask.due, 'pruefung', 'Prüfauftrag');
  if (s.testOrder && !s.reports.length) add('qm1', 'Bericht aus Laboreingang übernehmen', 'Prüfauftrag TA-01 an Prüfstelle (simuliert)', 'TA-01', s.testOrder.due, 'pruefung', 'Simulierter Laboreingang');
  s.reports.filter(r => !r.review).forEach(r => add('qm1', `${r.id} v${r.version} bewerten`, 'Bericht eingegangen', 'Laboreingang', addDays(r.importedAt, 3), 'pruefung', 'Eingegangene Berichte & QM-Bewertung'));
  if (s.testOrder && s.reports.length && s.reports.every(r => r.review) && s.risk.status !== 'closed') add('qm1', 'Geeignete Endfassung R2/B importieren und annehmen', 'R-04 weiter offen', 'TA-01', s.testOrder.due, 'pruefung', 'Simulierter Laboreingang');
  s.deviations.filter(d => d.status !== 'geschlossen').forEach(d => {
    if (!d.rework) add('qm1', `${d.id}: Nacharbeit zuweisen`, d.title, d.reportUid.replace('@', ' v'), addDays(d.at, 2), 'pruefung', 'Abweichungen');
    else if (!d.correction) add(d.rework.who, `${d.id}: Korrektur durchführen und dokumentieren`, d.rework.text, d.id, d.rework.due, 'pruefung', 'Abweichungen');
    else add('qm1', `${d.id}: Wirksamkeit prüfen und schließen`, d.correction.text, d.id, addDays(d.correction.at, 3), 'pruefung', 'Abweichungen');
  });
  s.clarifications.filter(c => c.kind === 'partner' && c.status === 'offen').forEach(c => add('qm1', `Klärung ${c.id}: Partnernachweis`, c.reason, 'Partner & Zertifikate', addDays(c.at, 5), 'partner', 'Prüfung'));
  if (s.risk.status === 'closed' && openExclusions().length) add('qm1', `${openExclusions().length} Ausschlüsse (MDR Anhang I) begründet bestätigen`, 'Pflichtpunkte für das Übergabepaket', 'Regelregister', addDays(s.risk.at, 3), 'matrix', 'Regelregister MDR Anhang I');
  if (s.risk.status === 'closed' && !s.partner.confirmed) add('qm1', 'Partner & Zertifikat bestätigen', 'Partnerqualifizierung für die Übergabe', 'Zertifikatsquelle Ergo-Tec', addDays(s.risk.at, 5), 'partner', 'Auswahl');
  const pkg = currentPackage();
  if (!pkg && !formalBlockers().length) add('qm1', 'Übergabepaket erzeugen', 'Alle Pflichtpunkte belegt', 'Übergabebereitschaft', addDays(s.partner.at, 2), 'uebergabe', 'Übergabebereitschaft');
  openQuestions().forEach(q => add('qm1', `Rückfrage ${q.id} beantworten`, q.text, `${q.packageId} · ${q.doc} S. ${q.page}`, q.due, 'uebergabe', 'OEM-Rückfragen'));
  if (pkg && !pkg.acceptance && !openQuestions().length) add('oem1', `${pkg.id} prüfen: annehmen oder rückfragen`, 'Übergabepaket von Ergo-Tec', `${pkg.id} (${pkg.hash})`, addDays(pkg.at, 10), 'uebergabe', 'Übergabepakete');
  if (pkg?.acceptance && !s.release && s.route.status === 'unresolved') add('ra1', 'Verfahrensstatus R2/B festlegen', 'Paket angenommen; regulatorische Einordnung offen', pkg.id, addDays(pkg.acceptance.at, 5), 'uebergabe', 'Regulatorischer Weg (RA)');
  if (!s.release && s.route.status === 'external_required') add('ra1', `Ergebnis der ${s.route.kind === 'mitteilung' ? 'Mitteilung' : 'Genehmigung'} erfassen`, `${routeLabel()} – Freigabe gesperrt`, 'Verfahrensstatus', 'nach Ergebnis der zuständigen Stelle', 'uebergabe', 'Regulatorischer Weg (RA)');
  if (pkg?.acceptance && !s.release && ['internal_confirmed', 'external_fulfilled'].includes(s.route.status)) add('oem1', 'Serienstand R2/B gesondert freigeben', 'Paket angenommen, Verfahrensstatus geklärt', pkg.id, addDays(pkg.acceptance.at, 7), 'uebergabe', 'Separate OEM-Freigabe R2/B');
  const sv = s.service;
  if (s.release && !sv) add('svc', 'Zeitsprung aktivieren (Demo)', 'Servicefall nach Auslieferung simulieren', 'SV-01', 'Demo', 'service', 'Synthetischer Zeitsprung');
  if (sv && !sv.opened) add('svc', `${sv.serial} suchen und Baustand öffnen`, 'Servicemeldung eingegangen', 'SV-01', day(sv.simulatedNow), 'service', 'Seriennummernsuche');
  if (sv?.opened && !sv.raTask) add('svc', 'Servicefall an OEM/RA übergeben', 'Liege hält Höhe nicht zuverlässig', 'SV-01', day(sv.simulatedNow), 'service', 'Servicefall SV-01');
  if (sv?.raTask && !sv.oemAwareAt) add('oem1', 'Kenntniszeitpunkt erfassen', 'Servicefall SV-01 eingegangen', sv.raTask, day(sv.simulatedNow), 'service', 'Servicefall SV-01');
  if (sv?.oemAwareAt && !sv.assessment) add('ra1', 'Servicefall regulatorisch bewerten', 'Meldepflicht, Adressat und Frist beurteilen', `${sv.raTask} / SV-01`, sv.reviewDue, 'service', 'Servicefall SV-01');
  if (sv?.assessment?.duty === 'ja' && !sv.externalReport) add('ra1', 'Externe Meldung dokumentieren', 'Meldepflicht festgestellt', 'SV-01', sv.assessment.deadline, 'service', 'Servicefall SV-01');
  if (sv?.assessment && !sv.followUp && (sv.assessment.duty !== 'ja' || sv.externalReport)) add('ra1', 'Maßnahme nachverfolgen', sv.assessment.next, 'SV-01', sv.reviewDue, 'service', 'Servicefall SV-01');
  if (sv?.opened && !s.repairs.length) add('svc', 'Reparatur im Bestand dokumentieren', 'Gerät beim Betreiber instand setzen', sv.serial, addDays(sv.simulatedNow, 7), 'service', 'Reparatur im Bestand');
  s.repairs.forEach(r => add('svc', `Nächste Kontrolle ${r.serial}`, `Sicherheitstechnische Kontrolle nach ${r.id}`, r.id, r.controlDue, 'service', 'Reparatur im Bestand'));
  return items;
}

// The single "next required action" shown in the header: who (persona),
// where (screen) and which card to jump to. Follows the demo story order.
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
  const od = openDeviations();
  if (od.length && !od[0].rework) return step('qm1', `Abweichung ${od[0].id}: Nacharbeit zuweisen`, 'pruefung', 'Abweichungen');
  if (od.length && !od[0].correction) return step(od[0].rework.who, `Abweichung ${od[0].id}: Korrektur dokumentieren`, 'pruefung', 'Abweichungen');
  if (s.risk.status !== 'closed') return step('qm1', 'Geeigneten Bericht R2/B Endfassung importieren und annehmen', 'pruefung', 'Simulierter Laboreingang');
  if (od.length) return step('qm1', `Abweichung ${od[0].id}: Wirksamkeit prüfen und schließen`, 'pruefung', 'Abweichungen');
  if (openExclusions().length) return step('qm1', 'Nicht anwendbare Anforderungen begründet ausschließen', 'matrix', 'Regelregister MDR Anhang I');
  if (!s.partner.confirmed) return step('qm1', 'Partner & Zertifikat prüfen und bestätigen', 'partner', 'Auswahl');
  const pkg = currentPackage();
  if (!pkg) return step('qm1', 'Formales Übergabepaket erzeugen', 'uebergabe', 'Übergabebereitschaft');
  if (openQuestions().length) return step('qm1', `Rückfrage ${openQuestions()[0].id} beantworten`, 'uebergabe', 'OEM-Rückfragen');
  if (!s.release && hash(evidenceSnapshot()) !== pkg.hash) return step('qm1', 'Nachweisstand geändert – neues Paket erzeugen', 'uebergabe', 'Übergabebereitschaft');
  if (!pkg.acceptance) return step('oem1', `Paket ${pkg.id} prüfen und annehmen`, 'uebergabe', 'Übergabepakete');
  if (s.route.status === 'external_required') return step('ra1', `${routeLabel()} – Ergebnis erfassen (Freigabe bis dahin gesperrt)`, 'uebergabe', 'Regulatorischer Weg (RA)');
  if (!['internal_confirmed', 'external_fulfilled'].includes(s.route.status)) return step('ra1', 'Verfahrensstatus festlegen', 'uebergabe', 'Regulatorischer Weg (RA)');
  if (!s.release) return step('oem1', 'Serienstand R2/B gesondert freigeben', 'uebergabe', 'Separate OEM-Freigabe R2/B');
  if (!s.service) return step('svc', 'Synthetischen Zeitsprung aktivieren', 'service', 'Synthetischer Zeitsprung');
  if (!s.service.opened) return step('svc', `${s.service.serial} suchen und Baustand öffnen`, 'service', 'Seriennummernsuche');
  if (!s.service.raTask) return step('svc', 'RA-Bewertungsaufgabe aus SV-01 erstellen', 'service', 'Servicefall SV-01');
  if (!s.service.oemAwareAt) return step('oem1', 'Kenntniszeitpunkt erfassen', 'service', 'Servicefall SV-01');
  if (!s.service.assessment) return step('ra1', 'Servicefall regulatorisch bewerten', 'service', 'Servicefall SV-01');
  if (s.service.assessment.duty === 'ja' && !s.service.externalReport) return step('ra1', 'Externe Meldung dokumentieren', 'service', 'Servicefall SV-01');
  if (!s.service.followUp) return step('ra1', 'Maßnahme nachverfolgen', 'service', 'Servicefall SV-01');
  if (!s.repairs.length) return step('svc', 'Reparatur im Bestand dokumentieren', 'service', 'Reparatur im Bestand');
  return { who: null, role: '–', text: 'Demo-Durchlauf abgeschlossen', screen: 'service', card: null };
}
