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

**These folders are deliberately empty right now.** An earlier attempt bundled 4 real Tone3000
captures here, but every one of them carries Tone3000's standard "T3K" license: _"Users may
download and use the data file in software and publish the resulting outputs without royalties or
restrictions. However, they may not upload, republish, or distribute the data file without the
author's permission."_ Checking a `.nam`/`.wav` file into this public repo - or shipping it in the
built app - **is** redistributing it, so a capture under that license can't go here without the
original creator's explicit permission, even though the app _using_ it at runtime is fine. Before
adding a Tone3000-sourced file here, either confirm it's CC0/public-domain, or get - and keep a
record of - the author's permission to redistribute it specifically.
