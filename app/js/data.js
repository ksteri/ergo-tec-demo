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

// Procedure status of the series revision (set by RA).
export const ROUTES = {
  unresolved: 'Ungeklärt',
  internal_confirmed: 'Interner Herstellerweg bestätigt',
  external_required: 'Externe Mitteilung oder Genehmigung erforderlich',
  external_fulfilled: 'Externe Voraussetzung erfüllt',
};
export const EXTERNAL_KIND = { mitteilung: 'Mitteilung', genehmigung: 'Genehmigung' };

// Two reproducible test datasets (briefing acceptance test 8).
export const SCENARIOS = {
  classI: { label: 'Klasse I – regulärer Herstellerweg', short: 'Klasse I (regulär)',
    text: 'BeispielMed verantwortet die Konformität selbst. RA kann den internen Herstellerweg bestätigen; danach darf der berechtigte Hersteller R2/B freigeben.' },
  external: { label: 'Externe Genehmigung ausstehend', short: 'Externe Genehmigung',
    text: 'Synthetische Annahme: Für diese Änderung ist eine Genehmigung der zuständigen Stelle erforderlich. Ohne deren Ergebnis bleibt die Freigabe von R2/B gesperrt.' },
};

// Register by the 23 sections of MDR Annex I. Titles are short labels for
// navigation (sections 1-9 have no official headings). demo: 'r04' = traced
// to real evidence; 'pre' = preconfirmed for this synthetic case only;
// 'na' = exclusion proposed by Entwicklung, needs a justified QM confirmation.
export const ANNEX_I = [
  { no: 1, ch: 'I', title: 'Leistung und Sicherheit (allgemein)', demo: 'pre' },
  { no: 2, ch: 'I', title: 'Risikominimierung', demo: 'pre' },
  { no: 3, ch: 'I', title: 'Risikomanagementsystem', demo: 'pre' },
  { no: 4, ch: 'I', title: 'Risikokontrollmaßnahmen', demo: 'pre' },
  { no: 5, ch: 'I', title: 'Anwendungsfehler und Ergonomie', demo: 'pre' },
  { no: 6, ch: 'I', title: 'Lebensdauer', demo: 'pre' },
  { no: 7, ch: 'I', title: 'Transport und Lagerung', demo: 'pre' },
  { no: 8, ch: 'I', title: 'Bekannte Risiken und Nebenwirkungen', demo: 'pre' },
  { no: 9, ch: 'I', title: 'Produkte ohne medizinische Zweckbestimmung (Anhang XVI)', demo: 'na', na: 'UL-01 hat eine medizinische Zweckbestimmung und ist kein Produkt nach Anhang XVI.' },
  { no: 10, ch: 'II', title: 'Chemische, physikalische und biologische Eigenschaften', demo: 'pre' },
  { no: 11, ch: 'II', title: 'Infektion und mikrobielle Kontamination', demo: 'pre' },
  { no: 12, ch: 'II', title: 'Produkte mit Arzneimittelanteil oder vom Körper aufgenommenen Stoffen', demo: 'na', na: 'UL-01 enthält weder Arzneimittel noch Stoffe, die vom Körper aufgenommen werden.' },
  { no: 13, ch: 'II', title: 'Produkte mit Materialien biologischen Ursprungs', demo: 'na', na: 'Die Stückliste enthält keine Materialien biologischen Ursprungs.' },
  { no: 14, ch: 'II', title: 'Herstellung und Wechselwirkung mit der Umgebung', demo: 'pre' },
  { no: 15, ch: 'II', title: 'Produkte mit Diagnose- oder Messfunktion', demo: 'na', na: 'UL-01 hat keine Diagnose- oder Messfunktion.' },
  { no: 16, ch: 'II', title: 'Schutz vor Strahlung', demo: 'na', na: 'UL-01 erzeugt keine Strahlung im Sinne von Nr. 16.' },
  { no: 17, ch: 'II', title: 'Programmierbare Elektroniksysteme und Software', demo: 'pre' },
  { no: 18, ch: 'II', title: 'Aktive Produkte', demo: 'pre' },
  { no: 19, ch: 'II', title: 'Aktive implantierbare Produkte', demo: 'na', na: 'UL-01 ist kein implantierbares Produkt.' },
  { no: 20, ch: 'II', title: 'Schutz vor mechanischen und thermischen Risiken', demo: 'r04' },
  { no: 21, ch: 'II', title: 'Schutz vor Risiken durch Energie- oder Stoffabgabe an den Patienten', demo: 'na', na: 'UL-01 gibt weder Energie noch Stoffe an den Patienten ab.' },
  { no: 22, ch: 'II', title: 'Produkte zur Anwendung durch Laien', demo: 'na', na: 'UL-01 ist ausschließlich für professionelle Anwender bestimmt.' },
  { no: 23, ch: 'III', title: 'Kennzeichnung und Gebrauchsanweisung', demo: 'pre' },
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
