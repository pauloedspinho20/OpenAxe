export interface BlockParamSpec {
  label: string
  range: string
  fill: number
}

export interface BlockSpec {
  id: string
  label: string
  category: 'NAM & Cab' | 'Effects' | 'Routing'
  colorVar: string
  engine: string
  summary: string
  params: BlockParamSpec[]
  iconPaths: string
}

export const BLOCK_CATALOG: readonly BlockSpec[] = [
  {
    id: 'amp',
    label: 'Amp',
    category: 'NAM & Cab',
    colorVar: '--block-amp',
    engine: 'NeuralAmpModelerCore (C++20)',
    summary:
      'Loads any .nam amp head capture with calibration I/O, optional slimmable scaling, and a post-capture 4-band tone stack.',
    params: [
      { label: 'Input / Output Cal', range: '-100 to +100 dBu', fill: 50 },
      { label: 'Bass / Mid / Treble', range: '-12 to +12 dB', fill: 58 },
      { label: 'Presence', range: '-12 to +12 dB', fill: 62 },
      { label: 'Slim Size', range: '0 to 100%', fill: 100 },
    ],
    iconPaths:
      '<rect x="1" y="4" width="22" height="16" rx="1.2"/><circle cx="6" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="18" cy="9" r="1.2" fill="currentColor" stroke="none"/><path d="M1 14.1h22"/>',
  },
  {
    id: 'amp-cab',
    label: 'Amp/Cab',
    category: 'NAM & Cab',
    colorVar: '--block-amp-cab',
    engine: 'NeuralAmpModelerCore (C++20)',
    summary:
      'Full-rig .nam captures combining head, power amp, and mic’d cabinet in one block — ideal for low-CPU live rigs.',
    params: [
      { label: 'Tone Stack (4-Band)', range: '-12 to +12 dB', fill: 54 },
      { label: 'Block Input Trim', range: 'Per-block gain', fill: 60 },
      { label: 'Block Output Trim', range: 'Per-block gain', fill: 65 },
      { label: 'Slim Size', range: '0 to 100%', fill: 100 },
    ],
    iconPaths:
      '<rect x="1" y="1" width="22" height="22" rx="1.2"/><circle cx="6" cy="5" r="1.2" fill="currentColor" stroke="none"/><circle cx="10" cy="5" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="5" r="1.2" fill="currentColor" stroke="none"/><circle cx="18" cy="5" r="1.2" fill="currentColor" stroke="none"/><path d="M1 9.1h22"/><circle cx="7" cy="16" r="3.6" fill="currentColor" stroke="none"/><circle cx="17" cy="16" r="3.6" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'pedal',
    label: 'Pedal',
    category: 'NAM & Cab',
    colorVar: '--block-pedal',
    engine: 'NeuralAmpModelerCore (C++20)',
    summary:
      'Neural captures of physical overdrives, fuzzes, distortions, and preamps running on the exact same C++ NAM engine.',
    params: [
      { label: 'Capture Calibration', range: '-100 to +100 dBu', fill: 50 },
      { label: 'Tone Stack EQ', range: '-12 to +12 dB', fill: 55 },
      { label: 'Bypass / Mix', range: 'Hardware footswitch', fill: 100 },
    ],
    iconPaths:
      '<rect x="3" y="1" width="18" height="22" rx="1.5"/><circle cx="7" cy="5" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="1.8" fill="currentColor" stroke="none"/><circle cx="17" cy="5" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="2.2" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'cab',
    label: 'Cab',
    category: 'NAM & Cab',
    colorVar: '--block-cab',
    engine: 'Zero-Latency Partitioned Convolver',
    summary:
      'Loads .wav cabinet impulse responses with automatic sample-rate resampling, wet/dry blend, and post-IR high/low-pass filters.',
    params: [
      { label: 'IR Mix', range: '0 to 100%', fill: 100 },
      { label: 'Low Cut (HPF)', range: '20 to 1000 Hz', fill: 28 },
      { label: 'High Cut (LPF)', range: '2000 to 20000 Hz', fill: 72 },
    ],
    iconPaths:
      '<rect x="1" y="1" width="22" height="22" rx="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'noise-gate',
    label: 'Gate',
    category: 'Effects',
    colorVar: '--block-dynamics',
    engine: 'DSPark C++ DSP',
    summary:
      'Tight high-gain noise gate with hysteresis, hold window, and configurable attenuation range so palm mutes chop cleanly.',
    params: [
      { label: 'Threshold', range: '-80 to 0 dB', fill: 45 },
      { label: 'Hysteresis', range: '0 to 20 dB', fill: 30 },
      { label: 'Attack / Hold / Release', range: '0.01–50 / 0–500 / 1–1000 ms', fill: 40 },
      { label: 'Range', range: '-100 to 0 dB', fill: 70 },
    ],
    iconPaths: '<path d="M19 2v20L5 12z" transform="rotate(-90 12 12)"/>',
  },
  {
    id: 'compressor',
    label: 'Comp',
    category: 'Effects',
    colorVar: '--block-dynamics',
    engine: 'DSPark C++ DSP',
    summary:
      'Parallel-capable studio compressor with selectable character, soft knee, makeup gain, and live gain-reduction metering.',
    params: [
      { label: 'Threshold / Ratio', range: '-60–0 dB / 1:1–20:1', fill: 55 },
      { label: 'Attack / Release', range: '0.1–100 / 1–2000 ms', fill: 38 },
      { label: 'Knee / Makeup', range: '0–20 dB / 0–24 dB', fill: 48 },
      { label: 'Character / Mix', range: '4 modes · 0–100%', fill: 80 },
    ],
    iconPaths: '<path d="M12 1v22"/><path d="M1 4v16l10-8z"/><path d="M23 4v16l-10-8z"/>',
  },
  {
    id: 'eq',
    label: 'EQ',
    category: 'Effects',
    colorVar: '--block-core',
    engine: 'DSPark C++ DSP',
    summary:
      '4-band parametric equalizer with surgical Q control plus independent Low Cut (HPF) and High Cut (LPF) filters.',
    params: [
      { label: '4× Band Freq', range: '20 Hz to 20 kHz', fill: 64 },
      { label: '4× Band Gain', range: '-15 to +15 dB', fill: 58 },
      { label: '4× Band Q', range: '0.1 to 10×', fill: 35 },
      { label: 'Low Cut / High Cut', range: '20–1000 / 2k–20k Hz', fill: 75 },
    ],
    iconPaths:
      '<rect x="1" y="13" width="5.4" height="10" rx="0.4"/><rect x="6.5" y="1" width="5.4" height="22" rx="0.4"/><rect x="11.9" y="4" width="5.4" height="19" rx="0.4"/><rect x="17.3" y="9" width="5.4" height="14" rx="0.4"/>',
  },
  {
    id: 'chorus',
    label: 'Chorus',
    category: 'Effects',
    colorVar: '--block-modulation',
    engine: 'packages/core C++20',
    summary:
      'Lush modulated delay chorus with selectable mono or wide stereo spread, depth control, and feedback shimmer.',
    params: [
      { label: 'Rate', range: '0.1 to 10 Hz', fill: 32 },
      { label: 'Depth / Delay', range: '0.2–10 ms / 5–30 ms', fill: 55 },
      { label: 'Feedback', range: '0 to 50%', fill: 30 },
      { label: 'Stereo Mode', range: 'Mono / Stereo', fill: 100 },
    ],
    iconPaths: '<path d="M1 13c2-6 4-2 5 0s3 13 7 0 8-16 10 10"/>',
  },
  {
    id: 'flanger',
    label: 'Flanger',
    category: 'Effects',
    colorVar: '--block-modulation',
    engine: 'packages/core C++20',
    summary:
      'Short-delay sweeping comb filter delivering classic tape jet sweeps and glassy harmonic texture.',
    params: [
      { label: 'Rate', range: '0.1 to 10 Hz', fill: 28 },
      { label: 'Depth', range: '0.1 to 5 ms', fill: 62 },
      { label: 'Feedback', range: '0 to 90%', fill: 68 },
      { label: 'Base Delay', range: '0.1 to 3 ms', fill: 40 },
    ],
    iconPaths: '<path d="M3 9h18M3 15h18"/><path d="M7 9v4h4M17 15v-4h-4"/>',
  },
  {
    id: 'phaser',
    label: 'Phaser',
    category: 'Effects',
    colorVar: '--block-modulation',
    engine: 'DSPark (MXR Phase 90 Voicing)',
    summary:
      'Fixed 4-stage all-pass triangle LFO sweeping 200 Hz–2.8 kHz with switchable vintage Script and modern Block feedback.',
    params: [
      { label: 'Speed', range: '0.1 to 8 Hz', fill: 44 },
      { label: 'Voice', range: 'Script / Block', fill: 100 },
    ],
    iconPaths: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="2" x2="12" y2="22"/>',
  },
  {
    id: 'tremolo',
    label: 'Tremolo',
    category: 'Effects',
    colorVar: '--block-modulation',
    engine: 'packages/core C++20',
    summary:
      'Amplitude and harmonic tremolo with 3 waveform shapes (sine, triangle, slewed square) and stereo autopan mode.',
    params: [
      { label: 'Rate', range: '0.1 to 20 Hz', fill: 42 },
      { label: 'Depth', range: '0 to 100%', fill: 75 },
      { label: 'Shape', range: 'Sine / Triangle / Square', fill: 50 },
      { label: 'Mode / Stereo', range: 'Classic / Harmonic', fill: 100 },
    ],
    iconPaths: '<path d="m1 12 2-5 2 10L8 7l2 10 3-10 2 10 3-10 2 10 3-10"/>',
  },
  {
    id: 'rotary',
    label: 'Rotary',
    category: 'Effects',
    colorVar: '--block-modulation',
    engine: 'packages/core C++20 (Leslie)',
    summary:
      'Rotating horn and bass drum speaker emulation with horn/drum crossover, brake/slow/fast speeds, mic distance, and tube drive.',
    params: [
      { label: 'Speed', range: 'Slow / Fast / Brake', fill: 66 },
      { label: 'Drive', range: '0 to 100%', fill: 45 },
      { label: 'Horn / Drum Level', range: '0 to 100% each', fill: 78 },
      { label: 'Mic Distance / Crossover', range: '0–100% / 400–1200 Hz', fill: 55 },
    ],
    iconPaths: '<circle cx="12" cy="10" r="4.5"/><path d="M12 14.5v4M8 18.5h8"/>',
  },
  {
    id: 'delay',
    label: 'Delay',
    category: 'Effects',
    colorVar: '--block-delay',
    engine: 'packages/core C++20',
    summary:
      'Digital, Analog, and Tape delay models with wow modulation, tone damping, and orthogonal Stereo or Ping-Pong width.',
    params: [
      { label: 'Time / Feedback', range: '10–1000 ms / 0–90%', fill: 52 },
      { label: 'Model', range: 'Digital / Analog / Tape', fill: 66 },
      { label: 'Tone / Wow', range: '200–12k Hz / 0–5 ms', fill: 48 },
      { label: 'Stereo / Ping-Pong', range: 'Width 0 to 100%', fill: 85 },
    ],
    iconPaths:
      '<circle cx="4" cy="12" r="3.6" fill="currentColor" stroke="none"/><circle cx="13.5" cy="12" r="2.8" fill="currentColor" stroke="none"/><circle cx="21" cy="12" r="2" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'reverb',
    label: 'Reverb',
    category: 'Effects',
    colorVar: '--block-reverb',
    engine: 'Clean-Room C++20 + Dual-Allpass Spring',
    summary:
      'Five selectable reverb engines — Hall, Room, Plate, Early Reflections, and Spring Tank — with full expert tone & damping parameters.',
    params: [
      { label: 'Algorithm', range: 'Hall · Room · Plate · ER · Spring', fill: 80 },
      { label: 'Decay', range: '0.1 to 10 s', fill: 48 },
      { label: 'Predelay / Size', range: '0–100 ms / 8–60 m', fill: 42 },
      { label: 'Width / Damping', range: '50–150% / 1k–16k Hz', fill: 74 },
    ],
    iconPaths:
      '<path fill="currentColor" stroke="none" d="M12,24L1,18.6V5.4L12,0l11,5.4v13.2L12,24z M13,11.6v9.7l8-3.9V7.6L13,11.6z M3,17.4l8,3.9v-9.7l-8-4V17.4z M4.2,6L12,9.9L19.8,6L12,2L4.2,6z"/>',
  },
  {
    id: 'mixer',
    label: 'Mixer',
    category: 'Routing',
    colorVar: '--block-utility',
    engine: 'packages/core GraphRig',
    summary:
      'Sums up to 4 parallel rows back into a single path with independent per-input level and stereo panning.',
    params: [
      { label: 'In 1–4 Level', range: '0 to 150%', fill: 67 },
      { label: 'In 1–4 Pan', range: 'Left (-1) to Right (+1)', fill: 50 },
    ],
    iconPaths:
      '<path d="M5 5v14m7-14v14m7-14v14"/><circle cx="5" cy="8" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="16" r="1.6" fill="currentColor" stroke="none"/>',
  },
  {
    id: 'send',
    label: 'Send 1–2',
    category: 'Routing',
    colorVar: '--block-utility',
    engine: 'packages/core GraphRig',
    summary:
      'Wireless relay pair (`Send 1` / `Send 2`) that hops signal across rows or columns cleanly without tangled cross-grid cables.',
    params: [
      { label: 'Buses', range: 'Relay 1 & Relay 2', fill: 100 },
      { label: 'Loop Safety', range: 'Real-time cycle validation', fill: 100 },
    ],
    iconPaths: '<path d="M7 7h10v10M7 17 17 7"/>',
  },
  {
    id: 'return',
    label: 'Return 1–2',
    category: 'Routing',
    colorVar: '--block-utility',
    engine: 'packages/core GraphRig',
    summary:
      'Receives the matching `Send 1` or `Send 2` bus anywhere on the 4×10 grid to feed parallel wet effects or dual amps.',
    params: [
      { label: 'Pairing', range: 'Strict 1:1 bus relay', fill: 100 },
      { label: 'Added Latency', range: '0 samples', fill: 100 },
    ],
    iconPaths: '<path d="M17 17H7V7M17 7 7 17"/>',
  },
]

