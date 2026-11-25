import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'

type Group = { id: string; name: string }
type Character = { id: string; name: string; groupId: string }
type Blog = { blogIdentifier: string; displayLabel: string; groupId: string }
type Requirement = { id: string; groupId: string; groupName: string; scope: 'group'|'character'|'blog'; characterId: string|null; characterName: string|null; blogIdentifier: string|null; intervalDays: number; reminderBeforeHours: number; reminderDue: number; reminderOverdue: number; graceHours: number; enabled: number; allowManual: number; timezone: string; lastActivityAt: string|null; lastActivitySource: 'tumblr'|'manual'|null; deadlineAt: string; status: 'paused'|'overdue'|'due-soon'|'on-track' }
type Data = { groups: Group[]; characters: Character[]; blogs: Blog[]; requirements: Requirement[] }
type Form = { id: string; groupId: string; scope: 'group'|'character'|'blog'; characterId: string; blogIdentifier: string; intervalDays: number; reminderBeforeHours: number; reminderDue: boolean; reminderOverdue: boolean; graceHours: number; enabled: boolean; allowManual: boolean; timezone: string }
const fresh = (): Form => ({ id: '', groupId: '', scope: 'group', characterId: '', blogIdentifier: '', intervalDays: 7, reminderBeforeHours: 24, reminderDue: true, reminderOverdue: true, graceHours: 0, enabled: true, allowManual: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })

function parseData(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Activity requirements could not be loaded.')
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.groups) || !Array.isArray(data.characters) || !Array.isArray(data.blogs) || !Array.isArray(data.requirements)) {
    throw new Error('Activity requirements could not be loaded.')
  }
  return data as Data
}

