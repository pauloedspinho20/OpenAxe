# @openaxe/remotion — Landing videos (Remotion)

Programmatic landing-page loops for `apps/landing` (GitHub Pages), built with [Remotion](https://www.remotion.dev/) (`remotion-dev/skills`). One source of truth: React + `useCurrentFrame()`/`interpolate()` animating the same UI that ships in `apps/web` — pixel-faithful, token-driven, re-renderable on every `VERSION` bump.

**Issue:** [#298](https://github.com/pauloedspinho20/OpenAxe/issues/298) — epic: app-interaction videos, one per landing section.

## Compositions

All 720p (1280×720), 30 fps, 10 s (300 frames), silent `mp4 (h264)` — autoplay muted loops. Two variants per composition (Carbon dark + Aluminum light) via `zod` `theme` prop.

| Composition                       | Landing section    | What it shows                                                                                            |
| --------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `Hero` / `HeroAluminum`           | Hero               | `Input → [IN] → AMP → CAB → … → [OUT] → Master` tag cascade + 3×8 grid dots filling + cable draw         |
| `Amp` / `AmpAluminum`             | Features · AMP     | Tone3000 browser cards → selected capture loads into Amp block, knobs (Gain/Bass/Mid/Treble/Volume) turn |
| `Effects` / `EffectsAluminum`     | Features · Effects | Gate/Comp/EQ/Chorus/Delay/Reverb 6-up, mix bars + meters + bypass toggles                                |
| `CabMixer` / `CabMixerAluminum`   | Features · Cab     | IR waveform (partitioned convolver), `ir_mix` slider, Splitter/Mixer + Master fader/meter                |
| `Platforms` / `PlatformsAluminum` | Platforms          | Web · Desktop · VST3 · Mobile cards + `openaxe_core` pill + bottom gradient cable                        |

Presentation-only per `ARCHITECTURE.md` — no DSP logic; visuals reuse `packages/ui/tokens/design-tokens.json` and lightweight replicas of `packages/ui` primitives (Knob, Panel) + `apps/web` grid chrome.

## Workflow

```bash
# Install (arm64 — use npm exec if your pnpm is the x64 shim, see AGENTS.md)
pnpm install --no-frozen-lockfile
# or
npm exec --yes pnpm@10.16.1 -- install --no-frozen-lockfile

# Preview in Studio (http://localhost:3000)
pnpm --filter @openaxe/remotion dev
# or from root
pnpm dev:remotion

# One-frame sanity check (1 s mark, 720p)
pnpm --filter @openaxe/remotion still Hero --frame=30 --scale=0.5

# Render all 10 to landing (committed artifacts, like wasm-core)
for id in Hero HeroAluminum Amp AmpAluminum Effects EffectsAluminum CabMixer CabMixerAluminum Platforms PlatformsAluminum; do
  pnpm --filter @openaxe/remotion render $id --codec=h264 --output=../landing/public/videos/$id.mp4
  pnpm --filter @openaxe/remotion still $id --frame=0 --output=../landing/public/videos/$id-poster.jpg
done
# Alternatively via VS Code: Run Task → Remotion: Render all / Remotion: Still check

# Typecheck / lint (Turborepo)
pnpm --filter @openaxe/remotion typecheck
pnpm lint
```

Outputs go to `apps/landing/public/videos/` — checked in, served via Vite `publicDir: 'public'` at `/videos/*` locally and `/OpenAxe/videos/*` on Pages (`apps/landing/vite.config.ts:6` `base`). Landing wires them as `<video autoplay muted loop playsinline poster="…">` with `prefers-reduced-motion` fallback (see `apps/landing/src/main.ts`).

## Tokens

Do not hardcode hex. Import `getTheme(theme)` from `src/theme.ts` which mirrors `packages/ui/tokens/design-tokens.json`. If you edit tokens, run `node packages/ui/scripts/generate-tokens.mjs --check` (drift guard) and re-render.

## Skills used

- `remotion-create` — scaffold (`npx create-video@latest --blank`)
- `remotion-markup` — `useCurrentFrame`/`interpolate`/`Easing`/`Sequence`/`Interactive.*` inline-style pattern
- `remotion-studio` — `remotion studio --no-open`
- `remotion-render` — `remotion render` / `still` with `--codec=h264`
- `remotion-interactivity` / `remotion-best-practices` — Studio-editable markup

## Rendering notes

- Silent loops — no audio track, no `@remotion/media` audio, no VO (`remotion-captions` deferred).
- Total budget: 10 files × ~1–2 MB ≈ 10–20 MB committed; landing lazy-loads offscreen sections via `IntersectionObserver`.
- CI does not render; `pages.yml` just builds `apps/landing/dist`. A future drift guard could warn if `public/videos/` exceeds budget.

## Version sync

`scripts/sync-version.mjs` now includes `apps/remotion/package.json` (6 files total). Bump `VERSION` then run `node scripts/sync-version.mjs`.
