export function isModerator(userId: string, configuredUserId?: string): boolean {
  return !!configuredUserId && userId === configuredUserId
}
