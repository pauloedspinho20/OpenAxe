import type { Meta, StoryObj } from '@storybook/react'
import { Toggle } from './Toggle'

const meta = {
  title: 'Primitives/Toggle',
  component: Toggle,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { onChange: () => {} },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Off: Story = { args: { checked: false, label: 'BYPASS' } }
export const On: Story = { args: { checked: true, label: 'LINK' } }
