import { DurableObject } from 'cloudflare:workers'
import { z } from 'zod'
import { hashRoomToken, verifyRoomPassword } from './room-security'
import type { Env } from '../worker'

type RoomStatus = 'waiting' | 'running' | 'paused' | 'finished'
interface RoomParticipant {
  id: string
  name: string
  tokenHash: string
  joinedAt: number
  connected: boolean
  removed: boolean
  wordsCredited: number
  repliesCompleted: number
}
interface RoomRoundResult {
  number: number
  startedAt: number | null
  endedAt: number
  durationSeconds: number
  participants: Array<{ id: string; name: string; wordsCredited: number; repliesCompleted: number }>
}
interface RoomData {
  roomId: string
  appOrigin: string
  name: string
  inviteTokenHash: string
  passwordHash: string | null
  hostId: string
  participants: RoomParticipant[]
  participantLimit: number
  durationSeconds: number
  goalWords: number | null
  status: RoomStatus
  roundNumber: number
  rounds: RoomRoundResult[]
  roundStartedAt: number | null
  runStartedAt: number | null
  activeElapsedMs: number
  deadlineAt: number | null
  remainingMs: number
  expiresAt: number
  hostDisconnectedAt: number | null
}

const joinSchema = z.object({
  inviteToken: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  participantToken: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
  password: z.string().max(128).optional(),
}).strict().refine(value => Boolean(value.inviteToken || value.participantToken))

const progressSchema = z.object({
  type: z.literal('progress'),
  wordsCredited: z.number().int().min(0).max(1_000_000),
  repliesCompleted: z.number().int().min(0).max(100_000),
}).strict()

const actionSchema = z.discriminatedUnion('action', [
  z.object({ type: z.literal('action'), action: z.enum(['start', 'pause', 'resume', 'end', 'next-round']) }).strict(),
  z.object({ type: z.literal('action'), action: z.literal('remove-participant'), participantId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('action'), action: z.literal('configure'), durationSeconds: z.number().int().min(60).max(21_600), goalWords: z.number().int().min(1).max(1_000_000).nullable() }).strict(),
])

const ROOM_LIFETIME_MS = 24 * 60 * 60_000
const HOST_TRANSFER_GRACE_MS = 30_000
const AUTH_GRACE_MS = 10_000
const encoder = new TextEncoder()

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 32)
}

function snapshot(room: RoomData) {
  return {
    roomId: room.roomId,
    name: room.name,
    hostId: room.hostId,
    durationSeconds: room.durationSeconds,
    goalWords: room.goalWords,
    participantLimit: room.participantLimit,
    status: room.status,
    roundNumber: room.roundNumber,
    roundStartedAt: room.roundStartedAt,
    deadlineAt: room.deadlineAt,
    remainingMs: room.remainingMs,
    expiresAt: room.expiresAt,
    participants: room.participants.filter(person => !person.removed).map(({ id, name, connected, wordsCredited, repliesCompleted }) => ({
      id, name, connected, wordsCredited, repliesCompleted, isHost: id === room.hostId,
    })),
    rounds: room.rounds,
  }
}

function attachment(socket: WebSocket): { participantId?: string; authenticated?: boolean; lastProgressAt?: number; openedAt?: number } {
  try { return socket.deserializeAttachment() ?? {} } catch { return {} }
}

