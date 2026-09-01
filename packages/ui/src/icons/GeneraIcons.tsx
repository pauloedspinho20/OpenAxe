import { type IconProps } from './Icon'

export function MixerIcon(props: IconProps) {
  const { size = 24 } = props
  return (
    <svg
      stroke="currentColor"
      fill="none"
      strokeWidth={0}
      viewBox="0 0 15 15"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9.5 8C10.7108 8 11.72 8.8609 11.9502 10.0039C11.9666 10.0023 11.9831 10 12 10H13.5C13.7761 10 14 10.2239 14 10.5C14 10.7761 13.7761 11 13.5 11H12C11.9831 11 11.9667 10.9968 11.9502 10.9951C11.7204 12.1386 10.7112 13 9.5 13C8.28878 13 7.27856 12.1387 7.04883 10.9951C7.03268 10.9967 7.01656 11 7 11H1.5C1.22386 11 1 10.7761 1 10.5C1 10.2239 1.22386 10 1.5 10H7C7.01653 10 7.03271 10.0023 7.04883 10.0039C7.27892 8.8608 8.28911 8 9.5 8ZM9.5 9C8.67157 9 8 9.67157 8 10.5C8 11.3284 8.67157 12 9.5 12C10.3284 12 11 11.3284 11 10.5C11 9.67157 10.3284 9 9.5 9ZM5.5 2C6.71082 2 7.72003 2.8609 7.9502 4.00391C7.96662 4.00228 7.98314 4 8 4H13.5L13.6006 4.00977C13.8286 4.05629 14 4.25829 14 4.5C14 4.74171 13.8286 4.94371 13.6006 4.99023L13.5 5H8C7.98311 5 7.96665 4.99675 7.9502 4.99512C7.72039 6.13859 6.71115 7 5.5 7C4.28878 7 3.27856 6.13869 3.04883 4.99512C3.03268 4.99669 3.01656 5 3 5H1.5C1.22386 5 1 4.77614 1 4.5C1 4.22386 1.22386 4 1.5 4H3C3.01653 4 3.03271 4.00234 3.04883 4.00391C3.27892 2.8608 4.28911 2 5.5 2ZM5.5 3C4.67157 3 4 3.67157 4 4.5C4 5.32843 4.67157 6 5.5 6C6.32843 6 7 5.32843 7 4.5C7 3.67157 6.32843 3 5.5 3Z"
        fill="currentColor"
      ></path>
    </svg>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  const { size = 24 } = props
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth={0}
      viewBox="0 0 320 512"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M34.52 239.03L228.87 44.69c9.37-9.37 24.57-9.37 33.94 0l22.67 22.67c9.36 9.36 9.37 24.52.04 33.9L131.49 256l154.02 154.75c9.34 9.38 9.32 24.54-.04 33.9l-22.67 22.67c-9.37 9.37-24.57 9.37-33.94 0L34.52 272.97c-9.37-9.37-9.37-24.57 0-33.94z"></path>
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  const { size = 24 } = props
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth={0}
      viewBox="0 0 320 512"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M285.476 272.971L91.132 467.314c-9.373 9.373-24.569 9.373-33.941 0l-22.667-22.667c-9.357-9.357-9.375-24.522-.04-33.901L188.505 256 34.484 101.255c-9.335-9.379-9.317-24.544.04-33.901l22.667-22.667c9.373-9.373 24.569-9.373 33.941 0L285.475 239.03c9.373 9.372 9.373 24.568.001 33.941z"></path>
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  const { size = 24 } = props
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth={0}
      viewBox="0 0 512 512"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m289.94 256 95-95A24 24 0 0 0 351 127l-95 95-95-95a24 24 0 0 0-34 34l95 95-95 95a24 24 0 1 0 34 34l95-95 95 95a24 24 0 0 0 34-34z"></path>
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  const { size = 12 } = props
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      stroke-width="0"
      viewBox="0 0 448 512"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M424.4 214.7L72.4 6.6C43.8-10.3 0 6.1 0 47.9V464c0 37.5 40.7 60.1 72.4 41.3l352-208c31.4-18.5 31.5-64.1 0-82.6z"></path>
    </svg>
  )
}

export function PauseIcon(props: IconProps) {
  const { size = 12 } = props
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      stroke-width="0"
      viewBox="0 0 448 512"
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M144 479H48c-26.5 0-48-21.5-48-48V79c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48v352c0 26.5-21.5 48-48 48zm304-48V79c0-26.5-21.5-48-48-48h-96c-26.5 0-48 21.5-48 48v352c0 26.5 21.5 48 48 48h96c26.5 0 48-21.5 48-48z"></path>
    </svg>
  )
}
