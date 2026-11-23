import { HardwareButton } from '@openaxe/ui'
import { LoopGlyph, MediaGlyph } from './icons'
import styles from './MediaCenter.module.css'
import { useMediaStore } from './mediaStore'
import { TransportButtons } from './TransportBar'

/** Compact transport bar that stays on screen while the Media Center is closed. */
export function MediaDock({ onOpen }: { onOpen: () => void }) {
  const activeId = useMediaStore((s) => s.activeId)
  const item = useMediaStore((s) => s.items.find((i) => i.id === s.activeId))
  const position = useMediaStore((s) => s.position)
  const duration = useMediaStore((s) => s.duration)
  const speed = useMediaStore((s) => s.practice.speed)
  const semitones = useMediaStore((s) => s.practice.semitones)
  const loopOn = useMediaStore((s) => s.practice.loopEnabled && s.practice.loopStart !== null)
  if (!activeId || !item) return null
  const pct = duration > 0 ? (position / duration) * 100 : 0

  return (
    <div className={styles.dock} role="region" aria-label="Media player">
      <button
        type="button"
        className={styles.dockTitle}
        onClick={onOpen}
        title="Open the Media Center"
      >
        <MediaGlyph size={16} />
        <span className={styles.dockName}>{item.name}</span>
      </button>
      <TransportButtons compact />
      <input
        className={styles.dockSeek}
        type="range"
        min={0}
        max={1000}
        value={Math.round(pct * 10)}
        onChange={(e) =>
          void useMediaStore.getState().seek((Number(e.target.value) / 1000) * duration)
        }
        aria-label="Seek"
      />
      <span className={styles.dockBadge} title="Speed">
        {Math.round(speed * 100)}%
      </span>
      {semitones !== 0 && (
        <span className={styles.dockBadge} title="Transpose">
          {semitones > 0 ? '+' : ''}
          {semitones} st
        </span>
      )}
      <HardwareButton
        size="small"
        iconOnly
        label="Toggle loop"
        title="A-B loop"
        icon={<LoopGlyph size={14} />}
        active={loopOn}
        onClick={() => useMediaStore.getState().toggleLoop()}
      />
    </div>
  )
}