export class SprintRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env) }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/initialize' && request.method === 'POST') return this.initialize(request)
    if (url.pathname === '/join' && request.method === 'POST') return this.join(request)
    if (url.pathname === '/socket' && request.method === 'GET') return this.openSocket(request)
    return json({ error: 'Not found' }, 404)
  }

  private async initialize(request: Request): Promise<Response> {
    const input = await request.json() as {
      roomId: string; appOrigin: string; name: string; inviteTokenHash: string; hostTokenHash: string; hostId: string
      hostName: string; durationSeconds: number; goalWords: number | null; participantLimit: number; passwordHash: string | null
    }
    const now = Date.now()
    const room: RoomData = {
      roomId: input.roomId, appOrigin: input.appOrigin, name: input.name, inviteTokenHash: input.inviteTokenHash,
      passwordHash: input.passwordHash, hostId: input.hostId,
      participants: [{ id: input.hostId, name: input.hostName, tokenHash: input.hostTokenHash,
        joinedAt: now, connected: false, removed: false, wordsCredited: 0, repliesCompleted: 0 }],
      participantLimit: input.participantLimit, durationSeconds: input.durationSeconds,
      goalWords: input.goalWords, status: 'waiting', roundNumber: 1, rounds: [],
      roundStartedAt: null, deadlineAt: null, remainingMs: input.durationSeconds * 1000,
      runStartedAt: null, activeElapsedMs: 0,
      expiresAt: now + ROOM_LIFETIME_MS, hostDisconnectedAt: null,
    }
    const created = await this.ctx.storage.transaction(async tx => {
      if (await tx.get<RoomData>('room')) return false
      await tx.put('room', room)
      return true
    })
    if (!created) return json({ error: 'Room is unavailable' }, 409)
    await this.schedule(room)
    return json({ state: snapshot(room) }, 201)
  }

  private async join(request: Request): Promise<Response> {
    const parsed = joinSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return json({ error: 'This room link is invalid or no longer available.' }, 400)
    const input = parsed.data
    const participantId = crypto.randomUUID()
    const participantToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
    const participantHash = await hashRoomToken(participantToken)
    const now = Date.now()
    const result = await this.ctx.storage.transaction(async tx => {
      const room = await tx.get<RoomData>('room')
      if (!room || room.expiresAt <= now) return { error: 'This room link is invalid or no longer available.', status: 404 as const }

      if (input.participantToken) {
        const tokenHash = await hashRoomToken(input.participantToken)
        const participant = room.participants.find(person => person.tokenHash === tokenHash && !person.removed)
        if (!participant) return { error: 'This room link is invalid or no longer available.', status: 403 as const }
        return { state: snapshot(room), participantToken: input.participantToken, participantId: participant.id }
      }

      if (!input.inviteToken || await hashRoomToken(input.inviteToken) !== room.inviteTokenHash) {
        return { error: 'This room link is invalid or no longer available.', status: 403 as const }
      }
      if (room.passwordHash && (!input.password || !await verifyRoomPassword(input.password, room.passwordHash))) {
        return { error: 'This room link is invalid or no longer available.', status: 403 as const }
      }
      if (room.participants.filter(person => !person.removed).length >= room.participantLimit) {
        return { error: 'This room is full.' , status: 409 as const }
      }
      const name = cleanName(input.displayName ?? '')
      if (!name) return { error: 'Choose a display name to join.' , status: 400 as const }
      room.participants.push({ id: participantId, name, tokenHash: participantHash, joinedAt: now,
        connected: false, removed: false, wordsCredited: 0, repliesCompleted: 0 })
      const host = room.participants.find(person => person.id === room.hostId)
      if (!host?.connected && room.hostDisconnectedAt === null) room.hostDisconnectedAt = now
      await tx.put('room', room)
      return { state: snapshot(room), participantToken, participantId }
    })
    if ('error' in result) return json({ error: result.error }, result.status)
    await this.reschedule()
    return json(result, 200)
  }

  private async openSocket(request: Request): Promise<Response> {
    const room = await this.readRoom()
    if (!room || room.expiresAt <= Date.now()) return json({ error: 'Room is unavailable' }, 404)
    const origin = request.headers.get('origin')
    if (origin !== room.appOrigin || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'Invalid room connection' }, 403)
    }
    // ponytail: stale unauthenticated sockets are reaped when the next one opens, so a client
    // that never authenticates cannot hold the pending slots; an alarm sweep is not needed.
    const now = Date.now()
    let pending = 0
    for (const socket of this.ctx.getWebSockets()) {
      const state = attachment(socket)
      if (state.authenticated) continue
      if (now - (state.openedAt ?? 0) > AUTH_GRACE_MS) socket.close(1008, 'Authentication timed out')
      else pending++
    }
    if (pending >= room.participantLimit + 4) return json({ error: 'Too many pending connections' }, 429)
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.serializeAttachment({ authenticated: false, lastProgressAt: 0, openedAt: now })
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || encoder.encode(message).byteLength > 1024) {
      socket.close(1009, 'Message too large')
      return
    }
    let value: unknown
    try { value = JSON.parse(message) } catch { socket.close(1003, 'Invalid message'); return }
    const current = attachment(socket)
    if (!current.authenticated) {
      const auth = z.object({ type: z.literal('authenticate'), participantToken: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().safeParse(value)
      if (!auth.success) { socket.close(1008, 'Authentication required'); return }
      await this.authenticate(socket, auth.data.participantToken)
      return
    }

    const progress = progressSchema.safeParse(value)
    if (progress.success) {
      const now = Date.now()
      if (now - (current.lastProgressAt ?? 0) < 500) return
      socket.serializeAttachment({ ...current, lastProgressAt: now })
      await this.updateProgress(current.participantId!, progress.data.wordsCredited, progress.data.repliesCompleted)
      return
    }

    const action = actionSchema.safeParse(value)
    if (action.success) {
      await this.handleAction(socket, current.participantId!, action.data)
      return
    }
    socket.send(JSON.stringify({ type: 'error', message: 'That room update was not accepted.' }))
  }

  async webSocketClose(socket: WebSocket): Promise<void> { await this.disconnect(socket) }
  async webSocketError(socket: WebSocket): Promise<void> { await this.disconnect(socket) }

  private async authenticate(socket: WebSocket, token: string): Promise<void> {
    const tokenHash = await hashRoomToken(token)
    const now = Date.now()
    const participantId = await this.ctx.storage.transaction(async tx => {
      const room = await tx.get<RoomData>('room')
      if (!room || room.expiresAt <= now) return null
      const participant = room.participants.find(person => person.tokenHash === tokenHash && !person.removed)
      if (!participant) return null
      participant.connected = true
      if (participant.id === room.hostId) room.hostDisconnectedAt = null
      await tx.put('room', room)
      return participant.id
    })
    if (!participantId) { socket.close(1008, 'Room access expired'); return }
    // A participant has one active editor connection; the newest reconnect wins.
    for (const other of this.ctx.getWebSockets()) {
      if (other !== socket && attachment(other).participantId === participantId) other.close(4001, 'Reconnected in another tab')
    }
    socket.serializeAttachment({ participantId, authenticated: true, lastProgressAt: 0 })
    await this.broadcast({ type: 'joined', participantId })
    await this.broadcastState()
    await this.reschedule()
  }

  private async updateProgress(participantId: string, wordsCredited: number, repliesCompleted: number): Promise<void> {
    const room = await this.ctx.storage.transaction(async tx => {
      const current = await tx.get<RoomData>('room')
      if (!current || (current.status !== 'running' && current.status !== 'paused')) return null
      const participant = current.participants.find(person => person.id === participantId && !person.removed)
      if (!participant || wordsCredited < participant.wordsCredited || repliesCompleted < participant.repliesCompleted) return null
      if (participant.wordsCredited === wordsCredited && participant.repliesCompleted === repliesCompleted) return null
      participant.wordsCredited = wordsCredited
      participant.repliesCompleted = repliesCompleted
      await tx.put('room', current)
      return current
    })
    if (room) await this.broadcastState(room)
  }

  private async handleAction(socket: WebSocket, participantId: string, action: z.infer<typeof actionSchema>): Promise<void> {
    const now = Date.now()
    const result = await this.ctx.storage.transaction(async tx => {
      const room = await tx.get<RoomData>('room')
      if (!room) return { error: 'Room is no longer available.' }
      if (room.hostId !== participantId) return { error: 'Only the host can control this room.' }
      const actor = room.participants.find(person => person.id === participantId && !person.removed)
      if (!actor) return { error: 'Room access expired.' }

      switch (action.action) {
        case 'start':
          if (room.status !== 'waiting') return { error: 'This round has already started.' }
          room.status = 'running'
          room.roundStartedAt = now
          room.runStartedAt = now
          room.activeElapsedMs = 0
          room.remainingMs = room.durationSeconds * 1000
          room.deadlineAt = now + room.remainingMs
          break
        case 'pause':
          if (room.status !== 'running' || room.deadlineAt === null) return { error: 'The timer is not running.' }
          room.activeElapsedMs += Math.max(0, Math.min(now, room.deadlineAt) - (room.runStartedAt ?? now))
          room.runStartedAt = null
          room.remainingMs = Math.max(0, room.deadlineAt - now)
          room.deadlineAt = null
          room.status = room.remainingMs === 0 ? 'finished' : 'paused'
          if (room.status === 'finished') this.finishRound(room, now)
          break
        case 'resume':
          if (room.status !== 'paused' || room.remainingMs <= 0) return { error: 'This round cannot be resumed.' }
          room.runStartedAt = now
          room.deadlineAt = now + room.remainingMs
          room.status = 'running'
          break
        case 'end':
          if (room.status !== 'running' && room.status !== 'paused' && room.status !== 'waiting') return { error: 'This round has ended.' }
          if (room.status === 'running' && room.deadlineAt !== null) room.activeElapsedMs += Math.max(0, Math.min(now, room.deadlineAt) - (room.runStartedAt ?? now))
          room.runStartedAt = null
          room.remainingMs = room.status === 'running' && room.deadlineAt !== null ? Math.max(0, room.deadlineAt - now) : room.remainingMs
          room.deadlineAt = null
          room.status = 'finished'
          this.finishRound(room, now)
          break
        case 'next-round':
          if (room.status !== 'finished') return { error: 'Finish this round before starting another.' }
          room.roundNumber++
          room.status = 'waiting'
          room.roundStartedAt = null
          room.runStartedAt = null
          room.activeElapsedMs = 0
          room.deadlineAt = null
          room.remainingMs = room.durationSeconds * 1000
          for (const person of room.participants) { person.wordsCredited = 0; person.repliesCompleted = 0 }
          break
        case 'configure':
          if (room.status !== 'waiting') return { error: 'Round settings can only change before a round starts.' }
          room.durationSeconds = action.durationSeconds
          room.goalWords = action.goalWords
          room.remainingMs = room.durationSeconds * 1000
          break
        case 'remove-participant': {
          const target = room.participants.find(person => person.id === action.participantId && !person.removed)
          if (!target || target.id === room.hostId) return { error: 'That participant cannot be removed.' }
          target.removed = true
          target.connected = false
          break
        }
      }
      await tx.put('room', room)
      return { room }
    })
    if ('error' in result) {
      socket.send(JSON.stringify({ type: 'error', message: result.error }))
      return
    }
    if (action.action === 'remove-participant') {
      for (const peer of this.ctx.getWebSockets()) {
        if (attachment(peer).participantId === action.participantId) peer.close(4003, 'Removed by host')
      }
    }
    await this.schedule(result.room)
    await this.broadcastState(result.room)
  }

  private finishRound(room: RoomData, endedAt: number): void {
    if (room.rounds.some(round => round.number === room.roundNumber)) return
    if (room.status === 'running' && room.runStartedAt !== null) {
      const runEnd = room.deadlineAt === null ? endedAt : Math.min(endedAt, room.deadlineAt)
      room.activeElapsedMs += Math.max(0, runEnd - room.runStartedAt)
    }
    room.rounds.push({ number: room.roundNumber, startedAt: room.roundStartedAt, endedAt,
      durationSeconds: Math.floor(room.activeElapsedMs / 1000),
      participants: room.participants.filter(person => !person.removed).map(({ id, name, wordsCredited, repliesCompleted }) => ({ id, name, wordsCredited, repliesCompleted })) })
    room.runStartedAt = null
    room.deadlineAt = null
    room.remainingMs = 0
    room.status = 'finished'
  }

  private async disconnect(socket: WebSocket): Promise<void> {
    const participantId = attachment(socket).participantId
    if (!participantId) return
    const now = Date.now()
    const room = await this.ctx.storage.transaction(async tx => {
      const current = await tx.get<RoomData>('room')
      if (!current) return null
      const person = current.participants.find(candidate => candidate.id === participantId)
      if (!person) return null
      const stillConnected = this.ctx.getWebSockets().some(peer => peer !== socket && attachment(peer).participantId === participantId && peer.readyState === WebSocket.OPEN)
      person.connected = stillConnected
      if (!stillConnected && current.hostId === participantId) current.hostDisconnectedAt = now
      await tx.put('room', current)
      return current
    })
    if (room) { await this.broadcastState(room); await this.schedule(room) }
  }

  private async readRoom(): Promise<RoomData | null> {
    return await this.ctx.storage.get<RoomData>('room') ?? null
  }

  private async schedule(room: RoomData): Promise<void> {
    const deadlines = [room.expiresAt]
    if (room.status === 'running' && room.deadlineAt !== null) deadlines.push(room.deadlineAt)
    if (room.hostDisconnectedAt !== null) deadlines.push(room.hostDisconnectedAt + HOST_TRANSFER_GRACE_MS)
    await this.ctx.storage.setAlarm(Math.min(...deadlines))
  }

  private async reschedule(): Promise<void> {
    const room = await this.readRoom()
    if (room) await this.schedule(room)
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    let room = await this.readRoom()
    if (!room) return
    if (room.expiresAt <= now) {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, 'Room expired')
      await this.ctx.storage.deleteAll()
      return
    }
    let changed = false
    if (room.status === 'running' && room.deadlineAt !== null && room.deadlineAt <= now) {
      this.finishRound(room, room.deadlineAt)
      changed = true
    }
    if (room.hostDisconnectedAt !== null && room.hostDisconnectedAt + HOST_TRANSFER_GRACE_MS <= now) {
      const nextHost = [...room.participants].filter(person => person.id !== room!.hostId && !person.removed)
        .sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)[0]
      room.hostDisconnectedAt = null
      if (nextHost) room.hostId = nextHost.id
      changed = true
    }
    if (changed) {
      await this.ctx.storage.put('room', room)
      await this.broadcastState(room)
    }
    await this.schedule(room)
  }

  private async broadcastState(room?: RoomData): Promise<void> {
    const current = room ?? await this.readRoom()
    if (current) await this.broadcast({ type: 'state', state: snapshot(current) })
  }

  private async broadcast(payload: unknown): Promise<void> {
    const serialized = JSON.stringify(payload)
    for (const socket of this.ctx.getWebSockets()) {
      if (attachment(socket).authenticated && socket.readyState === WebSocket.OPEN) {
        try { socket.send(serialized) } catch { /* A closing socket will be removed by its close event. */ }
      }
    }
  }
}
