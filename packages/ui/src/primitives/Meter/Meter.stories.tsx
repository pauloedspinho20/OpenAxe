import type { Meta, StoryObj } from '@storybook/react'
import { MediumMeter, Meter, MiniMeter } from './Meter'

const meta = {
  title: 'Primitives/Meter',
  component: Meter,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    level: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
} satisfies Meta<typeof Meter>

export default meta
type Story = StoryObj<typeof meta>

export const Silence: Story = { args: { level: 0, label: 'MASTER' } }

export const Safe: Story = { args: { level: 0.5, label: 'CHAIN A', valueLabel: '−6.0 dB' } }

export const Warning: Story = { args: { level: 0.85, label: 'CHAIN B', valueLabel: '−2.0 dB' } }

export const Clipping: Story = { args: { level: 0.95, label: 'MASTER', valueLabel: '0.0 dB' } }

export const MediumLevel: StoryObj<typeof MediumMeter> = {
  render: (args) => <MediumMeter {...args} />,
  args: { level: 0.5 },
}

export const MediumGradient: StoryObj<typeof MediumMeter> = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
      <MediumMeter level={0.3} />
      <MediumMeter level={0.6} />
      <MediumMeter level={0.8} />
      <MediumMeter level={1} />
    </div>
  ),
}

export const MediumPeak: StoryObj<typeof MediumMeter> = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
      <MediumMeter level={0.8} valueLabel="−2.0 dB" />
    </div>
  ),
  parameters: {
    docs: { description: { story: 'Medium level meter with the rolling peak-dB readout above.' } },
  },
}

export const MiniGradient: StoryObj<typeof MiniMeter> = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <MiniMeter level={0.3} />
      <MiniMeter level={0.6} />
      <MiniMeter level={0.8} />
      <MiniMeter level={1} />
    </div>
  ),
}

export const MediumGainReduction: StoryObj<typeof MediumMeter> = {
  render: (args) => <MediumMeter {...args} />,
  args: { level: 0.5, variant: 'gainReduction' },
  parameters: {
    docs: { description: { story: 'Gain-reduction variant — always red, for compressor GR.' } },
  },
}

export const GainReductionRange: StoryObj<typeof MediumMeter> = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
      <MediumMeter level={0} variant="gainReduction" title="0 dB GR" />
      <MediumMeter level={0.25} variant="gainReduction" title="−5 dB GR" />
      <MediumMeter level={0.5} variant="gainReduction" title="−10 dB GR" />
      <MediumMeter level={0.75} variant="gainReduction" title="−15 dB GR" />
      <MediumMeter level={1} variant="gainReduction" title="−20 dB GR" />
    </div>
  ),
}
