import { useState, useEffect } from 'react'
import { listSessions, saveSession, deleteSession } from './sessionStore'
import { useMixerStore } from '../mixer/mixerStore'
import { useSongsStore } from '../songs/songsStore'
import { useTakesStore } from './takesStore'
import { Dialog, HardwareButton } from '@openaxe/ui'
import styles from './SessionManager.module.css'
import type { SessionState } from './types'

export function SessionManager() {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [name, setName] = useState('')

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-session-manager', handler)
    return () => window.removeEventListener('open-session-manager', handler)
  }, [])

  const refresh = async () => setSessions(await listSessions())

  useEffect(() => {
    if (open) void refresh()
  }, [open])

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const mixer = useMixerStore.getState().buses
    const songId = useSongsStore.getState().selectedId
    const takeIds = useTakesStore.getState().takes.map((t) => t.id)
    const session: SessionState = {
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: Date.now(),
      mixer: Object.fromEntries(
        Object.entries(mixer).map(([k, v]) => [
          k,
          { gain: v.gain, pan: v.pan, muted: v.muted, soloed: v.soloed },
        ]),
      ) as SessionState['mixer'],
      songId,
      takeIds,
    }
    await saveSession(session)
    setName('')
    await refresh()
  }

  const handleLoad = async (session: SessionState) => {
    // Restore mixer
    for (const [busStr, state] of Object.entries(session.mixer)) {
      const bus = Number(busStr)
      useMixerStore.getState().setGain(bus, state.gain)
      useMixerStore.getState().setPan(bus, state.pan)
      useMixerStore.getState().setMute(bus, state.muted)
      useMixerStore.getState().setSolo(bus, state.soloed)
      // Also push to core via rig
      const rig = (window as unknown as { openAxe?: { setBusGain?: (o: unknown) => void } }).openAxe
      void rig
    }
    // Restore song
    if (session.songId) {
      const { select } = useSongsStore.getState()
      select(session.songId)
    }
    setOpen(false)
  }

  const handleDelete = async (id: string) => {
    await deleteSession(id)
    await refresh()
  }

  if (!open) return null

  return (
    <Dialog
      open={true}
      onClose={() => setOpen(false)}
      title="SESSIONS"
      width="min(560px, 90vw)"
      zIndex={300}
    >
      <div className={styles.saveRow}>
        <input
          type="text"
          className={styles.nameInput}
          placeholder="Session name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <HardwareButton
          label="Save Current"
          onClick={() => void handleSave()}
          disabled={!name.trim()}
        />
      </div>

      <div className={styles.list}>
        {sessions.length === 0 && <p className={styles.hint}>No saved sessions yet.</p>}
        {sessions.map((s) => (
          <div key={s.id} className={styles.row}>
            <div className={styles.rowInfo}>
              <span className={styles.rowName}>{s.name}</span>
              <span className={styles.rowMeta}>
                {new Date(s.createdAt).toLocaleString()} · {Object.keys(s.mixer).length} buses ·{' '}
                {s.takeIds.length} takes
              </span>
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={styles.actionBtn} onClick={() => void handleLoad(s)}>
                Load
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                onClick={() => void handleDelete(s.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

export function openSessionManager() {
  window.dispatchEvent(new Event('open-session-manager'))
}
