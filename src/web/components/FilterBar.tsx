import { useState } from 'react'
import type { TrackingOptions } from '../lib/api'

export type ArchiveView = 'active' | 'archived' | 'all'
export interface InboxFilters { status:string; characterId:string; tagId:string; q:string; oldestFirst:boolean; archiveView:ArchiveView }
export const DEFAULT_FILTERS: InboxFilters = { status:'', characterId:'', tagId:'', q:'', oldestFirst:false, archiveView:'active' }

const OPEN_KEY = 'rptb-inbox-filters-open'
const activeCount = (f: InboxFilters) => [f.status, f.characterId, f.tagId, f.q.trim(), f.oldestFirst, f.archiveView !== 'active'].filter(Boolean).length

export default function FilterBar({ filters, options, tags, onChange }:{filters:InboxFilters;options:TrackingOptions;tags:{id:string;displayLabel:string}[];onChange:(next:InboxFilters)=>void}) {
  const active = activeCount(filters)
  // Collapsed by default to keep the inbox short; open whenever a filter is on so results are never filtered out of sight.
  const [open, setOpen] = useState(() => { try { return active > 0 || localStorage.getItem(OPEN_KEY) === 'open' } catch { return active > 0 } })
  const toggle = (next: boolean) => { setOpen(next); try { localStorage.setItem(OPEN_KEY, next ? 'open' : 'closed') } catch { /* storage may be unavailable */ } }
  return <div className="filter-panel">
    <details open={open} onToggle={e => { if (e.currentTarget.open !== open) toggle(e.currentTarget.open) }}>
      {/* Spelled out: at phone widths a touch-target rule makes summaries inline-flex, which hides the disclosure arrow. */}
      <summary>{open ? 'Hide filters' : 'Show filters'}{active ? ` · ${active} on` : ''}</summary>
      <div className="filter-bar" aria-label="Filter replies">
        <label>Show<select value={filters.status} onChange={e=>onChange(e.target.value==='archived'?{...filters,status:'',archiveView:'archived'}:{...filters,status:e.target.value})}><option value="">All reply states</option>{['your_turn','their_turn','queued'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></label>
        <label>Archive<select value={filters.archiveView} onChange={e=>onChange({...filters,archiveView:e.target.value as ArchiveView,status:''})}><option value="active">Active threads</option><option value="archived">Archived threads</option><option value="all">All threads</option></select></label>
        <label>Character<select value={filters.characterId} onChange={e=>onChange({...filters,characterId:e.target.value})}><option value="">All characters</option>{options.characters.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
        <label>Tag<select value={filters.tagId} onChange={e=>onChange({...filters,tagId:e.target.value})}><option value="">All tags</option>{tags.map(x=><option value={x.id} key={x.id}>{x.displayLabel}</option>)}</select></label>
        <label>Order<select value={filters.oldestFirst?'oldest':'newest'} onChange={e=>onChange({...filters,oldestFirst:e.target.value==='oldest'})}><option value="newest">Recently active</option><option value="oldest">Waiting longest</option></select></label>
        <label>Search<input value={filters.q} onChange={e=>onChange({...filters,q:e.target.value})} placeholder="Scene, character, partner" /></label>
      </div>
    </details>
    {active > 0 && <button type="button" className="text-action" onClick={() => onChange(DEFAULT_FILTERS)}>Clear filters</button>}
  </div>
}
