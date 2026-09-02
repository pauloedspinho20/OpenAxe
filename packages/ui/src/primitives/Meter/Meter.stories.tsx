import type { Meta, StoryObj } from '@storybook/react'
import { MediumMeter, Meter } from './Meter'

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

export const Safe: Story = { args: { level: 0.5, label: 'CHAIN A' } }

export const Warning: Story = { args: { level: 0.85, label: 'CHAIN B' } }

export const Clipping: Story = { args: { level: 0.95, label: 'MASTER' } }

export const MediumLevel: StoryObj<typeof MediumMeter> = {
  render: (args) => <MediumMeter {...args} />,
  args: { level: 0.5 },
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
