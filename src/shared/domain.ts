export const REPLY_STATUSES = ['your_turn', 'their_turn', 'queued', 'archived'] as const

export type ReplyStatus = (typeof REPLY_STATUSES)[number]
