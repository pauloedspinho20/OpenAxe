import { useEffect } from 'react'
import { useGraphStore } from '../../state/graphStore'
import { Tuner } from '../Tuner'
import { Dialog } from '../shared'

export interface TunerDialogProps {
  open: boolean
  onClose: () => void
  analyser: AnalyserNode | null
}

export function TunerDialog({ open, onClose, analyser }: TunerDialogProps) {
  useEffect(() => {
    useGraphStore.getState().setTunerMuted(open)
    return () => {
      if (open) useGraphStore.getState().setTunerMuted(false)
    }
  }, [open])

  return (
    <Dialog open={open} onClose={onClose} title="Tuner" width="min(480px, 90vw)">
      <Tuner analyser={analyser} size="full" />
      <p className="label" style={{ color: 'var(--ink-3)', textAlign: 'center' }}>
        Output muted while tuning
      </p>
    </Dialog>
  )
}
