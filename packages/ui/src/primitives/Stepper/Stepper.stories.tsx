import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Stepper } from './Stepper'

const meta = {
  title: 'Primitives/Stepper',
  component: Stepper,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Stepper>

export default meta
type Story = StoryObj<typeof meta>

function SpeedStepperExample() {
  const [pct, setPct] = useState(100)
  return (
    <Stepper
      label="Speed"
      value={`${pct}%`}
      decrementLabel="Slower (−5%)"
      incrementLabel="Faster (+5%)"
      resetLabel={`Speed ${pct}%, reset to 100%`}
      onDecrement={() => setPct((v) => Math.max(25, v - 5))}
      onIncrement={() => setPct((v) => Math.min(200, v + 5))}
      onReset={() => setPct(100)}
    />
  )
}

export const Speed: Story = {
  args: {
    label: 'Speed',
    value: '100%',
    onDecrement: () => {},
    onIncrement: () => {},
    decrementLabel: 'Slower',
    incrementLabel: 'Faster',
  },
  render: () => <SpeedStepperExample />,
}
