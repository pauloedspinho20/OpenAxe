# Default gear (issue #101)

Bundled NAM captures / IRs the app ships with, so it's usable without a Tone3000 connection.
Picked up automatically by `apps/web/src/tone3000/defaultGear.ts` via Vite's `import.meta.glob` -
drop a file in the right folder and it appears in the app's "Defaults" tab (and, if it's the
alphabetically-first file in its folder, in the factory starter presets) with no code changes.

- `amp/` — amp-only NAM captures (`.nam`), meant to be paired with a `cab/` IR.
- `amp-cab/` — combined amp+cab NAM captures (`.nam`) - a capture already includes cab coloration
  and needs no separate IR.
- `pedal/` — pedal/drive NAM captures (`.nam`).
- `cab/` — cabinet impulse responses (`.wav`).

Multiple files per folder are supported - every one shows up in the Defaults tab. The filename
(minus extension) becomes both the id and, after replacing `-`/`_` with spaces and title-casing,
the display name shown in the app - e.g. `fender-twin-clean.nam` → "Fender Twin Clean".

Only add files you have the right to redistribute under this project's license (GPLv3) - see
[CONTRIBUTING.md](../../../../../CONTRIBUTING.md#licensing-rules-for-contributed-code).
