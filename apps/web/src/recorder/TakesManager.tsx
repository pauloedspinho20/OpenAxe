import { useEffect, useRef, useState } from 'react'
import { useTakesStore } from './takesStore'
import { useAudioEngine } from '../hooks/useAudioEngine'
import { Dialog, HardwareButton } from '@openaxe/ui'
import { encodeMp3, downloadMp3 } from './mp3'
import styles from './TakesManager.module.css'

export function TakesManager() {
  const { takes, loading, load, remove, rename, download, importWav } = useTakesStore()
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-takes-manager', handler)
    return () => window.removeEventListener('open-takes-manager', handler)
  }, [])

  const handleImport = async (file: File) => {
    await importWav(file)
  }

  const handleRename = async (id: string, current: string) => {
    const next = window.prompt('Rename take', current)
    if (!next || next.trim() === current) return
    await rename(id, next.trim())
  }

  const { rig } = useAudioEngine()

  const handlePlay = async (id: string) => {
    const take = takes.find((t) => t.id === id)
    if (!take || !rig) return
    const binary = atob(take.wavBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const pcmOffset = 44
    if (bytes.length <= pcmOffset) return
    const frames = (bytes.length - pcmOffset) / 4
    const floatPcm = new Float32Array(frames * 2)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < frames; i++) {
      floatPcm[i * 2] = view.getInt16(pcmOffset + i * 4, true) / 0x7fff
      floatPcm[i * 2 + 1] = view.getInt16(pcmOffset + i * 4 + 2, true) / 0x7fff
    }
    const clipId = await rig.clipCreate()
    await rig.clipFeedPcm(clipId, floatPcm)
    rig.clipPlay(clipId)
  }

  const handleMp3 = async (id: string) => {
    const take = takes.find((t) => t.id === id)
    if (!take) return
    const binary = atob(take.wavBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    // WAV header 44 bytes, then PCM 16-bit stereo
    const pcmOffset = 44
    if (bytes.length <= pcmOffset) return
    const pcmBytes = bytes.slice(pcmOffset)
    // Convert 16-bit PCM to Float32 interleaved
    const frames = pcmBytes.length / 4
    const floatPcm = new Float32Array(frames * 2)
    const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset)
    for (let i = 0; i < frames; i++) {
      const l = view.getInt16(i * 4, true) / 0x7fff
      const r = view.getInt16(i * 4 + 2, true) / 0x7fff
      floatPcm[i * 2] = l
      floatPcm[i * 2 + 1] = r
    }
    const mp3 = await encodeMp3(floatPcm, take.sampleRate, 2, 128)
    downloadMp3(take.name, mp3)
  }

  if (!open) return null

  return (
    <Dialog open={true} onClose={() => setOpen(false)} title="TAKES" width="min(640px, 90vw)" zIndex={300}>
      <div className={styles.toolbar}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav"
          className="srOnly"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImport(file)
            e.target.value = ''
          }}
        />
        <HardwareButton label="Import WAV…" onClick={() => fileInputRef.current?.click()} />
      </div>

      {loading && <p className={styles.hint}>Loading…</p>}
      <div className={styles.list}>
        {takes.length === 0 && !loading && <p className={styles.hint}>No takes yet — record or import a WAV.</p>}
        {takes.map((take) => (
          <div key={take.id} className={styles.row}>
            <div className={styles.rowInfo}>
              <span className={styles.rowName}>{take.name}</span>
              <span className={styles.rowMeta}>
                {(take.durationFrames / take.sampleRate).toFixed(1)}s · {take.source} · {new Date(take.createdAt).toLocaleString()}
              </span>
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={styles.actionBtn} onClick={() => void handlePlay(take.id)} aria-label={`Play ${take.name}`}>
                Play
              </button>
              <button type="button" className={styles.actionBtn} onClick={() => download(take.id)} aria-label={`Download ${take.name}`}>
                WAV
              </button>
              <button type="button" className={styles.actionBtn} onClick={() => void handleMp3(take.id)} aria-label={`MP3 ${take.name}`}>
                MP3
              </button>
              <button type="button" className={styles.actionBtn} onClick={() => void handleRename(take.id, take.name)} aria-label={`Rename ${take.name}`}>
                Rename
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                onClick={() => void remove(take.id)}
                aria-label={`Delete ${take.name}`}
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

export function openTakesManager() {
  window.dispatchEvent(new Event('open-takes-manager'))
}
