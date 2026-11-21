import type { WorkspaceScope } from '../client'
import { requireMembership } from './workspaces'
import { findTrackedThread, getStarter, type Starter } from './starters'
import { listInboxBranches, type ReplyBranch } from './branches'
import type { ReplyStatus } from '../../shared/domain'

export interface ReplyDraft {
  id: string; workspaceId: string; characterId: string | null; characterIds: string[]; partnerId: string | null
  title: string; notes: string; purpose: 'reply'|'plotting'|'starter_idea'|'note'; sourceUrl: string | null; reminderAt: string | null
  state: 'open' | 'converted' | 'archived'; convertedStarterId: string | null; convertedBranchId: string | null
  createdAt: string; updatedAt: string
}
type DraftInput = Pick<ReplyDraft,'title'> & Partial<Pick<ReplyDraft,'characterId'|'characterIds'|'partnerId'|'notes'|'purpose'|'sourceUrl'|'reminderAt'>>
const columns = `id,workspace_id AS workspaceId,character_id AS characterId,partner_id AS partnerId,title,notes,purpose,
  source_url AS sourceUrl,reminder_at AS reminderAt,state,converted_starter_id AS convertedStarterId,
  converted_branch_id AS convertedBranchId,created_at AS createdAt,updated_at AS updatedAt`

