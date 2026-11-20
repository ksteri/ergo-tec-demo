# Devoreo – Digital Product File UL-01 (prototype)

Internal functional prototype. German UI, synthetic data, simulated interfaces. **Not** a QMS, not a compliance assessment, no series or regulatory release.

## Run

No build step and no Node required. Serve the **project root** (it must reach `data/` and `documents/`):

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://localhost:8765/app/

Opening `app/index.html` via `file://` does not work (browser blocks `fetch`).

## Hosting a shareable copy

`tools/build_hosted.sh <output-dir>` writes a self-contained copy (app at the root, `data/` and `documents/` beside it) that runs on any static host. It sets `<meta name="devoreo-base" content=".">` so the app reads data from its own root instead of `../`.

The live demo is served by GitHub Pages from the repository root: https://ksteri.github.io/ergo-tec-demo/ (the root `index.html` redirects to `app/`). Each viewer has their own demo state in their own browser. Inside a claude.ai artifact, ZIP downloads would go through the viewer's save prompt (`downloads` capability); reset always uses an in-page confirmation.

## Structure

| Path | Purpose |
|---|---|
| `app/index.html`, `app/styles.css` | Shell and styling |
| `app/js/data.js` | Loads `seed.json`, both BOM CSVs, `PCN-01.eml`, certificate source; demo personas |
| `app/js/store.js` | Single shared state, business rules, guards (disabled reasons), actions, audit log, next-action logic |
| `app/js/views.js` | The seven screens as pure render functions |
| `app/js/export.js` | Real ZIP (JSZip) and generated PDFs (pdf-lib): index, review record, matrix, decision log, gap list |
| `app/js/viewer.js` | Renders the original PDFs with pdf.js (side panel) |
| `tools/build_hosted.sh` | Builds the portable copy for hosting |
| `app/vendor/` | Vendored JSZip 3.10.1, pdf-lib 1.17.1, pdf.js 3.11.174 (no CDN at runtime) |

State lives in `localStorage` (`devoreo.ul01.demo.v1`, `devoreo.ul01.ui.v1`, state schema 2). "Demo zurücksetzen" removes only those keys. `window.__demo` exposes store/actions for testing.

## Test datasets

Two reproducible datasets (Projektakte → *Testdatensatz*; switching restarts the demo):

- **Klasse I – regulärer Herstellerweg** (default): RA can confirm the internal manufacturer route; the authorized OEM may then release R2/B.
- **Externe Genehmigung ausstehend**: starts with procedure status *Externe Genehmigung erforderlich*. An internal route is refused; release stays blocked until RA records *Externe Voraussetzung erfüllt* with the result of the competent body as evidence.

## Controls

- **Nächster Schritt** (header): next step of the story; one click switches to the right persona, opens the screen and scrolls to the block.
- **Arbeitsliste** (header): open handovers of the current persona with project, revision, reason, source, due date and next action; *Öffnen* jumps to the block.
- **Verlauf**: audit trail. **Esc** closes drawers. **Enter** in the serial field searches.
- Test switches: missing certificate file (Partner), export error (Übergabe).

## Demo personas (simulated – NOT access control)

| Role | Person | Can |
|---|---|---|
| Einkauf/Entwicklung | A. Becker | import PCN, confirm / correct / clarify mapping, impact assessment, QM task, rework correction |
| QM | Dr. M. Weber (authorized) | test order, report import/acceptance, rework assignment, deviation closure, justified exclusions, partner confirmation, handover package, answers |
| QM | T. Schulz (not authorized) | pre-review, reject, assign rework, document correction – cannot accept/close/confirm/exclude |
| OEM | S. Hoffmann (authorized) | accept package, questions, separate R2/B release (DoC scope, labelling, lots), record awareness |
| OEM / RA | J. Krüger | procedure status with classification, reason and evidence; service case assessment, external report, follow-up |
| Service | P. Wagner | time jump, serial search, RA task, repair of delivered units |

## Happy path (tested)

The header button **"Nächster Schritt"** walks the whole path. Steps:

