import type { Meta, StoryObj } from '@storybook/react'
import { Hint, ErrorText } from './StatusText'

const meta = {
  title: 'Shared/StatusText',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta

export default meta

export const HintText: StoryObj = {
  render: () => <Hint>Optional — browsing works without authentication.</Hint>,
}

export const ErrorMessage: StoryObj = {
  render: () => <ErrorText>Could not connect to Tone3000.</ErrorText>,
}

export const BothMessages: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Hint>This is a hint message for context.</Hint>
      <ErrorText>This is an error that needs attention.</ErrorText>
    </div>
  ),
}
