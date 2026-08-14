import type { Meta, StoryObj } from '@storybook/react'
import { SelectField, InputField } from './FormField'

const meta = {
  title: 'Shared/FormField',
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta

export default meta

export const Select: StoryObj = {
  render: () => (
    <div style={{ width: 280 }}>
      <SelectField label="DEVICE" defaultValue="default">
        <option value="default">Default input</option>
        <option value="mic">Built-in Microphone</option>
        <option value="interface">Audio Interface</option>
      </SelectField>
    </div>
  ),
}

export const Input: StoryObj = {
  render: () => (
    <div style={{ width: 280 }}>
      <InputField label="PRESET NAME" defaultValue="My Tone" />
    </div>
  ),
}