1. Eingang: Einkauf → *E-Mail übernehmen* → confirm position 020 (or correct with reason / open a clarification) → confirm impact → create QM task.
2. Prüfung: QM Weber → *Prüfauftrag erstellen* → import PB-18 v2.0 → reason → *annehmen* (closes only the demo evidence point R-04).
3. Nachweismatrix: QM confirms the proposed exclusions of non-applicable MDR Annex I sections, each with a reason (register of all 23 sections, filters *offen* / *nicht anwendbar*).
4. Partner: Ergo-Tec / Gewerbestraße 2 / Fertigung / ISO 13485 → QM confirms.
5. Übergabe: QM → *Paket übergeben* (P-01 ZIP downloads and opens in-app) → OEM Hoffmann accepts → RA Krüger sets the procedure status with classification, reason and evidence → Hoffmann releases R2/B, documenting DoC scope, labelling and affected lots.
6. Service: P. Wagner → time jump → search `SN-DEMO-002` → RA task → OEM records awareness (sets the review deadline) → RA assesses reporting duty, addressee and deadline → external report if required (own action, simulated) → follow-up → Service documents the repair of the delivered unit.

## Negative scenarios (tested)

- Mapping correction to a position without MH-A is refused; an unclear mapping stays in a clarification (KL) until confirmed or corrected. Duplicate PCN (same Message-ID) creates no second case; unknown article MH-X9 → clarification, no auto-link.
- PB-17 (R1/A), PB-18 v0.1 (draft), PB-18 v1.0 (negative) cannot be accepted; negative creates blocking deviation AB-01.
- Deviation flow: offen → *Nacharbeit zuweisen* (owner, task, due date) → correction (not possible before rework is assigned) → effectiveness + closure by authorized QM (not possible before a positive report is accepted). Accepting PB-18 v2.0 closes R-04 but **not** AB-01.
- Exclusion without reason, or by a non-authorized person, is refused. Open exclusions block the handover package and the release.
- Wrong role / non-authorized person: button disabled with reason; the action layer re-checks too.
- Same evidence state → same package ID; re-built P-01 is byte-identical. QM answer that changes evidence → P-02, P-01 kept unchanged (status "ersetzt"); P-01 can no longer be accepted. Release is blocked while the evidence differs from the accepted package.
- Export error (test switch): no package or draft is stored, the step stays open and *Erneut versuchen* is offered.
- Procedure status: *Ungeklärt* and *Externe Mitteilung oder Genehmigung erforderlich* block the release; every status change needs classification, reason and evidence; *Externe Voraussetzung erfüllt* needs a prior external requirement and the result as evidence; frozen after release. In the external dataset an internal route is refused.
- Release without DoC scope, labelling or lots is refused.
- Service: assessment before awareness is refused; reporting duty "ja" needs addressee and deadline; follow-up needs the external report first. A repair with a spare part that differs from the built configuration (MH-A in an R2/B unit) is refused. The R2/B release never changes delivered units.
- Partner: five named checks; ISO 9001, storage site for production, MusterHub → not confirmable / clarification.
- Missing certificate: toggle on the Partner screen. Handover is blocked unless QM explicitly enables *Quelllink-Prototypmodus*; such a package is labelled incomplete and cannot be released.
- Refresh keeps state; reset clears only the demo session.

## Handover package contents

`00_Paketindex` (package ID, product/revision, creation time, recipient, and per file: name, document ID, version, purpose), `01` BOM R2, `02` R-04 extract, `02b` QM review note, `03` PA-04, `04` accepted PB-18, `05` certificates, `06` requirement matrix incl. MDR Annex I register, `07` recipient-specific decision log, `08` QM statements (from P-02), `manifest.json`. Drafts, rejected reports and internal notes are excluded. A working draft (AS-xx) is watermarked *ARBEITSSTAND* and carries a gap list.

## Simulated / not implemented

- Mail inbox, lab interface, ERP: simulated. Report metadata comes from `seed.json` (labelled in UI, not AI extraction).
- Roles are a dropdown; there is no authentication or authorization.
- Timestamps are browser time; the service "time jump" adds 183 days synthetically.
- MDR Annex I register: section titles are short navigation labels. Only No. 20.1 is traced to real evidence; sections marked *vorbestätigt (Demo)* have no conformity logic. The app derives no conformity assessment.
- Reporting deadlines in the service case are hints (MDR Art. 87); no report is sent anywhere.
- No e-signatures, no document versioning backend, no multi-user sync, no regulatory reporting.
- The certificate PDF is the public source file already in `documents/`; the app does not verify its current validity.
