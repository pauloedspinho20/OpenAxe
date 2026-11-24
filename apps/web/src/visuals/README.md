# VISUALS

The VISUALS view: audio-reactive three.js scenes on WebGPU (with WebGL2
fallback), one global control panel, presets, MIDI learn and recording.

## Layout

| Path                      | What it does                                                                |
| ------------------------- | --------------------------------------------------------------------------- |
| `audio/FeatureEngine.ts`  | Turns analyser taps into 0..1 features each frame (volume, pitch, timbre)   |
| `audio/features.ts`       | The feature ids, labels and descriptions every scene can use                |
| `modulation.ts`           | Applies audio routes (feature → param, amount, curve, smoothing) to params  |
| `engine/VisualsEngine.ts` | Owns the renderer and the frame loop, loads scenes, catches shader errors   |
| `engine/recorder.ts`      | Live recording of the canvas plus the monitor mix (MediaRecorder)           |
| `types.ts`                | The scene contract                                                          |
| `registry.ts`             | The list of scenes shown in the view                                        |
| `visualsStore.ts`         | Persisted state: per-scene params and routes, presets, audio settings, MIDI |
| `VisualsView.tsx`, `ui/`  | The view and the generic control panel                                      |
| `scenes/<name>/`          | One folder per scene: `definition.ts` (data) and `scene.ts` (three.js code) |

## Adding a scene

1. Create `scenes/<name>/definition.ts` exporting a `SceneDefinition`:
   - `params`: every control the panel shows, as data (`number`, `color`,
     `boolean`, `select`, `action`). Mark params that change shader
     constants or geometry `rebuild: true`; the host recreates the scene when
     they change and never modulates them. Never rename a shipped `key`: it
     is the id in saved presets and MIDI bindings.
   - `modulations`: the tuned starting routes, using feature ids from
     `audio/features.ts`. Users can edit, disable or reset them.
   - `credit`: author, link and licence, shown in the panel and scene list.
   - `load: () => import('./scene')`, so the scene is its own chunk.
2. Create `scenes/<name>/scene.ts` exporting `createScene(ctx)`. The scene
   owns everything it renders and calls `renderer.render` (or its own
   `PostProcessing`) inside `update(frame)`. `frame.params` holds the
   modulated values; `frame.audio` the raw features. Integrate speeds over
   time (`phase += dt * speed`) so a modulated speed never makes motion jump
   backwards. Restore any renderer state you change, and free everything in
   `dispose()`.
3. Add the definition to `SCENES` in `registry.ts`. `registry.test.ts` then
   checks its param keys, defaults and routes.
4. Open it in a real browser. Read the TSL section of
   [docs/known-issues.md](../../../../docs/known-issues.md) first: most
   shader mistakes only show up when WebGPU compiles the WGSL, and the view
   shows that error over the stage.

Scenes ported from someone else's work keep the author's credit and licence
in `credit`, and the PR notes the source.
