import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { LearnIcon, RigIcon } from '../../icons'
import { ButtonGroup } from './ButtonGroup'

const meta = {
  title: 'Primitives/ButtonGroup',
  component: ButtonGroup,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof ButtonGroup>

export default meta
type Story = StoryObj<typeof meta>

function NavExample() {
  const [view, setView] = useState<'rig' | 'learn'>('rig')
  return (
    <ButtonGroup
      mode="nav"
      label="Views"
      size="medium"
      value={view}
      onChange={setView}
      items={[
        { value: 'rig', label: 'RIG', icon: <RigIcon size={15} /> },
        { value: 'learn', label: 'LEARN', icon: <LearnIcon size={15} /> },
      ]}
    />
  )
}

function RadioGroupExample() {
  const [input, setInput] = useState<'off' | 'midi' | 'guitar'>('off')
  return (
    <ButtonGroup
      mode="radiogroup"
      label="Play to enter notes"
      value={input}
      onChange={setInput}
      items={[
        { value: 'off', label: 'Tap' },
        { value: 'midi', label: 'MIDI' },
        { value: 'guitar', label: 'Guitar' },
      ]}
    />
  )
}

function TabListExample() {
  const [tab, setTab] = useState<'tracks' | 'practice' | 'sync' | 'tone'>('tracks')
  return (
    <ButtonGroup
      mode="tablist"
      label="Inspector sections"
      stretch
      value={tab}
      onChange={setTab}
      items={[
        { value: 'tracks', label: 'Tracks', badge: 2 },
        { value: 'practice', label: 'Practice' },
        { value: 'sync', label: 'Sync' },
        { value: 'tone', label: 'Tone' },
      ]}
    />
  )
}

export const Nav: Story = {
  args: { label: 'Views' },
  render: () => <NavExample />,
}

export const RadioGroup: Story = {
  args: { label: 'Play to enter notes' },
  render: () => <RadioGroupExample />,
}

export const TabList: Story = {
  args: { label: 'Inspector sections' },
  render: () => <TabListExample />,
}
