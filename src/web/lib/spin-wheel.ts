/** Rotate forward five full turns, then put the selected segment's centre under the top pointer. */
export function spinLanding(rotation: number, index: number, count: number): number {
  if (count < 1 || index < 0 || index >= count) throw new RangeError('Invalid wheel selection')
  const settled = ((rotation % 360) + 360) % 360
  const target = 360 - (index + .5) * 360 / count
  return rotation + 5 * 360 + ((target - settled + 360) % 360)
}