const CHAIN_NODE_IDS = ['noise-gate', 'pedal', 'amp', 'cab', 'eq', 'chorus', 'delay', 'reverb']

function renderIconSvg(paths: string, size = 18): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

function renderInspectorHtml(block: BlockSpec): string {
  const paramRows = block.params
    .map(
      (p) => `
      <div class="lcd-param">
        <div class="lcd-param-head">
          <span class="lcd-param-name">${p.label}</span>
          <span class="lcd-param-range">${p.range}</span>
        </div>
        <div class="lcd-bar" aria-hidden="true">
          <span class="lcd-bar-fill" style="width:${p.fill}%"></span>
        </div>
      </div>`,
    )
    .join('')

  return `
    <div class="lcd-header">
      <div class="lcd-title-wrap">
        <span class="lcd-block-glyph" style="border-color:color-mix(in srgb, var(${block.colorVar}) 55%, var(--seam-strong))">
          ${renderIconSvg(block.iconPaths, 20)}
        </span>
        <div>
          <div class="lcd-kicker">${block.category} · ${block.engine}</div>
          <h3 class="lcd-title">${block.label}</h3>
        </div>
      </div>
      <span class="ox-badge ox-badge-live"><i class="dot dot-live" aria-hidden="true"></i> C++ CORE</span>
    </div>
    <p class="lcd-summary">${block.summary}</p>
    <div class="lcd-params-grid">
      ${paramRows}
    </div>
  `
}

