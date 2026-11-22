import { mediaCenterAvailable } from './media/useMediaTransport'

export type AppViewId = 'rig' | 'learn'

export interface AppViewDescriptor {
  readonly id: AppViewId
  readonly label: string
  readonly title: string
  readonly fullWidth: boolean
  readonly available: () => boolean
}

export const APP_VIEWS: readonly AppViewDescriptor[] = [
  {
    id: 'rig',
    label: 'RIG',
    title: 'Signal rig and scenes',
    fullWidth: false,
    available: () => true,
  },
  {
    id: 'learn',
    label: 'LEARN',
    title: 'Media Center — backing tracks and tabs',
    fullWidth: true,
    available: mediaCenterAvailable,
  },
]
