// Symbols a writer can put beside their character's name on the trading card (also used for the fun-fact
// bullets and the card footer). Glyphs, not drawings: they stay crisp in PNG/GIF downloads. U+FE0E asks for
// the plain text glyph, never the emoji version.
export const CARD_SYMBOLS = {
  none: { label: 'None', glyph: '' },
  moon: { label: 'Moon', glyph: '☾' },
  sun: { label: 'Sun', glyph: '☼' },
  star: { label: 'Star', glyph: '★' },
  crown: { label: 'Crown', glyph: '♛' },
  swords: { label: 'Swords', glyph: '⚔︎' },
  anchor: { label: 'Anchor', glyph: '⚓︎' },
  skull: { label: 'Skull', glyph: '☠︎' },
  fleur: { label: 'Fleur-de-lis', glyph: '⚜︎' },
  heart: { label: 'Heart', glyph: '♥︎' },
  spade: { label: 'Spade', glyph: '♠︎' },
  flower: { label: 'Flower', glyph: '❀' },
  floral: { label: 'Floral heart', glyph: '❦' },
  quill: { label: 'Quill', glyph: '✒︎' },
  snow: { label: 'Snowflake', glyph: '❄︎' },
  note: { label: 'Music note', glyph: '♪' },
  cross: { label: 'Cross', glyph: '✠' },
  diamond: { label: 'Diamond', glyph: '◆' },
} as const
export type CardSymbol = keyof typeof CARD_SYMBOLS
export const CARD_SYMBOL_KEYS = Object.keys(CARD_SYMBOLS) as [CardSymbol, ...CardSymbol[]]
export const SYMBOL_FONT = "'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols 2','Noto Sans Symbols',serif"
