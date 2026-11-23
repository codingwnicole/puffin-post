// Icons an admin can pick for a roadmap item; keep in sync with ROADMAP_ICONS in src/routes/roadmap.ts.
export const ROADMAP_ICONS = ['sparkle', 'chat', 'bot', 'palette', 'cards', 'megaphone', 'star'] as const
export type RoadmapIcon = (typeof ROADMAP_ICONS)[number]
type IconName = 'inbox' | 'parking' | 'characters' | 'planner' | 'connections' | 'settings' | 'tools' | 'activity' | 'more' | 'search' | RoadmapIcon

const paths: Record<IconName, string> = {
  inbox: 'M3 5h18v14H3zM3 9h18M8 13h8', parking: 'M4 5h16v14H4zM8 2v6M16 2v6M8 14h5',
  characters: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M16 11h6',
  planner: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5M17 16l1.5 1.5L21 14',
  connections: 'M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.2-1.2',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.2-2.2.1-.1A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.5-1H5v-3.2h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.2-2.2.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3.2v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1.1 2.2 2.2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z',
  tools: 'M4 5h16M4 12h16M4 19h16M7 3v4M16 10v4M11 17v4',
  activity: 'M4 12h3l2-6 4 12 2-6h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7Z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12ZM8.5 12h.01M12 12h.01M15.5 12h.01',
  bot: 'M5 9h14v10H5zM12 5v4M12 3h.01M9 13h.01M15 13h.01M9.5 16h5M3 13v2M21 13v2',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.9l-.3-.9a1.6 1.6 0 0 1 1.5-2.2H17a4 4 0 0 0 4-4c0-5-4-9-9-9ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01',
  cards: 'M9 3h11v15H9zM6 6v15h11',
  megaphone: 'M3 10v4h3l8 4V6l-8 4H3ZM18 9a4 4 0 0 1 0 6M7 14l1.5 6H11l-1.2-5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z',
}

export default function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
