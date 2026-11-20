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

The current copy is published as a private claude.ai artifact: https://claude.ai/artifact/Y3RUMWAqqx75A7uvB2DpB2 (share via its Share menu). Inside an artifact, ZIP downloads go through the viewer's save prompt (`downloads` capability) and reset uses an in-page confirmation, because plain downloads and `confirm()` are blocked there. Each viewer has their own demo state in their own browser. The hosted copy is a snapshot: rebuild and republish after code changes.

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

State lives in `localStorage` (`devoreo.ul01.demo.v1`, `devoreo.ul01.ui.v1`). "Demo zurücksetzen" removes only those keys. `window.__demo` exposes store/actions for testing.

## Demo personas (simulated – NOT access control)

| Role | Person | Can |
|---|---|---|
| Einkauf/Entwicklung | A. Becker | import PCN, confirm mapping, impact assessment, QM task |
| QM | Dr. M. Weber (authorized) | test order, report import/acceptance, deviation closure, partner confirmation, formal package, answers |
| QM | T. Schulz (not authorized) | pre-review, reject, document correction – cannot accept/close/confirm |
| OEM | S. Hoffmann (authorized) | accept package, questions, separate R2/B release, record awareness |
| OEM / RA | J. Krüger | regulatory route only |
| Service | P. Wagner | time jump, serial search, RA task |

## Happy path (tested)

The header button **"Nächster Schritt"** walks the whole path: each click switches to the persona the step needs, opens the screen and scrolls to the block. Steps:

1. Eingang: Einkauf → *E-Mail übernehmen* → confirm position 020 → confirm impact → create QM task.
2. Prüfung: QM Weber → *Prüfauftrag erstellen* → import PB-18 v2.0 → reason → *annehmen* (closes only the demo evidence point R-04).
3. Partner: Ergo-Tec / Gewerbestraße 2 / Fertigung / ISO 13485 → QM confirms.
4. Übergabe: QM → *Formales Paket erzeugen* (P-01 ZIP downloads and opens in-app) → OEM Hoffmann accepts → RA Krüger sets "Interner Herstellerweg bestätigt" → Hoffmann releases R2/B.
5. Service: P. Wagner → time jump → search `SN-DEMO-002` → RA task → OEM records awareness time.

## Negative scenarios (tested)

- PB-17 (R1/A), PB-18 v0.1 (draft), PB-18 v1.0 (negative) cannot be accepted; negative creates blocking deviation AB-01.
- Accepting PB-18 v2.0 closes R-04 but **not** AB-01; QM must document correction, then (authorized) effectiveness + closure. Open deviation blocks formal package and release.
- Wrong role / non-authorized person: button disabled with reason; the action layer re-checks too.
- Duplicate PCN delivery (same Message-ID) and unknown article MH-X9 (→ clarification list, no auto-link).
- Same evidence state → same package ID; re-built P-01 is byte-identical. QM answer that changes evidence → P-02, P-01 kept unchanged (status "ersetzt").
- RA "Externer Schritt ausstehend" or "Ungeklärt" blocks release; route frozen after release.
- Partner: five named checks (norm, site, activity coverage, manufacturing scope, validity) with a next-step hint; ISO 9001, storage site for production, MusterHub → not confirmable / clarification.
- Missing certificate: toggle *Testschalter: fehlende lokale Datei simulieren* (Partner screen). Formal package is blocked unless QM explicitly enables *Quelllink-Prototypmodus*; such a package is watermarked/labelled incomplete and cannot be released.
- Refresh keeps state; reset clears only the demo session.

## Simulated / not implemented

- Mail inbox, lab interface, ERP: simulated. Report metadata comes from `seed.json` (labelled in UI, not AI extraction).
- Roles are a dropdown; there is no authentication or authorization.
- Timestamps are browser time; the service "time jump" adds 183 days synthetically.
- Other MDR requirements are shown as *vorbestätigt (Demo)*; no conformity logic exists for them.
- No e-signatures, no document versioning backend, no multi-user sync, no regulatory reporting.
- The certificate PDF is the public source file already in `documents/`; the app does not verify its current validity.
