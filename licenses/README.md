# Third-party license texts

OpenAxe ships under [GPLv3](../LICENSE). That does **not** dissolve the terms of
the permissive code it links: MIT, BSD, zlib, WTFPL and MPL-2.0 all require
their copyright notice and permission text to travel **with the distribution** —
inside the `.dmg`/`.deb`/`.zip` and the plugin bundles, not merely as a link in
a repository file.

This directory is that payload. Packaging copies it into every artifact, and
`THIRD_PARTY_NOTICES.md` is the human-readable index of what is here and why.

## Contents

| File                        | Component                                         | License                                                                                       |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `NeuralAmpModelerCore.txt`  | NAM inference engine                              | MIT                                                                                           |
| `AudioDSPTools.txt`         | via NeuralAmpModelerCore                          | MIT                                                                                           |
| `Eigen.txt`                 | via NeuralAmpModelerCore                          | MPL-2.0 (plus BSD/Apache/MINPACK files — see its own `COPYING.README`, reproduced at the top) |
| `DSPark.txt`                | effects DSP                                       | MIT                                                                                           |
| `DaisySP.txt`               | Chorus                                            | MIT                                                                                           |
| `miniaudio.txt`             | desktop audio I/O                                 | Public domain _or_ MIT-0 (your choice)                                                        |
| `webview.txt`               | desktop + plugin webview                          | MIT                                                                                           |
| `nlohmann-json.txt`         | JSON                                              | MIT                                                                                           |
| `portable-file-dialogs.txt` | native file picker                                | WTFPL                                                                                         |
| `iPlug2.txt`                | plugin framework                                  | **zlib-style**, not MIT                                                                       |
| `iPlug2-WebView.txt`        | `IWebViewControl` extras                          | MIT — upstream requires the notice be kept in any redistribution                              |
| `npm-packages.txt`          | every npm production dependency of the web bundle | mixed — summary + full texts                                                                  |

The web bundle ships **inside** the desktop app and the plugin editor, so
`npm-packages.txt` is redistributed in those binaries too, not only on the web.

## Fetched at build time, not vendored here

These are pulled by CMake `FetchContent` when the plugin is built, so their
texts are not in this repository. They land in the build tree and must be
included when a plugin artifact is distributed:

- **VST3 SDK** (Steinberg) — dual-licensed **GPLv3 or proprietary**. The GPLv3
  arm is what applies to OpenAxe and needs no agreement with Steinberg, but
  distributing a VST3 product still engages Steinberg's **VST trademark**
  terms and developer registration. See issue #125.
- **CLAP SDK** — MIT.
- **AU SDK** (Apple) — Apple's own SDK terms, macOS only.
- **AAX SDK** (Avid) — proprietary and NDA-covered, with no GPL arm.
  **Not used**; deferred in issue #137.

## ⚠️ Open question: p5 is LGPL-2.1

`p5@2.3.2` is a **direct production dependency** of `apps/web` and is genuinely
imported (`src/components/grid/audioArt/AudioReactiveArt.tsx`), so it ships in
every binary.

Its `package.json` declares the bare SPDX string `LGPL-2.1` and the package
contains the plain LGPL-2.1 text with **no "or any later version" grant
anywhere**. That distinction decides compatibility:

- **LGPL-2.1-only** is **incompatible** with GPL-3.0.
- **LGPL-2.1-or-later** upgrades to LGPL-3.0, which _is_ GPL-3.0-compatible.

Nothing in the published package resolves which one applies. This needs
checking against `processing/p5.js` upstream before the first GPLv3 binary
release. If it is or-later, note it here and move on. If it is only, the
options are to drop p5, isolate it behind a boundary that keeps it out of the
GPLv3 work, or seek an exception.

Separately, LGPL — in either version — obliges you to let users **replace** the
LGPL component. For a minified bundle inside a native binary that means
shipping enough to relink or substitute p5, which the current packaging does
not do.

## Regenerating

```bash
node scripts/sync-licenses.mjs          # refresh from submodules + build trees
node scripts/sync-licenses.mjs --check  # CI drift guard
```

Texts are read verbatim from the dependency's own license file — never from an
SPDX string. Sources that have not been checked out or built are **skipped**,
not failed, so a CI leg that never configures the plugin still passes
`--check`. A full refresh therefore needs initialized submodules plus a
configured desktop **and** plugin build.
