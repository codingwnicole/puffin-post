// gifenc ships no types; only what TradingCard uses.
declare module 'gifenc' {
  type Palette = number[][]
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: Record<string, unknown>): Palette
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array
  export function GIFEncoder(): { writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number }): void; finish(): void; bytes(): Uint8Array<ArrayBuffer> }
  const gifenc: { GIFEncoder: typeof GIFEncoder; quantize: typeof quantize; applyPalette: typeof applyPalette }
  export default gifenc
}
