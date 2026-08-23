import { useEffect, useRef } from 'react'
import { useSceneManager } from '../../../state/sceneManager'
import { useSceneStore } from '../../../state/sceneStore'
import { SceneNavigator } from '../../../scenes/sceneNavigator'
import { Dialog } from '@openaxe/ui'
import styles from './SceneManager.module.css'

export function SceneManager() {
  const open = useSceneManager((s) => s.open)
  const closeManager = useSceneManager((s) => s.closeManager)
  const scenes = useSceneStore((s) => s.scenes)
  const activeScene = useSceneStore((s) => s.activeScene)
  const renameScene = useSceneStore((s) => s.renameScene)
  const activeRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeManager()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeManager])

  useEffect(() => {
    if (open) activeRowRef.current?.scrollIntoView?.({ block: 'center' })
  }, [open])

  return (
    <Dialog open={open} onClose={closeManager} title="SCENES" width="min(560px, 90vw)" zIndex={300}>
      <div className={styles.list}>
        {scenes.map((scene) => {
          const filled = scene.slots.filter((s) => s != null).length
          const isActive = scene.index === activeScene
          return (
            <div
              key={scene.index}
              ref={isActive ? activeRowRef : undefined}
              className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
            >
              <span className={styles.sceneIndex}>{String(scene.index + 1).padStart(2, '0')}</span>
              <input
                type="text"
                className={styles.nameInput}
                placeholder={`Scene ${scene.index + 1}`}
                value={scene.name}
                onChange={(e) => renameScene(scene.index, e.target.value)}
              />
              <span className={styles.rowMeta}>{filled}/8 slots</span>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => {
                  void SceneNavigator.goToScene(scene.index, { source: 'ui' })
                  closeManager()
                }}
                aria-label={`Jump to scene ${scene.index + 1}`}
              >
                Jump
              </button>
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}