export default function ActivityRequirementsSettings() {
  const [data, setData] = useState<Data>({ groups: [], characters: [], blogs: [], requirements: [] })
  const [form, setForm] = useState<Form>(fresh)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const load = async () => setData(parseData(await api<unknown>('/activity-requirements')))
  useEffect(() => { let active = true; void api<unknown>('/activity-requirements').then(value => { if (active) setData(parseData(value)) }).catch(problem => { if (active) setError((problem as Error).message) }); return () => { active = false } }, [])
  const characters = useMemo(() => data.characters.filter(character => character.groupId === form.groupId), [data.characters, form.groupId])
  const blogs = useMemo(() => data.blogs.filter(blog => blog.groupId === form.groupId), [data.blogs, form.groupId])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setStatus('')
    try {
      await api('/activity-requirements', 'POST', { ...form, characterId: form.scope === 'character' ? form.characterId || null : null, blogIdentifier: form.scope === 'blog' ? form.blogIdentifier || null : null })
      await load(); setForm(fresh()); setStatus(form.id ? 'Activity requirement updated.' : 'Activity requirement saved.')
    } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) }
  }

  function edit(item: Requirement) {
    setForm({ id: item.id, groupId: item.groupId, scope: item.scope, characterId: item.characterId ?? '', blogIdentifier: item.blogIdentifier ?? '', intervalDays: item.intervalDays, reminderBeforeHours: item.reminderBeforeHours, reminderDue: Boolean(item.reminderDue), reminderOverdue: Boolean(item.reminderOverdue), graceHours: item.graceHours, enabled: Boolean(item.enabled), allowManual: Boolean(item.allowManual), timezone: item.timezone })
  }

  return <section className="tracking-card activity-requirements" aria-labelledby="activity-requirements-title">
    <h2 id="activity-requirements-title">RP activity requirements</h2>
    <p className="field-help">Track activity from verified Tumblr replies in tracked threads. Incoming partner posts and unfinished sprint drafts do not count. Shared-blog activity is counted only at the exact blog scope you choose; it is never guessed across characters.</p>
    {error && <p role="alert" className="profile-error">{error}</p>}{status && <p role="status" className="success-pulse">{status}</p>}
    {data.requirements.length ? <ul className="activity-requirement-list">{data.requirements.map(item => <li key={item.id}>
      <div><strong>{item.groupName}{item.scope === 'character' && item.characterName ? ` · ${item.characterName}` : item.scope === 'blog' && item.blogIdentifier ? ` · ${item.blogIdentifier}` : ''}</strong><span>{item.intervalDays}-day requirement · {item.status.replace('-', ' ')} · due {new Intl.DateTimeFormat(undefined, { timeZone: item.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.deadlineAt))}</span><span>{item.lastActivityAt ? `Last qualifying activity: ${new Intl.DateTimeFormat(undefined, { timeZone: item.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.lastActivityAt))} (${item.lastActivitySource === 'manual' ? 'logged manually' : 'Tumblr verified'})` : 'No qualifying activity recorded yet.'}</span></div>
      <div className="actions"><button type="button" className="secondary-button" onClick={() => edit(item)}>Edit</button>{item.allowManual === 1 && <button type="button" className="secondary-button" disabled={busy} onClick={async () => { try { setBusy(true); await api(`/activity-requirements/${item.id}/manual`, 'POST', { activityAt: new Date().toISOString(), note: '' }); await load(); setStatus('Activity logged manually. It is labeled as unverified.') } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Log activity</button>}<button type="button" className="danger-button" disabled={busy} onClick={async () => { if (!window.confirm('Delete this RP activity requirement?')) return; try { setBusy(true); await api(`/activity-requirements/${item.id}`, 'DELETE'); await load(); setStatus('Requirement deleted.') } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) } }}>Delete</button></div>
    </li>)}</ul> : <p className="field-help">No activity expectations yet. Add one for a group, character, or exact Tumblr blog.</p>}
    <form className="activity-requirement-form" onSubmit={event => void save(event)}>
      <h3>{form.id ? 'Edit requirement' : 'Add a requirement'}</h3>
      <div className="sprint-form"><label className="sprint-field">RP section<select required value={form.groupId} onChange={event => setForm({ ...form, groupId: event.target.value, characterId: '', blogIdentifier: '' })}><option value="">Choose an RP section</option>{data.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="sprint-field">Scope<select value={form.scope} onChange={event => setForm({ ...form, scope: event.target.value as Form['scope'], characterId: '', blogIdentifier: '' })}><option value="group">Whole RP section</option><option value="character">One character</option><option value="blog">One Tumblr blog</option></select></label>
      {form.scope === 'character' && <label className="sprint-field">Character<select required value={form.characterId} onChange={event => setForm({ ...form, characterId: event.target.value })}><option value="">Choose a character</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>}
      {form.scope === 'blog' && <label className="sprint-field">Tumblr blog<select required value={form.blogIdentifier} onChange={event => setForm({ ...form, blogIdentifier: event.target.value })}><option value="">Choose a blog</option>{blogs.map(blog => <option key={`${blog.groupId}:${blog.blogIdentifier}`} value={blog.blogIdentifier}>{blog.displayLabel}</option>)}</select></label>}
      <label className="sprint-field">Reply interval, days<input type="number" min="1" max="90" required value={form.intervalDays} onChange={event => setForm({ ...form, intervalDays: Number(event.target.value) })} /></label>
      <label className="sprint-field">Reminder before due, hours<input type="number" min="0" max="720" value={form.reminderBeforeHours} onChange={event => setForm({ ...form, reminderBeforeHours: Number(event.target.value) })} /></label>
      <label className="sprint-field">Grace period, hours<input type="number" min="0" max="720" value={form.graceHours} onChange={event => setForm({ ...form, graceHours: Number(event.target.value) })} /></label>
      <label className="sprint-field">Time zone<input maxLength={80} value={form.timezone} onChange={event => setForm({ ...form, timezone: event.target.value })} placeholder="America/Chicago" /></label></div>
      <div className="activity-requirement-options"><label><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} /> Enable this requirement</label><label><input type="checkbox" checked={form.reminderDue} onChange={event => setForm({ ...form, reminderDue: event.target.checked })} /> Remind me when due</label><label><input type="checkbox" checked={form.reminderOverdue} onChange={event => setForm({ ...form, reminderOverdue: event.target.checked })} /> Remind me when overdue</label><label><input type="checkbox" checked={form.allowManual} onChange={event => setForm({ ...form, allowManual: event.target.checked })} /> Allow manual activity logging</label></div>
      <p className="field-help">Verified time comes from the last synced reply authored by one of your connected blogs. Deadlines use calendar days in your selected time zone. Manual entries are clearly marked and never appear as Tumblr-verified.</p>
      <div className="actions"><button type="submit" disabled={busy || !data.groups.length}>{busy ? 'Saving.' : form.id ? 'Update requirement' : 'Save requirement'}</button>{form.id && <button type="button" className="secondary-button" onClick={() => setForm(fresh())}>Cancel edit</button>}</div>
    </form>
  </section>
}
