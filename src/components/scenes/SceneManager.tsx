import { useEffect, useRef } from 'react'
import { useSceneManager } from '../../state/sceneManager'
import { useSceneStore } from '../../state/sceneStore'
import { SceneNavigator } from '../../scenes/sceneNavigator'
import { HardwareButton } from '../primitives/HardwareButton'
import styles from './SceneManager.module.css'

/**
 * The 64-scene list: rename inline, jump directly to any scene. Needs no
 * props - jumping goes through SceneNavigator (which already holds the live
 * rig/context) and renaming goes through sceneStore directly.
 */
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
    // jsdom (and possibly other test/embed environments) doesn't implement this.
    if (open) activeRowRef.current?.scrollIntoView?.({ block: 'center' })
  }, [open])

  if (!open) return null

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Scene manager"
      onClick={closeManager}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <span className={`label ${styles.title}`}>SCENES</span>
          <HardwareButton label="Close" onClick={closeManager} />
        </header>

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
                <span className={styles.sceneIndex}>
                  {String(scene.index + 1).padStart(2, '0')}
                </span>
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
      </div>
    </div>
  )
}
