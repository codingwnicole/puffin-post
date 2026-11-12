import { Hono } from 'hono'
import type { Env } from '../worker'
import { requireWorkspace } from '../auth/sessions'
import { listInboxBranches } from '../db/repositories/branches'
import { serializeWorkspaceCsv } from '../export/csv'

export function exportRoutes() {
  const app = new Hono<{ Bindings: Env }>()
  app.get('/export.csv', async c => {
    const scope = await requireWorkspace(c)
    const branches = await listInboxBranches({ ...scope, includeArchived: true })
    const csv = serializeWorkspaceCsv(branches.map(branch => ({
      starterTitle: branch.title, character: branch.characterName, rootBlog: branch.rootBlogId,
      rootPostId: branch.rootPostId, partner: branch.partnerLabel ?? '', status: branch.status,
      notes: branch.notes, lastActivityAt: branch.lastActivityAt ?? '',
    })))
    c.header('Content-Disposition', 'attachment; filename="puffin-post-export.csv"')
    c.header('X-Content-Type-Options', 'nosniff')
    return c.text(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8' })
  })
  return app
}
