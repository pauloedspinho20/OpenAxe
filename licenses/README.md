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

## p5 is LGPL-2.1 — resolved: compatible with GPLv3

`p5@2.3.2` is a **direct production dependency** of `apps/web`, genuinely
imported (`src/components/grid/audioArt/AudioReactiveArt.tsx`), so it ships in
every binary. It declares the bare SPDX string `LGPL-2.1`, and nothing in the
published package or in `processing/p5.js` upstream contains an "or any later
version" grant — the only "any later version" text in its `license.txt` is the
LGPL's own boilerplate, not a grant by p5.

**That does not matter, and the combination is permitted.** LGPL-2.1 **§3**
says:

> You may opt to apply the terms of the ordinary GNU General Public License
> instead of this License to a given copy of the Library. To do this, you must
> alter all the notices that refer to this License, so that they refer to the
> ordinary GNU General Public License, version 2, instead of to this License.
> **(If a newer version than version 2 of the ordinary GNU General Public
> License has appeared, then you can specify that version instead if you
> wish.)**

GPL-3.0 is such a newer version, so **LGPL-2.1-only reaches GPL-3.0 by its own
terms** and the "or later" question is moot.

The FSF confirms this directly:

- Its [license list](https://www.gnu.org/licenses/license-list.html#LGPLv2.1)
  states LGPLv2.1 is "compatible with GPLv2 and GPLv3".
- Its [compatibility matrix](https://www.gnu.org/licenses/gpl-faq.html#AllCompatibility)
  gives _"I want to license my code under GPLv3"_ × _"I want to copy code under
  LGPLv2.1 only"_ → **"OK: Combination is under GPLv3"**, footnote 7:
  > LGPLv2.1 gives you permission to relicense the code under any version of
  > the GPL since GPLv2. If you can switch the LGPLed code in this case to
  > using an appropriate version of the GPL instead (as noted in the table),
  > you can make this combination.

**OpenAxe therefore conveys p5 under GPL-3.0 via LGPL-2.1 §3.** p5's upstream
LGPL-2.1 text is still shipped in `npm-packages.txt` so recipients can see the
terms it was received under.

One consequence worth noting: because §3 converts the copy to the ordinary GPL,
**LGPL §6's relinking/replacement obligation does not apply** — p5 becomes
ordinary GPL-3.0 code inside a GPL-3.0 program, and GPL-3.0's own requirement
is complete corresponding source, which this repository already provides. Had
the project instead relied on LGPL §6, shipping a minified bundle inside a
native binary would have obliged it to make p5 replaceable, which the packaging
does not support.

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
