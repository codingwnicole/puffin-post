import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { initialsFor } from '../components/InitialsAvatar'

type Resource = { id: string; label: string; url: string }
type Plan = { id: string; name: string; faceclaim: string | null; notes: string; state: 'idea' | 'developing' | 'ready'; iconObjectKey: string | null; createdAt: string; updatedAt: string; resources: Resource[] }
type ArchivedCharacter = { id: string; name: string; color: string | null; notes: string | null; iconObjectKey: string | null; createdAt: string; rpGroupNames: string[]; threadCount: number }

function stageLabel(stage: Plan['state']) { return stage === 'idea' ? 'Spark' : stage === 'developing' ? 'In progress' : 'Ready to place' }
async function squarePlannerImage(file: File) {
  const image = await createImageBitmap(file), size = Math.min(image.width, image.height), canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  canvas.width = 300; canvas.height = 300
  if (!context) throw new Error('Could not prepare image')
  context.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 300, 300)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .9))
  if (!blob) throw new Error('Could not prepare image')
  return new File([blob], 'planner-image.webp', { type: 'image/webp' })
}

function PlanCard({ plan, reload, reportError }: { plan: Plan; reload: () => Promise<void>; reportError: (message: string) => void }) {
  const [editing, setEditing] = useState(false), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false)
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true)
    try { await api('/character-planner/' + plan.id, 'PATCH', { name: data.get('name'), faceclaim: data.get('faceclaim'), notes: data.get('notes'), state: data.get('state') }); setEditing(false); await reload() }
    catch (problem) { reportError((problem as Error).message) } finally { setBusy(false) }
  }
  async function upload(file: File) {
    setBusy(true)
    try { const form = new FormData(); form.set('icon', await squarePlannerImage(file)); const response = await fetch('/api/character-planner/' + plan.id + '/icon', { method: 'POST', body: form }); if (!response.ok) { const problem = await response.json().catch(() => null) as { error?: string } | null; throw new Error(problem?.error ?? 'Image upload failed') }; await reload() }
    catch (problem) { reportError((problem as Error).message) } finally { setBusy(false) }
  }
  return <article className="planner-card tracking-card">
    <div className="planner-card-heading"><img className="planner-avatar" alt="" width={80} height={80} hidden={!plan.iconObjectKey} src={plan.iconObjectKey ? '/api/character-planner/' + plan.id + '/icon?v=' + plan.iconObjectKey : undefined} onError={event => event.currentTarget.classList.add('avatar-fallback')} data-initials={initialsFor(plan.name)} /><div><p className="eyebrow">{stageLabel(plan.state)}</p><h3>{plan.name}</h3>{plan.faceclaim && <p className="planner-faceclaim">{plan.faceclaim}</p>}</div><span className={'planner-stage planner-stage-' + plan.state}>{stageLabel(plan.state)}</span></div>
    {plan.notes && <p className="planner-notes preserve-lines">{plan.notes}</p>}
    <section className="planner-resources"><div><strong>Resources</strong><button type="button" className="text-button" onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add link'}</button></div>{plan.resources.length ? <ul>{plan.resources.map(resource => <li key={resource.id}><a href={resource.url} target="_blank" rel="noopener noreferrer">{resource.label}</a><button type="button" className="text-button" onClick={() => void api('/character-planner/' + plan.id + '/resources/' + resource.id, 'DELETE').then(reload).catch(problem => reportError(problem.message))}>Remove</button></li>)}</ul> : null}{adding && <form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setBusy(true); try { await api('/character-planner/' + plan.id + '/resources', 'POST', { label: data.get('label'), url: data.get('url') }); form.reset(); setAdding(false); await reload() } catch (problem) { reportError((problem as Error).message) } finally { setBusy(false) } }}><label>Label<input name="label" required maxLength={120} placeholder="icon pack" /></label><label>Link<input name="url" type="url" required placeholder="https://" /></label><button disabled={busy}>Save link</button></form>}</section>
    <div className="actions planner-actions"><label className="icon-picker">{plan.iconObjectKey ? 'Replace image' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file) }} /></label><button type="button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Close editor' : 'Edit idea'}</button><button type="button" className="secondary-button" disabled={busy} onClick={async()=>{try{setBusy(true);await api('/character-planner/'+plan.id+'/add-to-cast','POST');await reload();window.location.hash='characters'}catch(problem){reportError((problem as Error).message)}finally{setBusy(false)}}}>Add to cast</button><button className="danger-button" type="button" disabled={busy} onClick={() => { if (!window.confirm('Delete this character idea and its saved links?')) return; void api('/character-planner/' + plan.id, 'DELETE').then(reload).catch(problem => reportError(problem.message)) }}>Delete idea</button></div>
    {editing && <form className="tracking-form planner-edit" onSubmit={save}><label>Working name<input name="name" required maxLength={200} defaultValue={plan.name} /></label><label>Faceclaim<input name="faceclaim" maxLength={200} defaultValue={plan.faceclaim ?? ''} placeholder="e.g. Nana, Inde Navarrette, Sepideh Moafi" /></label><label>Stage<select name="state" defaultValue={plan.state}><option value="idea">Spark</option><option value="developing">In progress</option><option value="ready">Ready to place</option></select></label><label>Notes<textarea name="notes" maxLength={20000} defaultValue={plan.notes} placeholder="Vibes, history fragments, plot hooks, maybe a real name later..." /></label><button disabled={busy}>Save idea</button></form>}
  </article>
}

