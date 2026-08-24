import type { BlockKind } from '../../engine/blocks/Block'

type BlockGroup =
  | 'blockTone'
  | 'blockDrive'
  | 'blockDynamics'
  | 'blockFilter'
  | 'blockMod'
  | 'blockTime'
  | 'blockSpace'
  | 'blockUtility'

const KIND_TO_GROUP: Record<BlockKind, BlockGroup> = {
  amp: 'blockTone',
  'amp-cab': 'blockTone',
  cab: 'blockTone',
  pedal: 'blockDrive',
  outboard: 'blockDrive',
  space: 'blockSpace',
  mixer: 'blockUtility',
  splitter: 'blockUtility',
  'noise-gate': 'blockDynamics',
  compressor: 'blockDynamics',
  eq: 'blockFilter',
  chorus: 'blockMod',
  flanger: 'blockMod',
  phaser: 'blockMod',
  tremolo: 'blockMod',
  delay: 'blockTime',
  'ping-pong-delay': 'blockTime',
  reverb: 'blockSpace',
  'ring-mod': 'blockMod',
  filter: 'blockFilter',
  'pitch-shifter': 'blockUtility',
  'granular-delay': 'blockTime',
  rotary: 'blockMod',
}

const GROUP_TO_CSS_VAR: Record<BlockGroup, string> = {
  blockTone: '--block-tone',
  blockDrive: '--block-drive',
  blockDynamics: '--block-dynamics',
  blockFilter: '--block-filter',
  blockMod: '--block-mod',
  blockTime: '--block-time',
  blockSpace: '--block-space',
  blockUtility: '--block-utility',
}

export function blockColorVar(kind: BlockKind): string {
  const group = KIND_TO_GROUP[kind]
  return `var(${GROUP_TO_CSS_VAR[group]})`
}

export function blockGroupForKind(kind: BlockKind): BlockGroup {
  return KIND_TO_GROUP[kind]
}
