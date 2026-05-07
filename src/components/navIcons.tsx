import type { ComponentType, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function NavIconHome({ className, ...props }: IconProps) {
  return (
    <svg {...base} {...props} className={["nav-icon--nudge-1", className].filter(Boolean).join(" ")}>
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function NavIconBoard({ className, ...props }: IconProps) {
  return (
    <svg {...base} {...props} className={["nav-icon--nudge-1", className].filter(Boolean).join(" ")}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <circle cx="12" cy="12" r="2.25" />
    </svg>
  );
}

/** 汇总 / 全部资产 */
export function NavIconLayers({ className, ...props }: IconProps) {
  return (
    <svg {...base} {...props} className={["nav-icon--nudge-1", className].filter(Boolean).join(" ")}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

export function NavIconPrompt({ className, ...props }: IconProps) {
  return (
    <svg {...base} {...props} className={["nav-icon--nudge-1", className].filter(Boolean).join(" ")}>
      <path d="M4 5h16v12H7l-3 3V5z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

export function NavIconBot(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

export function NavIconCursor({ className, ...props }: IconProps) {
  return (
    <svg {...base} {...props} className={className}>
      <path d="m4 4 7.07 17 2.51-7.39L21 11.07z" />
    </svg>
  );
}

export function NavIconChat(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function NavIconWorkflow(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect width="8" height="8" x="3" y="3" rx="2" />
      <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      <rect width="8" height="8" x="13" y="13" rx="2" />
    </svg>
  );
}

export function NavIconBrackets(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16 18 22 12 16 6" />
      <path d="m8 6-6 6 6 6" />
    </svg>
  );
}

export function NavIconZap(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

export function NavIconFolder(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export function NavIconFolderPlus(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 10v6" />
      <path d="M9 13h6" />
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export function NavIconSettings(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const AGENT_ICONS: Record<string, ComponentType<IconProps>> = {
  cursor: NavIconCursor,
  claude: NavIconChat,
  trae: NavIconWorkflow,
  qoder: NavIconBrackets,
  kiro: NavIconZap,
};

export function NavIconForAgent(agentId: string, props?: IconProps) {
  const Ic = AGENT_ICONS[agentId] ?? NavIconBot;
  return <Ic {...props} />;
}