export default function CharacterPlannerPage() {
  const [plans, setPlans] = useState<Plan[]>([]), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [archived, setArchived] = useState<ArchivedCharacter[]>([]), [restoring, setRestoring] = useState<string | null>(null)
  const [loadMore, setLoadMore] = useState(false), [moreBusy, setMoreBusy] = useState(false)
  const reload = async () => { try { const [p, a] = await Promise.all([api<{ plans: Plan[]; hasMore: boolean; nextCursor: string | null }>('/character-planner'), api<ArchivedCharacter[]>('/characters/archived')]); setPlans(p.plans); setArchived(a); setLoadMore(p.hasMore); setError('') } catch (problem) { setError((problem as Error).message) } }
  const loadOlder = async () => { setMoreBusy(true); try { const last = plans[plans.length - 1]; const p = await api<{ plans: Plan[]; hasMore: boolean; nextCursor: string | null }>('/character-planner?before=' + encodeURIComponent(last.updatedAt)); setPlans(prev => [...prev, ...p.plans]); setLoadMore(p.hasMore); setError('') } catch (problem) { setError((problem as Error).message) } finally { setMoreBusy(false) } }
  useEffect(() => { void reload() }, [])
  async function restore(id: string) { setRestoring(id); try { setError(''); await api('/characters/' + id + '/restore', 'POST'); await reload() } catch (problem) { setError((problem as Error).message) } finally { setRestoring(null) } }
  return <section aria-labelledby="planner-title"><div className="planner-heading"><div><h2 className="page-heading" id="planner-title">Character planner</h2><p className="page-description">Future characters and their resources, before they have an RP home.</p></div><button onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'New character idea'}</button></div>
    {error && <p role="alert">{error}</p>}
    {adding && <form className="tracking-card tracking-form planner-create" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); setBusy(true); try { await api('/character-planner', 'POST', { name: data.get('name'), faceclaim: data.get('faceclaim'), notes: data.get('notes'), state: data.get('state') }); form.reset(); setAdding(false); await reload() } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}><h3>Save a character idea</h3><label>Working name<input name="name" required maxLength={200} autoFocus placeholder="Name, role, or a temporary title" /></label><label>Faceclaim<input name="faceclaim" maxLength={200} placeholder="e.g. Nana, Inde Navarrette, Sepideh Moafi" /></label><label>Stage<select name="state" defaultValue="idea"><option value="idea">Spark</option><option value="developing">In progress</option><option value="ready">Ready to place</option></select></label><label>Notes<textarea name="notes" maxLength={20000} placeholder="What you know so far..." /></label><button disabled={busy}>Save to planner</button></form>}
    <div className="planner-grid">{plans.map(plan => <PlanCard key={plan.id} plan={plan} reload={reload} reportError={setError} />)}
      {loadMore && <button type="button" className="planner-load-more" disabled={moreBusy} onClick={() => void loadOlder()}>{moreBusy ? 'Loading…' : 'Load more ideas'}</button>}</div>
    {!plans.length && !adding && <section className="tracking-card planner-empty"><h3>No future characters parked yet.</h3><p>Start with a faceclaim, a job, a moodboard link—whatever comes first.</p></section>}
    {archived.length > 0 && (
      <section className="planner-archived" aria-labelledby="archived-heading">
        <h3 id="archived-heading">Archived</h3>
        <p className="page-description">Characters you've set aside. All threads, quicklinks, and RP memberships are preserved.</p>
        <div className="archived-list">
          {archived.map(ch => (
            <article key={ch.id} className="archived-entry tracking-card">
              <img className="archived-avatar" alt="" width={48} height={48} hidden={!ch.iconObjectKey} src={ch.iconObjectKey ? '/api/characters/' + ch.id + '/icon?v=' + ch.iconObjectKey : undefined} onError={event => event.currentTarget.classList.add('avatar-fallback')} data-initials={initialsFor(ch.name)} />
              <div className="archived-info">
                <h4>{ch.name}</h4>
                {ch.rpGroupNames.length > 0 && <p className="archived-rp-labels">{ch.rpGroupNames.join(' · ')}</p>}
                <p className="archived-meta">{ch.threadCount} thread{ch.threadCount === 1 ? '' : 's'} preserved</p>
              </div>
              <div className="archived-actions">
                <a href={'#character-shortcut/' + ch.id} className="secondary-button">View</a>
                <button type="button" className="secondary-button" disabled={restoring === ch.id} onClick={() => void restore(ch.id)}>{restoring === ch.id ? 'Restoring…' : 'Restore'}</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    )}
  </section>
}
