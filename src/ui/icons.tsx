// Simple 24 px stroke icons (currentColor).
import type { JSX } from 'preact';

type P = { size?: number; class?: string };

function Svg({ size = 22, children, class: cls }: P & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconBack = (p: P) => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>;
export const IconChevronLeft = (p: P) => <Svg {...p}><path d="M14 6l-6 6 6 6" /></Svg>;
export const IconChevronRight = (p: P) => <Svg {...p}><path d="M10 6l6 6-6 6" /></Svg>;
export const IconUndo = (p: P) => <Svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Svg>;
export const IconRedo = (p: P) => <Svg {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Svg>;
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </Svg>
);
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconDelete = (p: P) => (
  <Svg {...p}>
    <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
    <path d="M17 9.5l-5 5M12 9.5l5 5" />
  </Svg>
);
export const IconSwitch = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h13l-3-3M17 8l-3 3" />
    <path d="M8 13v8l-3-3M8 21l3-3" />
  </Svg>
);
export const IconSelect = (p: P) => (
  <Svg {...p}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </Svg>
);
export const IconFill = (p: P) => <Svg {...p}><path d="M5 6h14M5 12h14M5 18h9" /></Svg>;
export const IconAutofill = (p: P) => (
  <Svg {...p}>
    <path d="M4 20L15 9" />
    <path d="M15 9l2-2 2 2-2 2z" />
    <path d="M18 3v2M21 6h-2M9 4v2M10 5H8M20 13v2M21 14h-2" />
  </Svg>
);
export const IconCheck = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.4 2.4 4.6-4.9" /></Svg>;
export const IconClue = (p: P) => (
  <Svg {...p}>
    <path d="M5 19l1-4L16 5l3 3L9 18z" />
    <path d="M14 7l3 3" />
  </Svg>
);
export const IconBlock = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconRebus = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
    <path d="M7 15l2-6 2 6M7.6 13.2h2.8M14 9h2a1.5 1.5 0 0 1 0 3h-2v-3zm0 3h2.4a1.5 1.5 0 0 1 0 3H14z" stroke-width="1.6" />
  </Svg>
);
export const IconCircle = (p: P) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="1.5" /><circle cx="12" cy="12" r="5" /></Svg>;
export const IconLock = (p: P) => <Svg {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></Svg>;
export const IconGrid = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" stroke-width="1.5" />
  </Svg>
);
export const IconNotebook = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6z" />
    <path d="M6 3.5v17M9.5 8h5.5M9.5 11.5h5.5" />
  </Svg>
);
export const IconClues = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5h7a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4zM20 5.5h-5a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h5z" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
  </Svg>
);
export const IconCloud = (p: P) => <Svg {...p}><path d="M7 18.5h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 9.6 4.5 4.5 0 0 0 7 18.5z" /></Svg>;
