import { create } from 'zustand'
import { createAutosaveScheduler } from '../presets/autosave'
import { createEmptyBank, loadSceneBank, saveSceneBank } from '../scenes/sceneBankStore'
import { SCENE_COUNT, SLOTS_PER_SCENE, type Scene, type SceneBank } from '../scenes/types'

export interface SceneStoreState {
  scenes: Scene[]
  activeScene: number
  activeSlot: number
  /** False until the bank has been read from IndexedDB - gates persistence and boot restore. */
  hydrated: boolean
  /** True while a preset apply triggered by scene navigation is in flight. */
  switching: boolean

  hydrate: (bank: SceneBank) => void
  setActive: (scene: number, slot: number) => void
  renameScene: (index: number, name: string) => void
  assignSlot: (scene: number, slot: number, presetId: string | null) => void
  setSwitching: (switching: boolean) => void
  reset: () => void
}

function inRange(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < max
}

export const useSceneStore = create<SceneStoreState>()((set) => ({
  scenes: [],
  activeScene: 0,
  activeSlot: 0,
  hydrated: false,
  switching: false,

  hydrate: (bank) =>
    set({
      scenes: bank.scenes,
      activeScene: bank.activeScene,
      activeSlot: bank.activeSlot,
      hydrated: true,
    }),

  setActive: (scene, slot) => {
    if (!inRange(scene, SCENE_COUNT) || !inRange(slot, SLOTS_PER_SCENE)) return
    set({ activeScene: scene, activeSlot: slot })
  },

  renameScene: (index, name) => {
    if (!inRange(index, SCENE_COUNT)) return
    set((s) => ({
      scenes: s.scenes.map((scene) => (scene.index === index ? { ...scene, name } : scene)),
    }))
  },

  assignSlot: (scene, slot, presetId) => {
    if (!inRange(scene, SCENE_COUNT) || !inRange(slot, SLOTS_PER_SCENE)) return
    set((s) => ({
      scenes: s.scenes.map((sc) => {
        if (sc.index !== scene) return sc
        const slots = [...sc.slots]
        slots[slot] = presetId
        return { ...sc, slots }
      }),
    }))
  },

  setSwitching: (switching) => set({ switching }),

  reset: () =>
    set({ scenes: [], activeScene: 0, activeSlot: 0, hydrated: false, switching: false }),
}))

function toBank(state: SceneStoreState): SceneBank {
  return {
    id: 'default',
    version: 1,
    scenes: state.scenes,
    activeScene: state.activeScene,
    activeSlot: state.activeSlot,
    updatedAt: Date.now(),
  }
}

const scheduler = createAutosaveScheduler<SceneBank>((bank) => saveSceneBank(bank), 250)

useSceneStore.subscribe((state) => {
  if (state.hydrated) scheduler.schedule(toBank(state))
})

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushSceneBank())
}

/** Forces any pending debounced write immediately - tests, or before the page unloads. */
export function flushSceneBank(): void {
  const state = useSceneStore.getState()
  if (state.hydrated) scheduler.flush(toBank(state))
}

/** Loads the bank into the store, seeding a fresh one first if none exists yet. Call once on boot. */
export async function hydrateSceneStore(): Promise<void> {
  const bank = (await loadSceneBank()) ?? createEmptyBank()
  useSceneStore.getState().hydrate(bank)
}
