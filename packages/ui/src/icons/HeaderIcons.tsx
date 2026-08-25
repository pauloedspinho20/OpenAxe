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
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-display)"
        fontSize="7"
        fontWeight="700"
        letterSpacing="0.6"
        fill="currentColor"
        stroke="none"
      >
        MIDI
      </text>
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

export function InputIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12H13M10 8l4 4-4 4" />
      <path d="M16 7v10" />
    </Icon>
  )
}

export function OutputIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 12H21M18 8l4 4-4 4" />
      <path d="M8 7v10" />
    </Icon>
  )
}
