// Source data loading. All records come from data/ and documents/ next to the
// app folder; a hosted copy sets <meta name="devoreo-base"> to its own root.
// Nothing here is AI extraction: report metadata is the controlled seed.json.

export const BASE = document.querySelector('meta[name="devoreo-base"]')?.content ?? '..';
export const CERT_FILE = 'documents/Ergo-Tec_Public_Certificates.pdf';

// Simulated demo identities. NOT access control.
export const PERSONS = [
  { id: 'eng', role: 'einkauf', name: 'A. Becker', title: 'Einkauf / Entwicklung', org: 'Ergo-Tec (Demo)', authorized: true },
  { id: 'qm1', role: 'qm', name: 'Dr. M. Weber', title: 'QM-Leitung (freigabeberechtigt)', org: 'Ergo-Tec (Demo)', authorized: true },
  { id: 'qm2', role: 'qm', name: 'T. Schulz', title: 'QM-Sachbearbeitung (nicht freigabeberechtigt)', org: 'Ergo-Tec (Demo)', authorized: false },
  { id: 'oem1', role: 'oem', name: 'S. Hoffmann', title: 'OEM Produktverantwortung (freigabeberechtigt)', org: 'BeispielMed (fiktiv)', authorized: true },
  { id: 'ra1', role: 'oem', name: 'J. Krüger', title: 'Regulatory Affairs (RA)', org: 'BeispielMed (fiktiv)', authorized: false, ra: true },
  { id: 'svc', role: 'service', name: 'P. Wagner', title: 'Service', org: 'Ergo-Tec (Demo)', authorized: true },
];

export const ROLE_LABEL = {
  einkauf: 'Einkauf / Entwicklung',
  qm: 'QM',
  oem: 'OEM (inkl. RA)',
  service: 'Service',
};

export const ROUTES = {
  unresolved: 'Ungeklärt',
  internal_confirmed: 'Interner Herstellerweg bestätigt',
  external_pending: 'Externer Schritt ausstehend',
  external_fulfilled: 'Externe Voraussetzung erfüllt',
};

// Placeholder items: preconfirmed ONLY for this limited synthetic case.
export const PRECONFIRMED = [
  { id: 'DEMO-A', label: 'MDR Anhang I, Kap. I (allgemeine Anforderungen) – übrige Punkte' },
  { id: 'DEMO-B', label: 'MDR Anhang I, Nr. 14 (Konstruktion / Umgebung)' },
  { id: 'DEMO-C', label: 'MDR Anhang I, Nr. 18 (elektrische Sicherheit)' },
  { id: 'DEMO-D', label: 'MDR Anhang I, Kap. III (Kennzeichnung / Gebrauchsanweisung)' },
];

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

export function parseEml(text) {
  const [rawHead, ...rest] = text.replace(/^﻿/, '').split(/\r?\n\r?\n/);
  const headers = {};
  rawHead.split(/\r?\n/).forEach(l => {
    const i = l.indexOf(':');
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  });
  return {
    from: headers['from'], to: headers['to'], subject: headers['subject'],
    messageId: headers['message-id'], date: headers['date'],
    body: rest.join('\n\n').trim(),
  };
}

async function exists(path) {
  try {
    const r = await fetch(`${BASE}/${path}`, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch { return false; }
}

export async function loadSources() {
  const get = p => fetch(`${BASE}/${p}`, { cache: 'no-store' }).then(r => {
    if (!r.ok) throw new Error(`Quelle nicht ladbar: ${p}`);
    return r;
  });
  const [seed, bom1, bom2, eml, certUrlTxt] = await Promise.all([
    get('data/seed.json').then(r => r.json()),
    get('data/BOM_R1.csv').then(r => r.text()),
    get('data/BOM_R2.csv').then(r => r.text()),
    get('documents/PCN-01.eml').then(r => r.text()),
    get('data/certificate_source.txt').then(r => r.text()),
  ]);
  const certUrl = (certUrlTxt.match(/https?:\/\/\S+/) || [seed.certificates[0].url])[0];
  return {
    seed,
    bom: { R1: parseCsv(bom1), R2: parseCsv(bom2) },
    emlRaw: eml,
    eml: parseEml(eml),
    certUrl,
    certLocalAvailable: await exists(CERT_FILE),
  };
}

export const fileUrl = path => `${BASE}/${path}`;
