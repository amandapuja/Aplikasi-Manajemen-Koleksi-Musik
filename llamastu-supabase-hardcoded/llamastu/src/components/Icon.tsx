import type { ReactNode } from "react"
import type { IconName } from "../types"

const iconPaths: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a3 3 0 0 1 3-3h13v17H7a3 3 0 0 0-3 3Z" />
      <path d="M4 5v17M8 7h8M8 11h6" />
    </>
  ),
  folder: (
    <>
      <path d="M3 6h7l2 2h9v11H3Z" />
      <path d="M3 6v13" />
    </>
  ),
  quiz: (
    <>
      <path d="M5 3h14v18H5Z" />
      <path d="M9 8a3 3 0 1 1 4 2.8V13M12 17h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="m8 14-2 8 6-3 6 3-2-8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 13.5v-3l-2-.7-.8-1.8.9-2-2.2-2.1-1.9.9-1.9-.8-.6-2h-3l-.7 2-1.8.8-2-.9-2.1 2.2.9 1.9-.8 1.9-2 .6v3l2 .7.8 1.8-.9 2 2.2 2.1 1.9-.9 1.9.8.6 2h3l.7-2 1.8-.8 2 .9 2.1-2.2-.9-1.9.8-1.9Z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3M7 8l5-5 5 5" />
      <path d="M4 15v6h16v-6" />
    </>
  ),
  spark: (
    <path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z" />
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  play: <path d="m9 6 9 6-9 6Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  moon: <path d="M20 15a8 8 0 0 1-11-11 8.5 8.5 0 1 0 11 11Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  file: (
    <>
      <path d="M6 2h8l4 4v16H6Z" />
      <path d="M14 2v5h5M9 12h6M9 16h6" />
    </>
  ),
  flame: (
    <path d="M13 22c5-1 7-4.5 6-9-1-3-3-5-6-8 0 3-1 5-3 7 0-2-1-3-2-4-2 3-4 6-3 9 1 3 4 5 8 5Z" />
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
    </>
  ),
  edit: (
    <>
      <path d="m4 16-1 5 5-1L19 9l-4-4Z" />
      <path d="m13 7 4 4" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m9 11 6-4M9 13l6 4" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  "chevron-left": <path d="m15 5-7 7 7 7" />,
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  download: (
    <>
      <path d="M12 3v13M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2" />
    </>
  ),
}

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths[name]}
    </svg>
  )
}

export default Icon
