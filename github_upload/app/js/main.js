// Bootstrap, event delegation and the source-document side panel.
import { loadSources, fileUrl, CERT_FILE } from './data.js';
import * as store from './store.js';
import { header, nav, flash, auditDrawer, screen, runtime, F, esc } from './views.js';
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
  $('#drawer').innerHTML = auditDrawer();
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
async function openPackage(id, note = '') {
  const pkg = store.getState().packages.find(p => p.id === id);
  await busy(`${id} wird aus Snapshot erzeugt …`, async () => {
    runtime.zip[id] = await readZip(await buildFormalZip(pkg));
    store.setUi({ flash: { type: 'ok', text: `${note}${id}: ZIP geöffnet, ${runtime.zip[id].length} Dateien.` } });
  });
}
async function downloadPackage(pkg, note = '') {
  await busy(`${pkg.id} wird erzeugt …`, async () => {
    const blob = await buildFormalZip(pkg);
    const saved = await download(blob, `UL-01_R2_Akte_${pkg.id}_${pkg.hash}.zip`);
    store.setUi({ flash: saved ? { type: 'ok', text: `${note}${pkg.id} heruntergeladen (${(blob.size / 1024).toFixed(0)} KB).` }
      : { type: 'info', text: `${note}${pkg.id} erzeugt, Download nicht bestätigt. Inhalt lässt sich in der App ansehen.` } });
  });
}
async function downloadDraft(d, note = '') {
  await busy(`${d.id} wird erzeugt …`, async () => {
    const saved = await download(await buildDraftZip(d), `UL-01_R2_ARBEITSSTAND_${d.id}.zip`);
    store.setUi({ flash: { type: 'warn', text: `${note}${d.id} ${saved ? 'heruntergeladen' : 'erzeugt, Download nicht bestätigt'} – ARBEITSSTAND, keine Übergabe.` } });
  });
}

// ------------------------------------------------------------ events
const clear = (...keys) => keys.forEach(k => store.setForm(k, ''));

const handlers = {
  goto: d => { store.setUi({ screen: d.screen, flash: null }); $('#main-wrap').scrollTop = 0; },
  next: () => {
    const n = store.nextAction();
    if (n.who && n.who !== store.person().id) actions.switchPerson(n.who);
    store.setUi({ screen: n.screen, flash: null });
    const el = n.card && document.querySelector(`[data-card="${CSS.escape(n.card)}"]`);
    if (!el) { $('#main-wrap').scrollTop = 0; return; }
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('focus-card');
    setTimeout(() => el.classList.remove('focus-card'), 1800);
  },
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
  'toggle-audit': () => store.setUi({ auditOpen: !store.getUi().auditOpen }),
  'close-flash': () => store.setUi({ flash: null }),
  reset: () => store.setUi({ confirmReset: true }),
  'reset-cancel': () => store.setUi({ confirmReset: false }),
  'reset-confirm': () => {
    runtime.zip = {};
    store.resetDemo(); renderViewer();
  },
  'deliver-pcn': () => actions.deliverPcn(),
  'deliver-unknown': () => actions.deliverUnknown(),
  'confirm-mapping': d => actions.confirmMapping(d.pos),
  'confirm-impact': () => actions.confirmImpact({ text: F('impactText') }),
  'create-task': () => actions.createQmTask({ reason: F('taskReason'), due: F('taskDue') }),
  'create-order': () => actions.createTestOrder(),
  'import-report': d => actions.importReport(d.uid),
  'accept-report': d => actions.acceptReport(d.uid, F(`rev_${d.uid}`)),
  'reject-report': d => actions.rejectReport(d.uid, F(`rev_${d.uid}`)),
  'dev-correction': d => actions.devCorrection(d.id, F(`corr_${d.id}`)),
  'dev-close': d => actions.devClose(d.id, F(`eff_${d.id}`)),
  'partner-confirm': () => actions.partnerConfirm(F('partnerReason')),
  'partner-clarify': () => actions.partnerClarify(),
  'toggle-cert-missing': () => { actions.toggleCertMissing(); viewerKey = null; renderViewer(); },
  'toggle-sourcelink': () => actions.toggleSourceLink(),
  'export-draft': async () => {
    const s = store.getState();
    const d = actions.registerDraft({ ...store.evidenceSnapshot(), route: s.route.status }, store.gapList());
    if (d) await downloadDraft(d, `${store.getUi().flash?.text || ''} `);
  },
  'export-formal': async () => {
    const pkg = actions.registerFormal();
    if (!pkg) return;
    const note = `${store.getUi().flash?.text || ''} `;
    await downloadPackage(pkg, note); await openPackage(pkg.id, note);
  },
  'download-pkg': d => downloadPackage(store.getState().packages.find(p => p.id === d.id)),
  'open-pkg': d => openPackage(d.id),
  'download-draft': d => downloadDraft(store.getState().drafts.find(x => x.id === d.id)),
  'accept-pkg': d => actions.acceptPackage(d.id, F(`acc_${d.id}`)),
  'ask-q': () => { if (actions.askQuestion({ doc: F('qDoc'), page: F('qPage'), text: F('qText') })) { clear('qText'); render(); } },
  'answer-q': async d => {
    const pkg = actions.answerQuestion(d.id, F(`ans_${d.id}`), F(`chg_${d.id}`));
    if (pkg) await openPackage(pkg.id);
  },
  'set-route': () => { if (actions.setRoute(F('route'), F('routeReason'))) { clear('routeReason'); render(); } },
  release: () => actions.release(F('releaseReason')),
  'activate-service': () => actions.activateService(),
  'search-serial': () => actions.searchSerial(F('serial')),
  'create-ra': () => actions.createRaTask(),
  'oem-aware': () => actions.oemAware(),
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
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset?.form === 'serial') handlers['search-serial']();
  if (e.key === 'Escape' && store.getUi().auditOpen) store.setUi({ auditOpen: false });
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