async function references(scope: WorkspaceScope, input: { characterId?: string | null; partnerId?: string | null }) {
  for (const [table,id,label] of [['characters',input.characterId,'Character'],['partners',input.partnerId,'Partner']]) {
    if (id != null && !await scope.db.prepare(`SELECT id FROM ${table} WHERE workspace_id=? AND id=?`)
      .bind(scope.workspaceId,id).first()) throw new Error(`${label} not found`)
  }
}
async function withCharacters(scope: WorkspaceScope, drafts: Omit<ReplyDraft,'characterIds'>[]) {
  if (!drafts.length) return [] as ReplyDraft[]
  const links=await scope.db.prepare(`SELECT draft_id AS draftId,character_id AS characterId FROM reply_draft_characters WHERE workspace_id=? AND draft_id IN (${drafts.map(()=>'?').join(',')})`).bind(scope.workspaceId,...drafts.map(draft=>draft.id)).all<{draftId:string;characterId:string}>()
  return drafts.map(draft=>({ ...draft, characterIds:links.results.filter(link=>link.draftId===draft.id).map(link=>link.characterId) }))
}
export async function getReplyDraft(scope: WorkspaceScope, id: string): Promise<ReplyDraft> {
  await requireMembership(scope.db,scope.userId,scope.workspaceId)
  const draft = await scope.db.prepare(`SELECT ${columns} FROM reply_drafts WHERE workspace_id=? AND id=?`)
    .bind(scope.workspaceId,id).first<Omit<ReplyDraft,'characterIds'>>()
  if (!draft) throw new Error('Draft not found')
  return (await withCharacters(scope,[draft]))[0]
}
export async function listReplyDrafts(scope: WorkspaceScope, state: ReplyDraft['state'] = 'open', overdue = false) {
  await requireMembership(scope.db,scope.userId,scope.workspaceId)
  const rows = await scope.db.prepare(`SELECT ${columns} FROM reply_drafts WHERE workspace_id=? AND state=?
    ${overdue ? 'AND reminder_at <= ?' : ''} ORDER BY reminder_at IS NULL,reminder_at,created_at DESC`)
    .bind(scope.workspaceId,state,...(overdue ? [new Date().toISOString()] : [])).all<Omit<ReplyDraft,'characterIds'>>()
  return withCharacters(scope,rows.results)
}
export async function createReplyDraft(scope: WorkspaceScope, input: DraftInput) {
  await requireMembership(scope.db,scope.userId,scope.workspaceId)
  const characterIds=[...new Set(input.characterIds ?? (input.characterId ? [input.characterId] : []))]
  await references(scope,{...input,characterId:characterIds[0]??null})
  for (const characterId of characterIds.slice(1)) await references(scope,{characterId})
  const id = crypto.randomUUID(), now = new Date().toISOString()
  await scope.db.batch([scope.db.prepare(`INSERT INTO reply_drafts (id,workspace_id,character_id,partner_id,title,notes,purpose,source_url,reminder_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,scope.workspaceId,characterIds[0] ?? null,input.partnerId ?? null,
    input.title,input.notes ?? '',input.purpose ?? 'reply',input.sourceUrl ?? null,input.reminderAt ?? null,now,now),...characterIds.map(characterId=>scope.db.prepare('INSERT INTO reply_draft_characters (workspace_id,draft_id,character_id) VALUES (?,?,?)').bind(scope.workspaceId,id,characterId))])
  return getReplyDraft(scope,id)
}
export async function updateReplyDraft(scope: WorkspaceScope, id: string, patch: Partial<DraftInput> & { state?: 'open'|'archived' }) {
  await getReplyDraft(scope,id)
  await references(scope,patch)
  if (patch.characterIds) for (const characterId of patch.characterIds) await references(scope,{characterId})
  const mapping = { title:'title',notes:'notes',purpose:'purpose',characterId:'character_id',partnerId:'partner_id',sourceUrl:'source_url',reminderAt:'reminder_at',state:'state' }
  const entries = Object.entries(mapping).filter(([key]) => key in patch)
  const result = await scope.db.prepare(`UPDATE reply_drafts SET ${entries.map(([,column]) => `${column}=?`).concat('updated_at=?').join(',')}
    WHERE workspace_id=? AND id=? AND state <> 'converted' RETURNING id`)
    .bind(...entries.map(([key]) => patch[key as keyof typeof patch] ?? null),new Date().toISOString(),scope.workspaceId,id).first()
  if (!result) throw new Error('Draft is already converted')
  if (patch.characterIds) await scope.db.batch([scope.db.prepare('DELETE FROM reply_draft_characters WHERE workspace_id=? AND draft_id=?').bind(scope.workspaceId,id),...[...new Set(patch.characterIds)].map(characterId=>scope.db.prepare('INSERT INTO reply_draft_characters (workspace_id,draft_id,character_id) VALUES (?,?,?)').bind(scope.workspaceId,id,characterId))])
  return getReplyDraft(scope,id)
}
export async function deleteReplyDraft(scope: WorkspaceScope, id:string) {
  await requireMembership(scope.db,scope.userId,scope.workspaceId)
  const result=await scope.db.prepare('DELETE FROM reply_drafts WHERE workspace_id=? AND id=?').bind(scope.workspaceId,id).run()
  if(!result.meta.changes) throw new Error('Draft not found')
}
export async function convertReplyDraft(scope: WorkspaceScope, id: string, input: {
  starter: Pick<Starter,'characterId'|'title'|'rootPostId'|'rootBlogId'> & { description?: string }
  branch?: { partnerId?: string | null; notes?: string; status?: ReplyStatus }
}): Promise<{ draft: ReplyDraft; starter: Starter; branch: ReplyBranch }> {
  let draft = await getReplyDraft(scope,id)
  if (draft.state === 'archived') throw new Error('Draft is archived')
  if (draft.state !== 'converted') {
    await references(scope,{ characterId: input.starter.characterId, partnerId: input.branch?.partnerId === undefined ? draft.partnerId : input.branch.partnerId })
    // A link to a thread that is already tracked joins it (and its open branch for this partner)
    // instead of forking a duplicate starter.
    const partnerId = input.branch?.partnerId === undefined ? draft.partnerId : input.branch.partnerId
    const trackedId = input.starter.rootBlogId === 'manual' ? null : await findTrackedThread(scope.db, scope.workspaceId, [input.starter.rootPostId])
    const trackedBranch = trackedId ? await scope.db.prepare(`SELECT id FROM reply_branches WHERE workspace_id=? AND starter_id=? AND archived_at IS NULL
      AND ((? IS NULL AND partner_id IS NULL) OR partner_id=?) ORDER BY created_at DESC LIMIT 1`).bind(scope.workspaceId, trackedId, partnerId ?? null, partnerId ?? null).first<{ id: string }>() : null
    const starterId = trackedId ?? crypto.randomUUID(), branchId = trackedBranch?.id ?? crypto.randomUUID(), now = new Date().toISOString()
    const status = input.branch?.status ?? 'your_turn'
    // D1 batch is one transaction; conditional inserts make competing conversions harmless.
    await scope.db.batch([
      ...(trackedId ? [] : [scope.db.prepare(`INSERT INTO starters (id,workspace_id,character_id,title,source,root_post_id,root_blog_id,description,created_at)
        SELECT ?,workspace_id,?,?,'tumblr',?,?,?,? FROM reply_drafts WHERE workspace_id=? AND id=? AND state='open'`)
        .bind(starterId,input.starter.characterId,input.starter.title,input.starter.rootPostId,input.starter.rootBlogId,input.starter.description ?? '',now,scope.workspaceId,id)]),
      ...(trackedBranch ? [] : [scope.db.prepare(`INSERT INTO reply_branches (id,workspace_id,starter_id,partner_id,status,notes,archived_at,created_at)
        SELECT ?,workspace_id,?,CASE WHEN ? THEN ? ELSE partner_id END,?,CASE WHEN ? THEN ? ELSE notes END,?,?
        FROM reply_drafts WHERE workspace_id=? AND id=? AND state='open'
          AND EXISTS (SELECT 1 FROM starters WHERE workspace_id=? AND id=?)`)
        .bind(branchId,starterId,input.branch?.partnerId !== undefined,input.branch?.partnerId ?? null,status,
          input.branch?.notes !== undefined,input.branch?.notes ?? null,status === 'archived' ? now : null,now,scope.workspaceId,id,scope.workspaceId,starterId)]),
      scope.db.prepare(`UPDATE reply_drafts SET state='converted',converted_starter_id=?,converted_branch_id=?,updated_at=?
        WHERE workspace_id=? AND id=? AND state='open' AND EXISTS (SELECT 1 FROM reply_branches WHERE workspace_id=? AND id=?)`)
        .bind(starterId,branchId,now,scope.workspaceId,id,scope.workspaceId,branchId),
    ])
    draft = await getReplyDraft(scope,id)
  }
  if (draft.state !== 'converted') throw new Error('Draft is archived')
  return { draft, starter: await getStarter(scope,draft.convertedStarterId!),
    branch: (await listInboxBranches({ ...scope, starterId: draft.convertedStarterId!, includeArchived: true })).find(b => b.id === draft.convertedBranchId)! }
}
