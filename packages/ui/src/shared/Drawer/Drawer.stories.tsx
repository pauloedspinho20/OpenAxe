import type { Meta, StoryObj } from '@storybook/react'
import { Drawer } from './Drawer'

const meta = {
  title: 'Shared/Drawer',
  component: Drawer,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

export const RightOverlay: Story = {
  args: {
    open: true,
    side: 'right',
    title: 'Inspector',
    onClose: () => {},
    children: <p>Drawer content</p>,
  },
}
