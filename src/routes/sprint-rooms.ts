import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireWorkspace } from '../auth/sessions'
import { checkRateLimit, opaqueRateLimitKey } from '../auth/rate-limits'
import { hashRoomPassword, hashRoomToken, randomRoomToken } from '../sprints/room-security'
import type { Env } from '../worker'

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  hostName: z.string().trim().min(1).max(32),
  durationSeconds: z.number().int().min(60).max(21_600),
  goalWords: z.number().int().min(1).max(1_000_000).nullable(),
  participantLimit: z.number().int().min(2).max(32).default(8),
  password: z.string().min(4).max(128).optional(),
}).strict()

const joinSchema = z.object({
  inviteToken: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  participantToken: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
  password: z.string().max(128).optional(),
}).strict().refine(value => Boolean(value.inviteToken || value.participantToken))

function jsonError(response: Response): Promise<{ error?: string }> {
  return response.json().then(value => value as { error?: string }).catch(() => ({}))
}

export function sprintRoomRoutes() {
  const app = new Hono<{ Bindings: Env }>()

  app.post('/', async c => {
    const scope = await requireWorkspace(c)
    const gate = await checkRateLimit(scope.db, `sprint-room-create:${scope.workspaceId}`, 8, 60 * 60_000)
    if (!gate.allowed) throw new HTTPException(429, { message: 'You have created several rooms recently. Try again in an hour.' })
    const input = createSchema.parse(await c.req.json())
    const roomId = crypto.randomUUID()
    const inviteToken = randomRoomToken()
    const hostToken = randomRoomToken()
    const hostId = crypto.randomUUID()
    const stub = c.env.SPRINT_ROOMS.get(c.env.SPRINT_ROOMS.idFromName(roomId))
    const response = await stub.fetch('https://room.internal/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roomId, appOrigin: c.env.APP_ORIGIN, name: input.name, hostName: input.hostName, hostId,
        durationSeconds: input.durationSeconds, goalWords: input.goalWords,
        participantLimit: input.participantLimit,
        inviteTokenHash: await hashRoomToken(inviteToken), hostTokenHash: await hashRoomToken(hostToken),
        passwordHash: input.password ? await hashRoomPassword(input.password) : null,
      }),
    })
    if (!response.ok) throw new HTTPException(503, { message: 'The room could not be created. Try again.' })
    const result = await response.json() as { state: unknown }
    return c.json({ roomId, inviteToken, participantId: hostId, participantToken: hostToken, state: result.state }, 201)
  })

  app.post('/:roomId/join', async c => {
    const roomId = z.string().uuid().parse(c.req.param('roomId'))
    const input = joinSchema.parse(await c.req.json())
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
    const key = await opaqueRateLimitKey(c.env.SESSION_SECRET, `sprint-room-join:${ip}:${roomId}`)
    const gate = await checkRateLimit(c.env.DB, key, 20, 60_000)
    if (!gate.allowed) throw new HTTPException(429, { message: 'Too many join attempts. Wait a minute and try again.' })
    const stub = c.env.SPRINT_ROOMS.get(c.env.SPRINT_ROOMS.idFromName(roomId))
    const response = await stub.fetch('https://room.internal/join', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })
    const body = await response.json().catch(() => ({ error: 'This room link is invalid or no longer available.' })) as { error?: string; [key: string]: unknown }
    return c.json(body, response.status as 200)
  })

  app.get('/:roomId/socket', async c => {
    const roomId = z.string().uuid().parse(c.req.param('roomId'))
    if (c.req.header('origin') !== c.env.APP_ORIGIN || c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      throw new HTTPException(403, { message: 'Invalid room connection' })
    }
    const source = new URL(c.req.url)
    const target = new URL(`/socket${source.search}`, 'https://room.internal')
    const headers = new Headers(c.req.raw.headers)
    const stub = c.env.SPRINT_ROOMS.get(c.env.SPRINT_ROOMS.idFromName(roomId))
    const response = await stub.fetch(new Request(target, { method: 'GET', headers }))
    if (response.status === 101) return response
    if (!response.ok) {
      const error = await jsonError(response)
      throw new HTTPException(response.status as 403, { message: error.error ?? 'Invalid room connection' })
    }
    return response
  })

  return app
}
