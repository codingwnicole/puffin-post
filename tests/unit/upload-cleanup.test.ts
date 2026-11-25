import { expect, it, vi } from 'vitest'
import { deleteWorkspaceUploads, settingsRoutes } from '../../src/routes/settings'
import type { Env } from '../../src/worker'

vi.mock('../../src/auth/sessions', () => ({ requireSession: async () => ({userId:'u'}) }))

it('deletes every page of character uploads and planner uploads, scoped to the workspace', async () => {
  const list = vi.fn().mockResolvedValueOnce({ objects: [{ key: 'first' }], truncated: true })
    .mockResolvedValueOnce({ objects: [{ key: 'last' }], truncated: false })
    .mockResolvedValueOnce({ objects: [{ key: 'planner' }], truncated: false })
  const remove = vi.fn().mockResolvedValue(undefined)
  await deleteWorkspaceUploads({ list, delete: remove } as unknown as R2Bucket, 'ws')
  expect(list.mock.calls).toEqual([[{ prefix: 'characters/ws/' }], [{ prefix: 'characters/ws/' }], [{ prefix: 'character-plans/ws/' }]])
  expect(remove.mock.calls).toEqual([[['first']], [['last']], [['planner']]])
})

it('allows cleanup to be retried after an object-store failure', async () => {
  const list = vi.fn().mockResolvedValue({ objects: [{ key: 'remaining' }], truncated: false })
  const remove = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined)
  const bucket = { list, delete: remove } as unknown as R2Bucket
  await expect(deleteWorkspaceUploads(bucket, 'ws')).rejects.toThrow('temporary')
  await expect(deleteWorkspaceUploads(bucket, 'ws')).resolves.toBeUndefined()
})

it('does not delete the account or clear its cookie when cleanup fails, and completes on retry', async () => {
  const batch = vi.fn().mockResolvedValue([])
  const list = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({objects:[],truncated:false})
  const env = { DB: { batch, prepare: (sql: string) => ({bind: () => ({
    first: async () => sql.includes('COUNT') ? {n:1} : {email:'u@example.test'},
    all: async () => ({results:[{workspaceId:'ws'}]}),
  })}) }, ICONS: {list,delete:vi.fn()} } as unknown as Env
  const app = settingsRoutes()
  app.onError((_error,c) => c.json({error:'failed'},500))
  const request = () => new Request('https://app.test/account',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({confirm:'DELETE'})})
  const failed = await app.fetch(request(), env)
  expect(failed.status).toBe(500)
  expect(failed.headers.get('set-cookie')).toBeNull()
  expect(batch).not.toHaveBeenCalled()
  const retried = await app.fetch(request(), env)
  expect(retried.status).toBe(204)
  expect(batch).toHaveBeenCalledOnce()
  expect(retried.headers.get('set-cookie')).toContain('Max-Age=0')
})
