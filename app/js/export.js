// Real ZIP / PDF generation (JSZip + pdf-lib, vendored). Packages are rebuilt
// from their frozen snapshot with fixed timestamps, so a package ID always
// yields the same content.
import { fileUrl, PRECONFIRMED, ROUTES } from './data.js';
import { getSources } from './store.js';

const { PDFDocument, StandardFonts, rgb } = window.PDFLib;

const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfSafe = s => String(s ?? '')
  .replace(/→/g, '->').replace(/≠/g, '!=').replace(/✓/g, 'OK').replace(/≥/g, '>=')
  .replace(/[^\u0000-ÿ]/g, ch => (WIN_ANSI_EXTRA.includes(ch) ? ch : '?'));

export const fmt = iso => iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–';

async function fetchBytes(path) {
  const r = await fetch(fileUrl(path), { cache: 'no-store' });
  if (!r.ok) throw new Error(`Datei nicht verfügbar: ${path}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Minimal flowing-text PDF writer.
async function makePdf({ title, docId, at, watermark, blocks }) {
  const doc = await PDFDocument.create();
  const date = new Date(at);
  doc.setTitle(pdfSafe(title)); doc.setAuthor('Devoreo Prototyp (Demo)');
  doc.setProducer('Devoreo Prototyp'); doc.setCreator('Devoreo Prototyp');
  doc.setCreationDate(date); doc.setModificationDate(date);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 50, maxW = W - 2 * M;
  let page, y;
  const pages = [];
  const newPage = () => {
    page = doc.addPage([W, H]); pages.push(page); y = H - M;
    page.drawText(pdfSafe('DEVOREO  /  MUSTER / DEMO – im Prototyp generiert – keine Konformitätserklärung'), { x: M, y, size: 8, font, color: rgb(0.35, 0.4, 0.45) });
    y -= 14;
    page.drawText(pdfSafe(`${docId}  |  UL-01 / Standard / R2 / B  |  Stand ${fmt(at)}`), { x: M, y, size: 8, font, color: rgb(0.35, 0.4, 0.45) });
    y -= 26;
    if (watermark) {
      page.drawText(pdfSafe(watermark), { x: 70, y: 300, size: 46, font: bold, color: rgb(0.85, 0.3, 0.2), opacity: 0.18, rotate: { type: 'degrees', angle: 35 } });
    }
  };
  const wrap = (text, f, size) => {
    const out = [];
    pdfSafe(text).split('\n').forEach(par => {
      let line = '';
      par.split(' ').forEach(w => {
        const t = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  };
  newPage();
  const write = (text, { f = font, size = 10, gap = 4, color = rgb(0.1, 0.13, 0.17), indent = 0 } = {}) => {
    wrap(text, f, size).forEach(l => {
      if (y < M + 20) newPage();
      page.drawText(l, { x: M + indent, y, size, font: f, color });
      y -= size + gap;
    });
  };
  write(title, { f: bold, size: 16, gap: 10 });
  for (const b of blocks) {
    if (b.h) { y -= 6; write(b.h, { f: bold, size: 11.5, gap: 6, color: rgb(0.05, 0.37, 0.38) }); }
    if (b.p) write(b.p);
    if (b.warn) write(b.warn, { f: bold, color: rgb(0.7, 0.2, 0.1) });
    if (b.list) b.list.forEach(i => write(`•  ${i}`, { indent: 6 }));
    if (b.rows) b.rows.forEach(([k, v]) => write(`${k}:  ${v}`, { indent: 6 }));
  }
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: W - M - 30, y: 30, size: 8, font, color: rgb(0.4, 0.4, 0.4) }));
  return doc.save();
}

function reviewRecord(s, at, docId) {
  return makePdf({
    title: 'R-04 – dokumentierte QM-Bewertung', docId, at,
    blocks: [
      { rows: [['Anforderung', 'MDR Anhang I, Nr. 20.1 (Demo-Zuordnung)'], ['Risiko', 'R-04 Unbeabsichtigtes Absenken'], ['Schutzmaßnahme', 'Ausreichendes Halteverhalten'], ['Prüfanweisung', 'PA-04 v1.0']] },
      { h: 'Angenommener Nachweis', rows: [['Bericht', `${s.report.id} v${s.report.version}`], ['Konfiguration', 'R2 / Hubantrieb B (MH-B)'], ['Dokumentstatus', s.report.document_status], ['Ergebnis', s.report.result]] },
      { h: 'QM-Bewertung', rows: [['Status', s.report.review.status], ['Durch', `${s.report.review.by} (${s.report.review.role})`], ['Zeitpunkt', fmt(s.report.review.at)], ['Begründung', s.report.review.reason]] },
      { h: 'Abweichungen', list: s.deviations.length ? s.deviations.map(d => `${d.id}: ${d.status}; Korrektur: ${d.correction || '–'}; Wirksamkeit: ${d.effectiveness || '–'}`) : ['keine'] },
      { warn: 'Geschlossen ist nur der Demo-Nachweispunkt R-04 – nicht alle Produktrisiken. Keine Serienfreigabe.' },
    ],
  });
}

function matrix(s, at, docId) {
  return makePdf({
    title: 'Anforderungsmatrix (Demo-Ausschnitt)', docId, at,
    blocks: [
      { h: 'Fokuskette R-04', rows: [
        ['Anforderung', 'MDR Anhang I 20.1'], ['Risiko', 'R-04 Unbeabsichtigtes Absenken'], ['Schutzmaßnahme', 'Ausreichendes Halteverhalten'],
        ['Prüfanweisung', 'PA-04'], ['Erwartet', 'R2 / B'], ['Nachweis', s.report ? `${s.report.id} v${s.report.version} – ${s.report.revision || 'R2'}/B, ${s.report.document_status}, ${s.report.result}` : 'fehlt'],
        ['Status', s.risk.status === 'closed' ? `geschlossen durch ${s.risk.closedBy}` : 'offen']] },
      { h: 'Historischer Bezug', p: 'PB-17 v1.0 belegt ausschließlich R1/A und ist für R2/B nicht verwendbar (nicht im Paket).' },
      { h: 'Übrige Pflichtpunkte', list: PRECONFIRMED.map(p => `${p.id}: ${p.label} – VORBESTÄTIGT NUR FÜR DEN SYNTHETISCHEN DEMOFALL`) },
      { warn: 'Vorbestätigte Punkte sind keine tatsächliche Konformitätsbewertung.' },
    ],
  });
}

function decisionLog(pkg, at, docId) {
  return makePdf({
    title: 'Entscheidungsprotokoll für BeispielMed (OEM)', docId, at,
    blocks: [
      { p: 'Empfängerspezifischer Auszug: nur OEM-relevante Entscheidungen, ohne interne Notizen und Rollenwechsel.' },
      { h: 'Einträge', list: pkg.log.map(e => `${fmt(e.ts)} – ${e.actor} (${e.title}) – ${e.action} [${e.object}]: ${e.detail}`) },
    ],
  });
}

function supplementsPdf(s, at, docId) {
  return makePdf({
    title: 'QM-Stellungnahmen zu OEM-Rückfragen', docId, at,
    blocks: s.supplements.map(x => ({ h: `${x.id} – Bezug ${x.ref}`, p: `${x.text}\n(${x.by})` })),
  });
}

function indexPdf(pkg, files, excluded) {
  const s = pkg.snapshot;
  return makePdf({
    title: `Paketindex ${pkg.id} – Digitale Produktakte UL-01 R2/B`, docId: `${pkg.id}-INDEX`, at: pkg.at,
    watermark: pkg.sourceLinkOnly ? 'QUELLLINK-PROTOTYP' : null,
    blocks: [
      { rows: [['Paket-ID', pkg.id], ['Snapshot', pkg.hash], ['Eingefroren', fmt(pkg.at)], ['Erstellt durch', `${pkg.by} (QM)`], ['Empfänger', 'BeispielMed Systeme GmbH (fiktiv)'], ['Produkt', 'UL-01 Untersuchungsliege / Standard / R2 / Hubantrieb B']] },
      ...(pkg.sourceLinkOnly ? [{ warn: `QUELLLINK-PROTOTYP: Zertifikats-PDF lokal nicht vorhanden. Quelle nur als Link: ${s.cert.url}. KEINE VOLLSTÄNDIGE AKTE.` }] : []),
      { h: 'Enthaltene Dateien', list: files },
      { h: 'Bewusst nicht enthalten', list: excluded },
      { h: 'Partner / QMS-Quelle', p: `Ergo-Tec GmbH, ${s.partner.certId}; Geltungsbereich „${s.partner.scope}“; bestätigt durch ${s.partner.confirmedBy}. Quelle: ${s.cert.url}${s.cert.mode === 'local' ? ' (lokal, Seiten 1 und 3)' : ''}. Das Zertifikat belegt keine Produktsicherheit und schließt R-04 nicht.` },
      { h: 'Hinweise', list: [
        'Musterprojekt mit synthetischen Daten und simulierten Schnittstellen.',
        'Geschlossen ist nur der Demo-Nachweispunkt R-04; übrige Pflichtpunkte sind nur für den Demofall vorbestätigt.',
        'Ein angenommenes Paket ist keine Serienfreigabe und keine CE-/Behördenaussage.'] },
    ],
  });
}

const zipOpts = at => ({ date: new Date(at) });

export async function buildFormalZip(pkg) {
  const s = pkg.snapshot;
  const zip = new JSZip();
  const at = pkg.at;
  const add = (name, data) => zip.file(name, data, zipOpts(at));
  const files = [];
  const put = (name, data, label) => { add(name, data); files.push(`${name} – ${label}`); };

  const src = getSources();
  const bomRaw = await fetch(fileUrl('data/BOM_R2.csv'), { cache: 'no-store' }).then(r => r.text());
  put('01_BOM_UL-01_R2.csv', bomRaw, 'Stückliste R2 (geplant), Pos. 020 MH-B');
  put('02_R-04_Risikomanagementauszug_v1.0.pdf', await fetchBytes('documents/R-04_Risikomanagementauszug.pdf'), 'Risikoauszug R-04');
  put('02b_R-04_QM-Bewertungsvermerk.pdf', await reviewRecord(s, at, `${pkg.id}-R04REV`), 'dokumentierte QM-Bewertung');
  put('03_PA-04_Pruefanweisung_v1.0.pdf', await fetchBytes('documents/PA-04_Pruefanweisung.pdf'), 'Prüfanweisung');
  put(`04_${s.report.id}_v${s.report.version}_R2-B_Endfassung.pdf`, await fetchBytes(s.report.file), `angenommener Bericht (${s.report.result})`);
  if (s.cert.mode === 'local') put('05_QMS-Quelle_Ergo-Tec_Zertifikate.pdf', await fetchBytes(s.cert.file), 'öffentliche Zertifikatsquelle (S. 1 ISO 9001, S. 3 ISO 13485)');
  put('06_Anforderungsmatrix_R-04.pdf', await matrix(s, at, `${pkg.id}-MATRIX`), 'Anforderungsmatrix');
  put('07_Entscheidungsprotokoll_BeispielMed.pdf', await decisionLog(pkg, at, `${pkg.id}-LOG`), 'empfängerspezifisches Entscheidungsprotokoll');
  if (s.supplements.length) put('08_QM-Stellungnahmen.pdf', await supplementsPdf(s, at, `${pkg.id}-QMST`), 'QM-Stellungnahmen');

  const excluded = ['PB-18 v0.1 (Entwurf)', 'PB-18 v1.0 (nicht bestanden / nicht angenommen)', 'PB-17 v1.0 (belegt nur R1/A)', 'Interne Notizen, Rollenwechsel, Testschalter', 'PCN-01 / DB-B (Eingangsdokumente, kein Nachweis)'];
  if (s.cert.mode !== 'local') excluded.push(`Zertifikats-PDF (lokal nicht vorhanden – nur Link: ${src.certUrl})`);
  add(`00_Paketindex_${pkg.id}.pdf`, await indexPdf(pkg, files, excluded));
  add('manifest.json', JSON.stringify({ package: pkg.id, snapshot: pkg.hash, frozen_at: pkg.at, demo_only: true, source_link_only: !!pkg.sourceLinkOnly, files: files.map(f => f.split(' – ')[0]) }, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function buildDraftZip(d) {
  const zip = new JSZip();
  const add = (name, data) => zip.file(name, data, zipOpts(d.at));
  const s = d.snapshot;
  add('00_ARBEITSSTAND_Index_und_Lueckenliste.pdf', await makePdf({
    title: `ARBEITSSTAND ${d.id} – keine Übergabe`, docId: d.id, at: d.at, watermark: 'ARBEITSSTAND',
    blocks: [
      { warn: 'ARBEITSSTAND – nicht für die formale Übergabe. Kein freigegebener Nachweisstand.' },
      { h: `Offene Punkte (${d.gaps.length})`, list: d.gaps.length ? d.gaps : ['keine offenen Punkte erkannt'] },
      { h: 'Status', rows: [['R-04', s.risk.status === 'closed' ? 'geschlossen' : 'offen'], ['Regulatorischer Weg', ROUTES[s.route] || s.route], ['Erstellt', `${d.by}, ${fmt(d.at)}`]] },
    ],
  }));
  add('01_BOM_UL-01_R2.csv', await fetch(fileUrl('data/BOM_R2.csv')).then(r => r.text()));
  add('02_R-04_Risikomanagementauszug_v1.0.pdf', await fetchBytes('documents/R-04_Risikomanagementauszug.pdf'));
  add('03_PA-04_Pruefanweisung_v1.0.pdf', await fetchBytes('documents/PA-04_Pruefanweisung.pdf'));
  if (s.report) add(`04_${s.report.id}_v${s.report.version}.pdf`, await fetchBytes(s.report.file));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// In a claude.ai artifact plain downloads are blocked; the viewer's
// downloads capability asks the user to save instead. Resolves false if
// the viewer declined.
export async function download(blob, name) {
  const dl = window.claude?.use ? await window.claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); return true; } catch { return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return true;
}

// Opens a built ZIP and returns its entries as previewable blob URLs.
export async function readZip(blob) {
  const zip = await JSZip.loadAsync(blob);
  const out = [];
  for (const name of Object.keys(zip.files).sort()) {
    const f = zip.files[name];
    const data = await f.async('blob');
    const type = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.json') ? 'application/json' : 'text/csv';
    out.push({ name, size: data.size, url: URL.createObjectURL(new Blob([data], { type })), pdf: name.endsWith('.pdf') });
  }
  return out;
}
