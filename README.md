# NAM Web Studio

A free, open-source, web-only guitar/bass amp, cabinet, and effects suite — in the spirit of
Amplitube / Guitar Rig — built on
[Neural Amp Modeler](https://github.com/tone-3000/neural-amp-modeler-wasm) (NAM) for amp and
cabinet-IR modeling.

Runs entirely in the browser: no native app, no required backend, no account. Works offline once
installed as a PWA.

## Project decisions

| Area                 | Decision                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Distribution         | Free & open source, licensed [GPLv3](./LICENSE)                                                                      |
| Stack                | Vite + React + TypeScript (client-only SPA — no SSR needed for a real-time audio app)                                |
| Signal chain         | **Dual-chain from day 1** — two independent amp + IR + FX chains mixed to stereo                                     |
| Presets              | **Local-first** — IndexedDB, no backend/accounts; sharing via preset export/import files                             |
| State management     | [Zustand](https://github.com/pmndrs/zustand)                                                                         |
| Linting / formatting | [oxlint](https://oxc.rs) + [Prettier](https://prettier.io), enforced via Husky + lint-staged pre-commit hooks and CI |
| Testing              | [Vitest](https://vitest.dev) + React Testing Library                                                                 |

## Architecture overview

```
                    ┌─► Chain A: [FX] → [NAM amp model] → [IR cab] → [FX] → [level/pan/mute] ─┐
Input (mic/interface) ┤                                                                        ├─► Master bus → Output
                    └─► Chain B: [FX] → [NAM amp model] → [IR cab] → [FX] → [level/pan/mute] ─┘
```

- Both chains' NAM amp models run inside the **same** `AudioWorklet`/wasm module (one `NamEngine`
  per `AudioContext`, shared) — no `SharedArrayBuffer`/COOP-COEP required, and running the second
  chain doesn't double the wasm memory footprint. See
  [src/engine/README.md](./src/engine/README.md) for the full breakdown of `AmpCabChain` and
  `DualChainRig`.
- Cabinet simulation is a native `ConvolverNode` per chain, not part of the wasm engine.
- Chains default hard-panned left/right (that's the point of running two amp voicings). A `linked`
  toggle lets level/mute mirror identically and pan mirror symmetrically across both chains, for
  fast A/B tone matching without collapsing the stereo width — see `src/state/dualChainStore.ts`.
- Effects are native Web Audio DSP nodes placed before and after the amp block per chain, chained
  via `EffectsChain` — 10 effects across noise gate/dynamics/EQ/drive/modulation/delay/reverb are
  built; see [src/effects/README.md](./src/effects/README.md) (including why they're all
  original/native rather than ported from a specific pedal/plugin project).
- Presets capture the full rig state (both chains' model/IR identity, level/pan/mute/solo, and
  every pre/post FX effect's parameters) into local IndexedDB, with JSON export/import for sharing
  since there's no cloud sync — see [src/presets/README.md](./src/presets/README.md).
- [Tone3000](https://www.tone3000.com/api) integration lets users browse and import `.nam` models
  and IRs directly into the local preset library.
- A pitch-detection tuner (Pitchfinder.js) runs independently of the signal chains.
- A service worker caches the app shell and downloaded models/IRs for offline use.
- The UI is styled as hardware, not a website — a fixed dark chassis theme, custom SVG knobs and a
  real fader instead of browser form controls, one signature accent color. See
  [src/components/README.md](./src/components/README.md) for the design system and what's still a
  placeholder (effect browsing UI, onboarding, per-chain meters).

## Roadmap

Work is tracked as epics with task checklists in the
[GitHub issues](https://github.com/pauloedspinho20/NAM-Web-Studio/issues):

1. Project scaffolding, tooling & licensing
2. Audio engine core — NAM WASM integration
3. Dual signal-chain / stereo architecture
4. Effects suite
5. Preset management (local-first)
6. Tone3000 integration
7. Guitar/bass tuner
8. UI/UX & design system
9. Audio I/O management
10. Offline / PWA support
11. Testing, performance & QA
12. Deployment & release

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get set up and the licensing rules for
contributed DSP code.

## Development

```bash
npm install --legacy-peer-deps
npm run dev
```

| Script                            | Purpose                      |
| --------------------------------- | ---------------------------- |
| `npm run dev`                     | Start the dev server         |
| `npm run build`                   | Typecheck + production build |
| `npm run lint`                    | oxlint                       |
| `npm run format` / `format:check` | Prettier write / check       |
| `npm run test` / `test:run`       | Vitest watch / single run    |
| `npm run test:coverage`           | Vitest with coverage         |

## License

[GPLv3](./LICENSE) — keeps this and any derivative work free and open. The built-in effects suite
turned out to need no GPL-licensed DSP at all (see
[src/effects/README.md](./src/effects/README.md)), but GPLv3 still leaves that door open for future
contributions that do. See [CONTRIBUTING.md](./CONTRIBUTING.md) for what that means when
contributing new effects.
