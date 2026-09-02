// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-param-schema.mjs from packages/core/param_schema.json.
// Per-effect (and per-model-variant) maps of param symbol -> core param
// index, matching packages/core's GetParamInfo() order exactly. Import these
// instead of hardcoding index constants so a core param-table reorder can't
// silently desync a worklet (issue #51).

export const COMPRESSOR_PARAMS = Object.freeze({
  threshold: 0,
  ratio: 1,
  attack: 2,
  release: 3,
  knee: 4,
  makeup_gain: 5,
  character: 6,
  mix: 7,
})

export const NOISEGATE_PARAMS = Object.freeze({
  threshold: 0,
  hysteresis: 1,
  attack: 2,
  hold: 3,
  release: 4,
  range: 5,
})

export const EQ_PARAMS = Object.freeze({
  band0_frequency: 0,
  band0_gain: 1,
  band0_q: 2,
  band1_frequency: 3,
  band1_gain: 4,
  band1_q: 5,
  band2_frequency: 6,
  band2_gain: 7,
  band2_q: 8,
  band3_frequency: 9,
  band3_gain: 10,
  band3_q: 11,
})

export const CHORUS_PARAMS = Object.freeze({ rate: 0, depth: 1, delay: 2, feedback: 3 })

export const FLANGER_PARAMS = Object.freeze({ rate: 0, depth: 1, feedback: 2, delay: 3 })

export const PHASER_PARAMS = Object.freeze({ rate: 0, depth: 1, feedback: 2, stages: 3 })

export const TREMOLO_PARAMS = Object.freeze({ rate: 0, depth: 1, shape: 2, stereo: 3, mode: 4 })

export const RINGMOD_PARAMS = Object.freeze({ frequency: 0, drive: 1 })

export const FILTER_PARAMS = Object.freeze({
  type: 0,
  frequency: 1,
  q: 2,
  drive: 3,
  sensitivity: 4,
  mode: 5,
  lfo_rate: 6,
})

export const PITCHSHIFTER_PARAMS = Object.freeze({ mode: 0, pitch: 1, detune_cents: 2 })

export const GRANULARDELAY_PARAMS = Object.freeze({
  time: 0,
  grain_size: 1,
  density: 2,
  pitch: 3,
  jitter: 4,
  feedback: 5,
  spread: 6,
  character: 7,
  freeze: 8,
})

export const ROTARY_PARAMS = Object.freeze({
  speed: 0,
  drive: 1,
  horn_level: 2,
  drum_level: 3,
  mic_distance: 4,
  crossover: 5,
})

export const DELAY_PARAMS = Object.freeze({
  time: 0,
  feedback: 1,
  tone: 2,
  model: 3,
  wow_depth: 4,
  wow_rate: 5,
  stereo_mode: 6,
  width: 7,
})

export const AMP_PARAMS = Object.freeze({
  input_level: 0,
  output_level: 1,
  slim_size: 2,
  bass: 3,
  mid: 4,
  treble: 5,
  presence: 6,
})

export const REVERB_PARAMS = Object.freeze({
  hall: Object.freeze({
    dry_level: 0,
    early_level: 1,
    late_level: 2,
    size: 3,
    width: 4,
    delay: 5,
    diffuse: 6,
    low_cut: 7,
    low_xo: 8,
    low_mult: 9,
    high_cut: 10,
    high_xo: 11,
    high_mult: 12,
    spin: 13,
    wander: 14,
    decay: 15,
    early_send: 16,
    modulation: 17,
  }),
  room: Object.freeze({
    dry_level: 0,
    early_level: 1,
    early_send: 2,
    late_level: 3,
    size: 4,
    width: 5,
    predelay: 6,
    decay: 7,
    diffuse: 8,
    spin: 9,
    wander: 10,
    in_high_cut: 11,
    early_damp: 12,
    late_damp: 13,
    low_boost: 14,
    boost_freq: 15,
    in_low_cut: 16,
  }),
  plate: Object.freeze({
    dry_level: 0,
    early_level: 1,
    algorithm: 2,
    width: 3,
    predelay: 4,
    decay: 5,
    low_cut: 6,
    high_cut: 7,
    early_damp: 8,
  }),
  'early-reflections': Object.freeze({
    dry_level: 0,
    early_level: 1,
    program: 2,
    size: 3,
    width: 4,
    low_cut: 5,
    high_cut: 6,
  }),
  spring: Object.freeze({
    dry_level: 0,
    decay: 1,
    high_cut: 2,
    width: 3,
    predelay: 4,
    spin: 5,
    wander: 6,
    drive: 7,
  }),
})

export const CAB_PARAMS = Object.freeze({ ir_mix: 0 })

export const MIXER_PARAMS = Object.freeze({
  in0_level: 0,
  in0_pan: 1,
  in1_level: 2,
  in1_pan: 3,
  in2_level: 4,
  in2_pan: 5,
  in3_level: 6,
  in3_pan: 7,
})

export const SPLITTER_PARAMS = Object.freeze({
  out0_level: 0,
  out1_level: 1,
  out2_level: 2,
  out3_level: 3,
})
