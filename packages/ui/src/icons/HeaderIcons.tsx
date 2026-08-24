import { Icon, type IconProps } from './Icon'

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 7.5v1.2M12 15.3v1.2M7.5 12h1.2M15.3 12h1.2M8.6 8.6l0.9 0.9M14.5 14.5l0.9 0.9M15.4 8.6l-0.9 0.9M9.5 14.5l-0.9 0.9" />
    </Icon>
  )
}

export function MidiIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7" width="18" height="10" rx="1.2" />
      <path d="M8 7V5M12 7V5M16 7V5" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function PowerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 7v6" />
      <path d="M8.2 9.2a7 7 0 1 0 7.6 0" />
    </Icon>
  )
}
