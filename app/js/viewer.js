// Renders the ORIGINAL PDF files with pdf.js (no fake previews).
const pdfjs = window.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';

const cache = new Map();
let token = 0;

export async function renderPdf(host, url, page) {
  const my = ++token;
  host.innerHTML = '<div class="viewer-loading">Dokument wird geladen …</div>';
  try {
    if (!cache.has(url)) cache.set(url, pdfjs.getDocument({ url }).promise);
    const doc = await cache.get(url);
    if (my !== token) return null;
    const n = Math.min(Math.max(1, page), doc.numPages);
    const p = await doc.getPage(n);
    const width = Math.max(260, host.clientWidth - 2);
    const base = p.getViewport({ scale: 1 });
    const scale = width / base.width;
    const ratio = window.devicePixelRatio || 1;
    const vp = p.getViewport({ scale: scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    canvas.style.width = `${width}px`;
    await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    if (my !== token) return null;
    host.innerHTML = '';
    host.appendChild(canvas);
    return { pages: doc.numPages, page: n };
  } catch (e) {
    cache.delete(url);
    if (my === token) host.innerHTML = `<div class="viewer-missing"><strong>Lokale Datei nicht verfügbar.</strong><br>${e.message || e}</div>`;
    return null;
  }
}
