# External fixture contract

Product-generated files belong in this directory only when they are approved for repository
storage. Each fixture must carry a sidecar that identifies the product and export conditions;
the harness must never infer compatibility from a filename alone.

Required sidecar fields are shown in `manifest.example.json`:

- product and version, export/import path, locale, encoding, and line-ending convention;
- format and source filename with a content hash;
- expected worksheet relationship, merge, validation, style, formula, and CSV field invariants;
- whether credentials, a browser, or an installed product were required to create the fixture.

Real credentials and tokens must never be committed. A fixture without a sidecar is not eligible
for external-e2e evidence.
