import type { Meta, StoryObj } from '@storybook/react'
import { BlockIcon, MidiIcon, PowerIcon, SettingsIcon, TunerIcon } from './index'
import type { BlockKind } from './BlockIcons'

const blockKinds: BlockKind[] = [
  'amp',
  'amp-cab',
  'cab',
  'pedal',
  'outboard',
  'space',
  'mixer',
  'splitter',
  'noise-gate',
  'compressor',
  'eq',
  'chorus',
  'flanger',
  'phaser',
  'tremolo',
  'delay',
  'ping-pong-delay',
  'reverb',
  'ring-mod',
  'filter',
  'pitch-shifter',
  'granular-delay',
  'rotary',
]

const meta = {
  title: 'Icons/Library',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta

export default meta

export const Header: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', color: 'var(--ink-1)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <SettingsIcon size={24} />
        <small>Settings</small>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <MidiIcon size={24} />
        <small>MIDI</small>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <PowerIcon size={24} />
        <small>Power</small>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <TunerIcon size={24} />
        <small>Tuner</small>
      </span>
    </div>
  ),
}

export const Blocks: StoryObj = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
        gap: 16,
        color: 'var(--ink-1)',
      }}
    >
      {blockKinds.map((k) => (
        <span
          key={k}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontFamily: 'var(--font-display)',
          }}
        >
          <BlockIcon kind={k} size={24} />
          {k}
        </span>
      ))}
    </div>
  ),
}

export const Sizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', color: 'var(--ink-1)' }}>
      <BlockIcon kind="amp" size={12} />
      <BlockIcon kind="amp" size={18} />
      <BlockIcon kind="amp" size={24} />
      <BlockIcon kind="delay" size={12} />
      <BlockIcon kind="delay" size={18} />
      <BlockIcon kind="delay" size={24} />
    </div>
  ),
}
