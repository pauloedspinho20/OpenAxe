import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectField } from '../FormField/FormField'
import { Select } from './Select'

describe('Select', () => {
  it('renders standalone and labeled comboboxes with a single chevron SVG', () => {
    const { rerender } = render(
      <Select aria-label="Step size" value="0.05" onChange={() => {}}>
        <option value={0.02}>2%</option>
        <option value={0.05}>5%</option>
        <option value={0.1}>10%</option>
      </Select>,
    )

    const combo = screen.getByRole('combobox', { name: 'Step size' })
    expect(combo).toHaveTextContent('5%')
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo.querySelectorAll('svg')).toHaveLength(1)

    rerender(
      <Select label="Latency" value="balanced" onChange={() => {}}>
        <option value="interactive">Low latency</option>
        <option value="balanced">Balanced</option>
      </Select>,
    )

    const labeledCombo = screen.getByLabelText('Latency')
    expect(labeledCombo).toHaveAttribute('role', 'combobox')
    expect(labeledCombo).toHaveTextContent('Balanced')
    expect(labeledCombo.querySelectorAll('svg')).toHaveLength(1)
  })

  it('opens listbox with optgroups and updates selection via synthetic change event', () => {
    const onChange = vi.fn()
    render(
      <Select label="DI Sample" value="clean" onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Guitar">
          <option value="clean">Clean Riff</option>
          <option value="metal">Metal Palm Mute</option>
        </optgroup>
        <optgroup label="Bass">
          <option value="jazz-bass">Jazz Finger</option>
        </optgroup>
      </Select>,
    )

    const combo = screen.getByLabelText('DI Sample')
    fireEvent.click(combo)
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('Guitar')).toBeInTheDocument()
    expect(screen.getByText('Bass')).toBeInTheDocument()

    const opt = screen.getByRole('option', { name: 'Jazz Finger' })
    fireEvent.mouseDown(opt)
    fireEvent.click(opt)

    expect(onChange).toHaveBeenCalledWith('jazz-bass')
    expect(combo).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps listbox closed when selecting an option inside a wrapping <label>', () => {
    const onChange = vi.fn()
    render(
      <label>
        <span>Instrument</span>
        <Select value="24" onChange={(e) => onChange(e.target.value)}>
          <option value={24}>Nylon guitar</option>
          <option value={30}>Distortion guitar</option>
        </Select>
      </label>,
    )

    const combo = screen.getByRole('combobox', { name: /Instrument/ })
    fireEvent.click(combo)
    expect(combo).toHaveAttribute('aria-expanded', 'true')

    const option = screen.getByRole('option', { name: 'Distortion guitar' })
    fireEvent.mouseDown(option)
    fireEvent.click(option)

    expect(onChange).toHaveBeenCalledWith('30')
    expect(combo).toHaveAttribute('aria-expanded', 'false')
  })

  it('supports keyboard navigation, skipping disabled options, typeahead, and Escape', () => {
    const onChange = vi.fn()
    const windowEscape = vi.fn()
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') windowEscape(e)
    }
    window.addEventListener('keydown', onWindowKeyDown)

    render(
      <Select aria-label="Preset" defaultValue="alpha" onChange={(e) => onChange(e.target.value)}>
        <option value="alpha">Alpha</option>
        <option value="beta" disabled>
          Beta
        </option>
        <option value="gamma">Gamma</option>
        <option value="delta">Delta</option>
      </Select>,
    )

    const combo = screen.getByRole('combobox', { name: 'Preset' })
    combo.focus()

    // Open with ArrowDown -> starts at selected ("alpha")
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(combo).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Alpha' }).id,
    )

    // ArrowDown skips disabled "Beta" and moves to "Gamma"
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    expect(combo).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Gamma' }).id,
    )

    // End moves to "Delta"
    fireEvent.keyDown(combo, { key: 'End' })
    expect(combo).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Delta' }).id,
    )

    // Home returns to "Alpha"
    fireEvent.keyDown(combo, { key: 'Home' })
    expect(combo).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Alpha' }).id,
    )

    // Typeahead "g" highlights "Gamma"
    fireEvent.keyDown(combo, { key: 'g' })
    expect(combo).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Gamma' }).id,
    )

    // Enter selects highlighted "Gamma"
    fireEvent.keyDown(combo, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('gamma')
    expect(combo).toHaveTextContent('Gamma')
    expect(combo).toHaveAttribute('aria-expanded', 'false')

    // Escape closes listbox without bubbling to parent window handlers
    fireEvent.keyDown(combo, { key: ' ' })
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(combo, { key: 'Escape' })
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(windowEscape).not.toHaveBeenCalled()

    window.removeEventListener('keydown', onWindowKeyDown)
  })

  it('delegates SelectField to the unified custom Select', () => {
    render(
      <SelectField label="Device" defaultValue="default">
        <option value="default">Default input</option>
        <option value="mic">Built-in Mic</option>
      </SelectField>,
    )

    const combo = screen.getByLabelText('Device')
    expect(combo).toHaveAttribute('role', 'combobox')
    expect(combo).toHaveTextContent('Default input')
  })
})
