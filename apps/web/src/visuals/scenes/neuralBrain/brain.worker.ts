import { generateBrain, type BrainData, type BrainOptions } from './generator'

/** Runs the (slow, CPU) brain generator off the main thread. */
self.onmessage = (e: MessageEvent<{ jobId: number; options: BrainOptions }>) => {
  const r = generateBrain(e.data.options) as BrainData
  const buffers = [
    r.fiberPos,
    r.fiberData,
    r.fiberNrm,
    r.fiberRel,
    r.dotPos,
    r.dotData,
    r.dotNrm,
    r.pulsePos,
    r.pulseA,
    r.pulseB,
  ].map((a) => a.buffer)
  // The app tsconfig has DOM, not WebWorker, types.
  ;(self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(
    { jobId: e.data.jobId, data: r },
    buffers,
  )
}
