# Third-Party Notices

OpenAxe is licensed [GPLv3](./LICENSE). It links, vendors or bundles the components
below, each under its own license. The combined work is distributed as GPLv3;
the permissive components remain under their original terms, and those terms
require their notices to be **distributed with the binaries** — see
[`licenses/`](./licenses/), which packaging copies into every artifact.

> Adding a vendored source? Add a row here, add it to `scripts/sync-licenses.mjs`,
> run that script, and note the project/license/version in a comment near the port
> and in your PR description — see [`CONTRIBUTING.md`](./CONTRIBUTING.md#licensing-rules-for-contributed-code).

## Compiled into the C++ engine

| Component            | Path                                                         | License  | Upstream                                           |
| -------------------- | ------------------------------------------------------------ | -------- | -------------------------------------------------- |
| NeuralAmpModelerCore | `packages/core/third_party/nam-core` (submodule)             | MIT      | https://github.com/sdatkinson/NeuralAmpModelerCore |
| AudioDSPTools        | via NeuralAmpModelerCore `Dependencies/`                     | MIT      | https://github.com/sdatkinson/AudioDSPTools        |
| Eigen                | via NeuralAmpModelerCore `Dependencies/eigen`                | MPL-2.0¹ | https://eigen.tuxfamily.org                        |
| nlohmann/json        | via NeuralAmpModelerCore, and CMake `FetchContent` `v3.11.3` | MIT      | https://github.com/nlohmann/json                   |
| DSPark               | `packages/core/third_party/dspark` (submodule)               | MIT      | https://github.com/CristianMoresi/DSPark           |
| DaisySP              | `packages/core/third_party/daisysp` (submodule)              | MIT²     | https://github.com/electro-smith/DaisySP           |

¹ Eigen is _primarily_ MPL-2.0; some files are BSD, Apache or MINPACK-licensed.
Its own `COPYING.README` is reproduced at the top of `licenses/Eigen.txt`. All
are GPL-compatible, and Eigen ships unmodified.

² Only the MIT portion of the DaisySP repository is compiled — the separate
`DaisySP-LGPL` tree is deliberately **not** used (`packages/core/CMakeLists.txt`).

## Desktop shell

| Component                     | Source                               | License                    | Upstream                                            |
| ----------------------------- | ------------------------------------ | -------------------------- | --------------------------------------------------- |
| miniaudio `0.11.25`           | `apps/desktop/third_party/miniaudio` | Public domain **or** MIT-0 | https://github.com/mackron/miniaudio                |
| webview `0.12.0`              | CMake `FetchContent`                 | MIT                        | https://github.com/webview/webview                  |
| portable-file-dialogs `0.1.0` | CMake `FetchContent`                 | WTFPL                      | https://github.com/samhocevar/portable-file-dialogs |

## Plugin (VST3 / CLAP / AU)

| Component             | Source                         | License                                     | Upstream                           |
| --------------------- | ------------------------------ | ------------------------------------------- | ---------------------------------- |
| iPlug2                | CMake `FetchContent` `d54f690` | **zlib-style** (_not_ MIT)³                 | https://github.com/iPlug2/iPlug2   |
| iPlug2 WebView extras | within iPlug2                  | MIT — notice must be kept on redistribution | https://github.com/iPlug2/iPlug2   |
| VST3 SDK              | fetched via iPlug2             | **GPLv3 or proprietary** (dual)⁴            | Steinberg                          |
| CLAP SDK              | fetched via iPlug2             | MIT                                         | https://github.com/free-audio/clap |
| AU SDK                | fetched via iPlug2 (macOS)     | Apple SDK terms                             | Apple                              |
| AAX SDK               | **not used** — see issue #137  | Proprietary, NDA, no GPL arm                | Avid                               |

³ iPlug2's `LICENSE.txt` is a zlib/libpng-style grant, not MIT. It is
GPL-compatible, but it requires that the origin not be misrepresented, that
altered sources be marked as such, and that the notice not be removed. Earlier
revisions of this file and of `README.md` said "MIT" — that was wrong.

⁴ The GPLv3 arm applies cleanly to OpenAxe and needs no agreement with
Steinberg (see issue #125). Distributing a VST3 product nonetheless engages
Steinberg's **VST trademark** terms and developer registration, which are
separate from the copyright license.

## Web bundle

The React app's npm production dependencies ship inside the desktop app and the
plugin editor as well as on the web. The full summary and texts are generated
into [`licenses/npm-packages.txt`](./licenses/npm-packages.txt); the headline
components are React, Vite, Zustand and the Tone3000 client (all MIT).

> **⚠️ `p5@2.3.2` is LGPL-2.1 and its "or later" status is unresolved.** It is a
> direct, genuinely imported production dependency, so it ships in every binary.
> LGPL-2.1-**only** is _incompatible_ with GPL-3.0; LGPL-2.1-**or-later** is
> fine. Nothing in the published package says which. This must be settled
> against `processing/p5.js` before the first GPLv3 binary release — see
> [`licenses/README.md`](./licenses/README.md#-open-question-p5-is-lgpl-21).

## Platform notes

- **GPLv3 and the Apple App Store are incompatible.** Apple's terms impose
  installation and usage restrictions GPLv3 forbids, and the FSF has enforced
  this. `apps/ios` is on the roadmap (issue #17); shipping there would require
  relicensing, which the project's DCO-not-CLA choice makes materially harder
  once contributors accumulate. Worth settling early.
- OpenAxe does not currently add `SPDX-License-Identifier` headers to its own
  sources. If that changes, GPL-derived files should carry
  `SPDX-License-Identifier: GPL-3.0-only`, matching `CITATION.cff`.
