// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Tone3000Browser } from './Tone3000Browser'
import { useTone3000Browser } from '../../tone3000/browserStore'

vi.mock('../../tone3000/library', () => ({
  Tone3000Library: {
    refresh: vi.fn(),
    getBlob: vi.fn(),
    notifyLoaded: vi.fn(),
    remove: vi.fn(),
  },
  useTone3000Library: (sel: (s: { entries: unknown[] }) => unknown) => sel({ entries: [] }),
}))

vi.mock('../../tone3000/client', () => ({
  apiSearchTones: vi.fn().mockResolvedValue({
    data: [
      {
        id: 1,
        title: 'Test Tone',
        url: 'https://example.com/1',
        images: ['img.png'],
        downloads_count: 5,
        format: 'wav',
        gear: 'amp',
        user: { name: 'Creator' },
        description: '',
        license: '',
        sizes: [],
        makes: [],
        tags: [],
        favorites_count: 0,
        models_count: 0,
        created_at: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  }),
  apiListCreatedTones: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 }),
  apiListFavoritedTones: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 }),
  apiListMakes: vi.fn().mockResolvedValue({ data: [] }),
  apiListTags: vi.fn().mockResolvedValue({ data: [] }),
  apiListModels: vi.fn().mockResolvedValue([]),
  apiDownloadModel: vi.fn(),
  apiGetTone: vi.fn(),
  apiGetUser: vi.fn(),
  apiFetch: vi.fn(),
}))

import * as client from '../../tone3000/client'

function setTarget() {
  useTone3000Browser.setState({
    open: true,
    target: { blockId: 'b1', slot: 'model', gear: 'amp' },
  })
}

describe('components/Tone3000Browser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setTarget()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the four scope tabs', () => {
    render(<Tone3000Browser target={null} context={null} />)
    expect(screen.getByRole('button', { name: 'ALL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /LIBRARY/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'FAVORITES' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /MY MODELS/ })).toBeInTheDocument()
  })

  it('searches Tone3000 and shows the returned tone in the ALL scope', async () => {
    render(<Tone3000Browser target={null} context={null} />)
    expect(await screen.findByText('Test Tone')).toBeInTheDocument()
    expect(client.apiSearchTones).toHaveBeenCalled()
  })

  it('fetches favorited tones when the FAVORITES tab is selected', async () => {
    render(<Tone3000Browser target={null} context={null} />)
    await waitFor(() => expect(client.apiSearchTones).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'FAVORITES' }))
    await waitFor(() => expect(client.apiListFavoritedTones).toHaveBeenCalled())
  })
})
