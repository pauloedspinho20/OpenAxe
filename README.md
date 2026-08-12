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
Input (mic/interface) ──┬─► Chain A: [FX] → [NAM amp model] → [IR cab] → [FX] ─┐
                          │                                                     ├─► Stereo mixer → Output
                          └─► Chain B: [FX] → [NAM amp model] → [IR cab] → [FX] ─┘
```

- Each chain runs its own NAM WASM engine instance inside an `AudioWorklet` (real-time audio
  thread, no `SharedArrayBuffer`/COOP-COEP required — see the
  [neural-amp-modeler-wasm](https://github.com/tone-3000/neural-amp-modeler-wasm) architecture).
- Effects are Web Audio / WASM DSP nodes placed before and after the amp block per chain.
- [Tone3000](https://www.tone3000.com/api) integration lets users browse and import `.nam` models
  and IRs directly into the local preset library.
- A pitch-detection tuner (Pitchfinder.js) runs independently of the signal chains.
- A service worker caches the app shell and downloaded models/IRs for offline use.

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

[GPLv3](./LICENSE) — chosen so the project can incorporate high-quality GPL-licensed audio DSP
(e.g. Dragonfly Reverb, ChowDSP) alongside MIT/permissive sources. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for what that means when contributing new effects.
