import { cymatics } from './scenes/cymatics/definition'
import { digitalCore } from './scenes/digitalCore/definition'
import { distilledCube } from './scenes/distilledCube/definition'
import { fractalStudio } from './scenes/fractalStudio/definition'
import { holoGrid } from './scenes/holoGrid/definition'
import { neonKaleidoscope } from './scenes/neonKaleidoscope/definition'
import { neuralBrain } from './scenes/neuralBrain/definition'
import { plasmaGlobe } from './scenes/plasmaGlobe/definition'
import { quantumCore } from './scenes/quantumCore/definition'
import type { SceneDefinition } from './types'

/**
 * Every scene the VISUALS view lists, in display order. Adding a scene:
 * create `scenes/<name>/definition.ts` (params, default modulations, credit,
 * `load: () => import('./scene')`) and a `scene.ts` exporting `createScene`,
 * then list the definition here. Nothing else in the host needs to change.
 */
export const SCENES: readonly SceneDefinition[] = [
  distilledCube,
  holoGrid,
  digitalCore,
  cymatics,
  plasmaGlobe,
  neuralBrain,
  fractalStudio,
  neonKaleidoscope,
  quantumCore,
]

export function findScene(id: string | null | undefined): SceneDefinition {
  return SCENES.find((s) => s.id === id) ?? SCENES[0]!
}
