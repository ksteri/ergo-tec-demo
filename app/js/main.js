// Bootstrap, event delegation and the source-document side panel.
import { loadSources, fileUrl, CERT_FILE } from './data.js';
import * as store from './store.js';
import { header, nav, flash, auditDrawer, worklistDrawer, screen, runtime, F, esc } from './views.js';
import { buildFormalZip, buildDraftZip, download, readZip } from './export.js';
import { renderPdf } from './viewer.js';

const $ = sel => document.querySelector(sel);
const { actions } = store;

function render() {
  const focus = document.activeElement?.dataset?.form;
  const caret = focus && document.activeElement.selectionStart;
  $('#header').innerHTML = header();
  $('#nav').innerHTML = nav();
  $('#flash').innerHTML = flash();
  $('#main').innerHTML = screen();
  $('#drawer').innerHTML = auditDrawer() + worklistDrawer();
  document.body.classList.toggle('viewer-open', !!store.getUi().viewer);
  if (focus) {
    const el = document.querySelector(`[data-form="${focus}"]`);
    if (el && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      el.focus();
      try { el.setSelectionRange(caret, caret); } catch { /* date/number inputs */ }
    }
  }
}

// ------------------------------------------------------------ viewer panel
let viewerKey = null;
async function renderViewer(force = false) {
  const v = store.getUi().viewer;
  const box = $('#viewer');
  document.body.classList.toggle('viewer-open', !!v);
  if (!v) { box.innerHTML = ''; viewerKey = null; return; }
  const key = `${v.url}#${v.page}`;
  if (key === viewerKey && !force) return;
  viewerKey = key;
  const isCert = v.file === CERT_FILE;
  const missing = isCert && !store.certAvailable();
  const src = store.getSources();
  box.innerHTML = `
    <header><div><small>${v.blob ? 'Paketinhalt (aus ZIP)' : 'Originaldokument'}</small><strong>${esc(v.title)}</strong>
      <code>${esc(v.file || 'ZIP-Eintrag')}</code></div>
      <button class="btn ghost sm" data-act="close-viewer" aria-label="Schließen">×</button></header>
    <div class="viewer-nav">
      <button class="btn ghost sm" data-act="viewer-page" data-d="-1">‹</button>
      <span id="vp">Seite ${v.page}</span>
      <button class="btn ghost sm" data-act="viewer-page" data-d="1">›</button>
      ${missing ? '' : `<a class="link" href="${v.url}#page=${v.page}" target="_blank" rel="noopener">In neuem Tab (#page=${v.page})</a>`}
    </div>
    <div id="vcanvas" class="viewer-canvas"></div>`;
  const host = $('#vcanvas');
  if (missing) {
    host.innerHTML = `<div class="viewer-missing"><strong>Lokale Datei nicht verfügbar.</strong><br>Es wird keine Ersatzdatei angezeigt.<br>
      <a href="${esc(src.certUrl)}" target="_blank" rel="noopener">Original öffnen (Seite ${v.page})</a></div>`;
    return;
  }
  const res = await renderPdf(host, v.url, v.page);
  const label = $('#vp'); // viewer may have been closed while rendering
  if (res && label) label.textContent = `Seite ${res.page} / ${res.pages}`;
  if (res) v.pages = res.pages;
}

function openDoc(file, page, title) {
  store.setUi({ viewer: { file, url: fileUrl(file), page: Number(page) || 1, title } }, false);
  renderViewer();
}

// ------------------------------------------------------------ exports
async function busy(label, fn) {
  store.setUi({ flash: { type: 'info', text: label } });
  try { await fn(); } catch (e) { store.setUi({ flash: { type: 'error', text: `Fehler: ${e.message}` } }); }
}
const zipName = pkg => `UL-01_R2_Akte_${pkg.id}_${pkg.hash}.zip`;

// Test switch: lets the demo show the export error path on purpose.
async function buildChecked(build) {
  if (store.getState().tests.exportError) throw new Error('Simulierter Exportfehler (Testschalter)');
  return build();
}
async function saveNote(blob, name) {
  const saved = await download(blob, name);
  return saved ? `heruntergeladen (${(blob.size / 1024).toFixed(0)} KB)` : 'erzeugt, Download nicht bestätigt';
}
async function openPackage(id, note = '') {
  const pkg = store.getState().packages.find(p => p.id === id);
  await busy(`${id} wird aus Snapshot erzeugt …`, async () => {
    runtime.zip[id] = await readZip(await buildFormalZip(pkg));
    store.setUi({ flash: { type: 'ok', text: `${note}${id}: ZIP geöffnet, ${runtime.zip[id].length} Dateien.` } });
  });
}
async function downloadPackage(pkg) {
  await busy(`${pkg.id} wird erzeugt …`, async () => {
    const blob = await buildChecked(() => buildFormalZip(pkg));
    store.setUi({ flash: { type: 'ok', text: `${pkg.id} ${await saveNote(blob, zipName(pkg))}.` } });
  });
}
async function downloadDraft(d) {
  await busy(`${d.id} wird erzeugt …`, async () => {
    const blob = await buildChecked(() => buildDraftZip(d));
    store.setUi({ flash: { type: 'warn', text: `${d.id} ${await saveNote(blob, `UL-01_R2_ARBEITSSTAND_${d.id}.zip`)} – ARBEITSSTAND, keine Übergabe.` } });
  });
}

// Formal handover: build the ZIP from the candidate first and store the
// package only if that worked. On error nothing changes and a retry is offered.
async function exportFormal() {
  const cand = actions.formalCandidate();
  if (!cand) return;
  store.setUi({ flash: { type: 'info', text: `${cand.pkg.id} wird erzeugt …` } });
  let blob;
  try {
    blob = await buildChecked(() => buildFormalZip(cand.pkg));
  } catch (e) {
    store.setUi({ exportError: { kind: 'formal', text: e.message }, flash: { type: 'error', text: `Übergabe fehlgeschlagen: ${e.message}. Es wurde kein Paket gespeichert – der Vorgang bleibt offen.` } });
    return;
  }
  const pkg = actions.commitFormal(cand);
  const note = cand.existing ? `Unveränderter Stand: ${pkg.id} erneut bereitgestellt – ` : `${pkg.id} eingefroren und an ${pkg.recipient} übergeben – `;
  store.setUi({ exportError: null, flash: { type: cand.existing ? 'warn' : 'ok', text: `${note}${await saveNote(blob, zipName(pkg))}.` } });
  runtime.zip[pkg.id] = await readZip(blob);
  store.setUi({});
}
async function exportDraft() {
  const cand = actions.draftCandidate();
  if (!cand) return;
  let blob;
  try {
    blob = await buildChecked(() => buildDraftZip(cand.draft));
  } catch (e) {
    store.setUi({ exportError: { kind: 'draft', text: e.message }, flash: { type: 'error', text: `Export fehlgeschlagen: ${e.message}. Kein Arbeitsstand gespeichert – erneut versuchen.` } });
    return;
  }
  const d = actions.commitDraft(cand);
  store.setUi({ exportError: null, flash: { type: 'warn', text: `${cand.existing ? `Unveränderter Stand: ${d.id} erneut bereitgestellt` : `${d.id} erzeugt`} – ${await saveNote(blob, `UL-01_R2_ARBEITSSTAND_${d.id}.zip`)}. ARBEITSSTAND, keine Übergabe.` } });
}

// ------------------------------------------------------------ events
const clear = (...keys) => keys.forEach(k => store.setForm(k, ''));

function jumpTo(screen, card) {
  store.setUi({ screen, flash: null, worklistOpen: false });
  const el = card && document.querySelector(`[data-card="${CSS.escape(card)}"]`);
  if (!el) { $('#main-wrap').scrollTop = 0; return; }
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.classList.add('focus-card');
  setTimeout(() => el.classList.remove('focus-card'), 1800);
}

const handlers = {
  goto: d => { store.setUi({ screen: d.screen, flash: null }); $('#main-wrap').scrollTop = 0; },
  next: () => {
    const n = store.nextAction();
    if (n.who && n.who !== store.person().id) actions.switchPerson(n.who);
    jumpTo(n.screen, n.card);
  },
  'open-work': d => jumpTo(d.screen, d.card),
  'toggle-worklist': () => store.setUi({ worklistOpen: !store.getUi().worklistOpen, auditOpen: false }),
  'set-revision': d => store.setUi({ revision: d.rev }),
  'open-gap': () => { store.setUi({ screen: 'matrix', revision: 'R2' }); openDoc('documents/PB-17_R1-A_Endfassung.pdf', 2, 'PB-17 v1.0 – Seite 2: geprüfte Konfiguration R1/A'); },
  'open-doc': d => openDoc(d.file, d.page, d.title),
  'open-blob': d => { store.setUi({ viewer: { url: d.url, page: 1, title: d.title, blob: true } }, false); renderViewer(); },
  'close-viewer': () => { store.setUi({ viewer: null }); renderViewer(); },
  'viewer-page': d => {
    const v = store.getUi().viewer;
    const p = Math.min(Math.max(1, v.page + Number(d.d)), v.pages || 99);
    store.setUi({ viewer: { ...v, page: p } }, false); renderViewer();
  },
  'toggle-audit': () => store.setUi({ auditOpen: !store.getUi().auditOpen, worklistOpen: false }),
  'close-flash': () => store.setUi({ flash: null }),
  reset: () => store.setUi({ confirmReset: true }),
  'reset-cancel': () => store.setUi({ confirmReset: false, confirmScenario: null }),
  'reset-confirm': () => {
    runtime.zip = {};
    store.resetDemo(); renderViewer();
  },
  'pick-scenario': d => store.setUi({ confirmScenario: d.scenario }),
  'scenario-confirm': d => {
    runtime.zip = {};
    store.resetDemo(d.scenario); renderViewer();
  },
  'reg-filter': d => store.setUi({ regFilter: d.filter }),
  'deliver-pcn': () => actions.deliverPcn(),
  'deliver-unknown': () => actions.deliverUnknown(),
  'confirm-mapping': () => actions.confirmMapping(),
  'correct-mapping': () => actions.correctMapping(F('mapPos'), F('mapReason')),
  'clarify-mapping': () => actions.clarifyMapping(F('mapClarify')),
  'confirm-impact': () => actions.confirmImpact({ text: F('impactText') }),
  'create-task': () => actions.createQmTask({ reason: F('taskReason'), due: F('taskDue') }),
  'exclude-req': d => actions.excludeReq(d.no, F(`ex_${d.no}`)),
  'exclude-all': () => actions.excludeAll(),
  'create-order': () => actions.createTestOrder(),
  'import-report': d => actions.importReport(d.uid),
  'accept-report': d => actions.acceptReport(d.uid, F(`rev_${d.uid}`)),
  'reject-report': d => actions.rejectReport(d.uid, F(`rev_${d.uid}`)),
  'assign-rework': d => actions.assignRework(d.id, { owner: F(`rwo_${d.id}`), text: F(`rwt_${d.id}`), due: F(`rwd_${d.id}`) }),
  'dev-correction': d => actions.devCorrection(d.id, F(`corr_${d.id}`)),
  'dev-close': d => actions.devClose(d.id, F(`eff_${d.id}`)),
  'partner-confirm': () => actions.partnerConfirm(F('partnerReason')),
  'partner-clarify': () => actions.partnerClarify(),
  'toggle-cert-missing': () => { actions.toggleCertMissing(); viewerKey = null; renderViewer(); },
  'toggle-export-error': () => actions.toggleExportError(),
  'toggle-sourcelink': () => actions.toggleSourceLink(),
  'export-draft': () => exportDraft(),
  'export-formal': () => exportFormal(),
  'export-retry': () => (store.getUi().exportError?.kind === 'draft' ? exportDraft() : exportFormal()),
  'download-pkg': d => downloadPackage(store.getState().packages.find(p => p.id === d.id)),
  'open-pkg': d => openPackage(d.id),
  'download-draft': d => downloadDraft(store.getState().drafts.find(x => x.id === d.id)),
  'accept-pkg': d => actions.acceptPackage(d.id, F(`acc_${d.id}`)),
  'ask-q': () => { if (actions.askQuestion({ doc: F('qDoc'), page: F('qPage'), text: F('qText') })) { clear('qText'); render(); } },
  'answer-q': async d => {
    const res = actions.answerQuestion(d.id, F(`ans_${d.id}`), F(`chg_${d.id}`));
    if (res?.changesEvidence) await exportFormal();
  },
  'set-route': () => {
    const f = { route: F('route'), kind: F('routeKind'), classification: F('routeClass'), reason: F('routeReason'), evidence: F('routeEvidence') };
    if (actions.setRoute(f)) { clear('routeReason', 'routeEvidence'); render(); }
  },
  release: () => actions.release({ doc: F('relDoc'), label: F('relLabel'), lots: F('relLots'), reason: F('releaseReason') }),
  'activate-service': () => actions.activateService(),
  'search-serial': () => actions.searchSerial(F('serial')),
  'create-ra': () => actions.createRaTask(),
  'oem-aware': () => actions.oemAware(),
  'ra-assess': () => actions.raAssess({ duty: F('svDuty'), addressee: F('svAddr'), deadline: F('svDeadline'), text: F('svText'), next: F('svNext') }),
  'report-external': () => actions.reportExternal(F('svRef')),
  'follow-up': () => actions.followUp(F('svFollow')),
  'record-repair': () => actions.recordRepair({ serial: F('repSerial'), part: F('repPart'), protocol: F('repProtocol'), tech: F('repTech'), controlDue: F('repDue') }),
  'goto-pkg': d => { store.setUi({ screen: 'uebergabe' }); openPackage(d.id); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const h = handlers[el.dataset.act];
  if (h) { if (el.tagName !== 'INPUT') e.preventDefault(); h(el.dataset); }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.form) {
    store.setForm(el.dataset.form, el.type === 'checkbox' ? el.checked : el.value);
    render();
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'role-select') actions.switchPerson(el.value);
  else if (el.dataset.partner) actions.setPartner(el.dataset.partner, el.value);
});
// Re-rendering replaces the markup, so remember which <details> are open.
document.addEventListener('toggle', e => {
  const key = e.target.dataset?.openKey;
  if (key && !!store.getUi().forms[key] !== e.target.open) store.setForm(key, e.target.open);
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset?.form === 'serial') handlers['search-serial']();
  if (e.key === 'Escape' && (store.getUi().auditOpen || store.getUi().worklistOpen)) store.setUi({ auditOpen: false, worklistOpen: false });
});

// ------------------------------------------------------------ start
(async () => {
  try {
    const src = await loadSources();
    store.init(src);
    if (store.getUi().viewer?.blob) store.setUi({ viewer: null }, false);
    store.subscribe(render);
    render();
    renderViewer();
    window.__demo = { store, actions }; // test hook for the dev team
  } catch (e) {
    $('#main').innerHTML = `<div class="fatal"><h2>Quellen konnten nicht geladen werden</h2><p>${esc(e.message)}</p>
      <p>Die App muss über einen lokalen Webserver aus dem Projektordner gestartet werden (siehe RUN.md).</p></div>`;
  }
})();
