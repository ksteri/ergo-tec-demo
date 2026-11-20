# Devoreo – Digital Product File UL-01 (prototype)

Internal functional prototype with a German UI, synthetic data and simulated interfaces. It is not a QMS and makes no compliance or release claims. Ergo-Tec certificate data comes from their public certificate PDF.

**Play the demo:** https://ksteri.github.io/ergo-tec-demo/ – each viewer gets their own demo state in their own browser; use "Demo zurücksetzen" to start over. The header button **"Nächster Schritt"** walks through the whole story and switches to the right demo role at every step.

## Test datasets

Switch on the Projektakte screen (*Testdatensatz*); switching restarts the demo.

- **Klasse I – regulärer Herstellerweg:** RA confirms the internal manufacturer route, then the authorized OEM releases R2/B.
- **Externe Genehmigung ausstehend:** release stays blocked until RA records the result of the competent body.

## Scenarios

**Success path:** supplier notice PCN-01 → assign to BOM position 020 → impact assessment → QM task → test order → accept PB-18 v2.0 (closes R-04) → confirm justified exclusions in the MDR Annex I register → confirm partner certificate (ISO 13485) → hand over package P-01 → OEM accepts → RA sets procedure status → OEM releases R2/B (DoC scope, labelling, lots) → time jump → serial SN-DEMO-002 → RA assessment → follow-up → repair of the delivered unit.

**Negative scenarios to try:**

- Correct the mapping to a position without MH-A, or send the unknown article MH-X9 → refused / clarification.
- Accept PB-17 (R1/A), the draft or the failed report → refused; the failed report opens deviation AB-01 (assign rework → correction → effectiveness and closure).
- Exclude an MDR section without a reason, or as T. Schulz → refused.
- ISO 9001, the storage site, or MusterHub as manufacturing partner → not confirmable.
- Any action with the wrong role → disabled with the reason.
- OEM question answered with changed evidence → new package P-02, P-01 unchanged.
- Release while the procedure status is open or external approval is pending, or without DoC scope, labelling and lots → refused.
- Test switches: missing certificate file (Partner), export error with retry (Übergabe).
- Repair with spare part MH-A in an R2/B unit → refused.

Full details, personas and package contents are in [RUN.md](RUN.md).

**Run locally:** from the repository root, run `python3 -m http.server 8765 --bind 127.0.0.1` and open http://localhost:8765/app/

See [RUN.md](RUN.md) for structure, personas, all tested scenarios and what is simulated. The original build brief is in [CLAUDE_BUILD_PROMPT.md](CLAUDE_BUILD_PROMPT.md).