/** Initializes the interactive Signal-Chain & Effects Rack Explorer. */
export function initSignalExplorer(): void {
  const stripEl = document.getElementById('signal-patch-strip')
  const paletteEl = document.getElementById('signal-palette-groups')
  const inspectorEl = document.getElementById('signal-lcd-inspector')
  if (!stripEl || !paletteEl || !inspectorEl) return

  const byId = new Map(BLOCK_CATALOG.map((b) => [b.id, b]))
  let selectedId = 'amp'

  const chainButtons = CHAIN_NODE_IDS.map((id, index) => {
    const block = byId.get(id)!
    const connector =
      index < CHAIN_NODE_IDS.length - 1
        ? '<span class="patch-cable" aria-hidden="true"></span>'
        : ''
    return `
      <button
        type="button"
        class="patch-node"
        data-block-id="${block.id}"
        aria-pressed="${block.id === selectedId}"
        style="--node-color: var(${block.colorVar})"
      >
        <span class="patch-node-led" aria-hidden="true"></span>
        <span class="patch-node-icon">${renderIconSvg(block.iconPaths, 18)}</span>
        <span class="patch-node-label">${block.label}</span>
      </button>${connector}`
  }).join('')

  stripEl.innerHTML = `
    <div class="patch-rail" aria-hidden="true">IN</div>
    <span class="patch-cable" aria-hidden="true"></span>
    ${chainButtons}
    <span class="patch-cable" aria-hidden="true"></span>
    <div class="patch-rail" aria-hidden="true">OUT</div>
  `

  const groups: Array<BlockSpec['category']> = ['NAM & Cab', 'Effects', 'Routing']
  paletteEl.innerHTML = groups
    .map((groupName) => {
      const items = BLOCK_CATALOG.filter((b) => b.category === groupName)
      return `
        <div class="palette-group">
          <div class="palette-group-title">${groupName} <span>(${items.length})</span></div>
          <div class="palette-chips">
            ${items
              .map(
                (block) => `
              <button
                type="button"
                class="palette-chip"
                data-block-id="${block.id}"
                aria-pressed="${block.id === selectedId}"
                style="--node-color: var(${block.colorVar})"
              >
                ${renderIconSvg(block.iconPaths, 14)}
                <span>${block.label}</span>
              </button>`,
              )
              .join('')}
          </div>
        </div>`
    })
    .join('')

  const rootEl = stripEl.closest('.explorer-shell') ?? document

  const selectBlock = (id: string) => {
    const block = byId.get(id)
    if (!block) return
    selectedId = id

    for (const btn of rootEl.querySelectorAll<HTMLButtonElement>('[data-block-id]')) {
      const active = btn.dataset.blockId === id
      btn.setAttribute('aria-pressed', String(active))
      btn.classList.toggle('is-selected', active)
    }

    inspectorEl.innerHTML = renderInspectorHtml(block)
  }

  rootEl.addEventListener('click', (event) => {
    const btn = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-block-id]')
    if (!btn?.dataset.blockId) return
    selectBlock(btn.dataset.blockId)
  })

  selectBlock(selectedId)
}
