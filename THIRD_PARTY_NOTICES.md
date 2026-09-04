# Third-Party Notices

OpenAxe is licensed [GPLv3](./LICENSE). It wraps or vendors the following third-party components, each under its own license. The combined work is distributed as GPLv3; LGPL/MIT/BSD components remain under their original terms.

| Component                                     | Path                                                                 | License               | Upstream                                               |
| --------------------------------------------- | -------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| NeuralAmpModelerCore (NAM)                    | `packages/core/third_party/nam-core` (submodule)                     | MIT                   | https://github.com/sdatkinson/NeuralAmpModelerCore     |
| Dragonfly Reverb                              | `packages/core/third_party/dragonfly-reverb` (submodule)             | GPLv3                 | https://github.com/michaelwillis/dragonfly-reverb      |
| DPF (distrho plugin framework, via Dragonfly) | `packages/core/third_party/dragonfly-reverb/dpf`                     | ISC/MIT               | https://github.com/DISTRHO/DPF                         |
| DSPark (effects)                              | `packages/core/third_party/dspark` (or vendored)                     | MIT                   | https://github.com/sdatkinson/DSPark (check submodule) |
| Eigen (via NAMCore)                           | `packages/core/third_party/nam-core/Eigen`                           | MPL2                  | https://eigen.tuxfamily.org                            |
| iPlug2                                        | `packages/vst3` FetchContent `d54f690`                               | MIT                   | https://github.com/iPlug2/iPlug2                       |
| VST3 SDK / AU SDK / CLAP                      | fetched via iPlug2                                                   | GPLv3/MIT (per SDK)   | Steinberg / Apple / CLAP                               |
| miniaudio                                     | `apps/desktop/third_party/miniaudio/miniaudio.h` (vendored, 0.11.25) | Public domain / MIT-0 | https://github.com/mackron/miniaudio                   |
| webview.h                                     | `apps/desktop`                                                       | MIT                   | https://github.com/webview/webview                     |
| React / Vite / Zustand / tone3000 client      | `apps/web` npm                                                       | MIT                   | —                                                      |

> If you add a vendored source, add a row here and note the original project/license/version in a comment near the port and in the PR description (see `CONTRIBUTING.md#Licensing rules`).

SPDX: files that are derivative of GPL/LGPL sources should carry `SPDX-License-Identifier: GPL-3.0-only` (or appropriate). See `.reuse/` or headers.
