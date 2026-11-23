import { useEffect, useState, type CSSProperties } from 'react'
import type { InboxBranch } from '../../db/repositories/branches'
import { api, peekCache, staleGet, type TrackingOptions } from '../lib/api'
// ponytail: instant seed only for the unfiltered inbox; filtered views wait for fresh data.
const seedInbox=()=>window.location.hash.includes('?')?undefined:peekCache<{branches:InboxBranch[];yourTurnCount:number;overdueDraftCount:number;dueSoonCount:number}>('/inbox')
import SpinWheel from '../components/SpinWheel'
import BranchRow from '../components/BranchRow'
import CheckTumblrButton from '../components/CheckTumblrButton'
import InitialsAvatar from '../components/InitialsAvatar'
import StarterFields from '../components/StarterFields'
import FilterBar, { type InboxFilters } from '../components/FilterBar'
import { useEntered } from '../lib/motion'
import { openOnboardingTour } from '../components/OnboardingTour'


type GroupedBranches = Record<string, InboxBranch[]>

function ReplyRun({ branches }: { branches: InboxBranch[] }) {
  const active = branches.filter(branch => branch.status !== 'archived' && !branch.archivedAt && branch.starterArchived !== 1)
  const owed = active.filter(branch => branch.status === 'your_turn').length
  const waiting = active.length - owed
  const owedPercent = active.length ? Math.round((owed / active.length) * 100) : 0
  const yours = active.filter(branch => branch.status === 'your_turn').map(branch => ({ id: branch.id, label: branch.title, href: `#starter/${branch.starterId}` }))
  return <section className="reply-run summary-card" aria-label={`${owed} replies owed and ${waiting} waiting on someone else`}>
    <div className="reply-donut" style={{ '--owed': `${owedPercent}%` } as CSSProperties}><strong>{owed}</strong><span>owed</span></div>
    <div><p className="eyebrow">Reply run</p><strong>{owed ? `${owed} scene${owed === 1 ? '' : 's'} on your desk` : 'Your desk is clear'}</strong><p className="summary-legend"><span className="legend-owed">{owed} your turn</span> <span className="legend-waiting">{waiting} waiting on a partner</span></p>
      <SpinWheel items={yours} empty="Nothing is your turn here right now. Enjoy the quiet."/></div>
  </section>
}

function QuickAdd({options,busy,onSubmit}:{options:TrackingOptions;busy:boolean;onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void}) {
  return <aside className="quick-add-panel quick-add-panel-inline" id="quick-add" aria-labelledby="quick-add-title" tabIndex={-1}><div><p className="eyebrow">New scene</p><h3 id="quick-add-title">Add a thread</h3><p>Track Tumblr, Discord, or an entirely manual scene. Add a link when you want Thread Buddy to fill in the details.</p></div><form className="tracking-form" onSubmit={onSubmit}><StarterFields options={options}/><div className="actions"><button disabled={busy}>{busy?'Adding thread...':'Add thread'}</button><a className="button secondary-button" href="#dashboard">Cancel</a></div></form><div className="quick-add-help"><strong>With a post link</strong><span>Thread Buddy reads the participants and opening text. Without one, it simply saves the scene you describe.</span></div></aside>
}

function GuestSignIn({busy,setBusy,sentLink,setSentLink,sentEmail,setSentEmail}:{busy:boolean;setBusy:(value:boolean)=>void;sentLink:boolean;setSentLink:(value:boolean)=>void;sentEmail:string;setSentEmail:(value:string)=>void}) {
  // Own state: the page shows this landing only while its error is the sign-in message, so clearing that here dropped visitors onto an empty inbox.
  const [error,setError]=useState('')
  async function requestLink(email:string) {
    setBusy(true);setError('')
    try { await api('/auth/magic-link','POST',{email});setSentEmail(email);setSentLink(true) }
    catch(problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }
  const submit=(path:string,after:()=>void)=>async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);try{await api(path,'POST',{email:form.get('email'),password:form.get('password')});after()}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}
  if(sentLink)return <div className="email-confirmation" aria-live="polite"><p className="eyebrow">One more step</p><h2>Check your email</h2><p>We sent a one-time sign-in link to <strong>{sentEmail}</strong>. It expires soon and works once.</p>{error&&<p role="alert">{error}</p>}<div className="email-confirmation-actions"><button type="button" disabled={busy} onClick={()=>void requestLink(sentEmail)}>{busy?'Sending...':'Resend sign-in link'}</button><button type="button" className="secondary-button" onClick={()=>{setSentLink(false);setSentEmail('');setError('')}}>Use a different email</button></div><p className="field-help">If it is not in your inbox, check spam or wait a moment before resending.</p><p className="guest-legal"><a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies</a></p></div>
  return <><h2>Sign in</h2><form className="tracking-form" onSubmit={async event=>{event.preventDefault();const email=String(new FormData(event.currentTarget).get('email')??'').trim();await requestLink(email)}}><label>Email address<input name="email" type="email" autoComplete="email" required/></label><button disabled={busy}>{busy?'Sending...':'Email me a sign-in link'}</button></form><details className="password-option"><summary>Use a password instead</summary><form className="tracking-form" onSubmit={submit('/auth/password-sign-in',()=>window.location.reload())}><label>Email address<input name="email" type="email" autoComplete="email" required/></label><label>Password<input name="password" type="password" minLength={8} autoComplete="current-password" required/></label><button disabled={busy}>Sign in</button></form></details><p className="field-help">New here? Start with an email sign-in link, then add a password in Settings if you prefer.</p><p className="guest-terms">By creating an account you agree to the <a href="#terms">Terms</a> and confirm you are 16 or older.</p>{error&&<p role="alert">{error}</p>}<p className="guest-legal"><a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies</a> · <a href="#roadmap">Site roadmap</a></p></>
}
export default function InboxPage() {
  const [inbox,setInbox]=useState<{branches:InboxBranch[];yourTurnCount:number;overdueDraftCount:number;dueSoonCount:number;hasMore?:boolean}>(()=>seedInbox()??{branches:[],yourTurnCount:0,overdueDraftCount:0,dueSoonCount:0})
  const [pageOffset,setPageOffset]=useState(0)
  const [loadMoreBusy,setLoadMoreBusy]=useState(false)
  // `query` never carries offset: only loadMore pages, and every other fetch (filters, reload) starts at page 1.
  async function loadMore(){if(loadMoreBusy)return;setLoadMoreBusy(true);try{const next=pageOffset+100;const more=await api<typeof inbox>(`/inbox?${query}&offset=${next}`);setInbox(prev=>({...more,branches:[...prev.branches,...more.branches]}));setPageOffset(next)}catch(problem){setError((problem as Error).message)}finally{setLoadMoreBusy(false)}}
  // The view mirrors itself into the hash as includeArchived=true; archived=1 is the older/command-menu spelling.
  const [filters,setFilters]=useState<InboxFilters>(()=>{const params=new URLSearchParams(window.location.hash.split('?')[1]??'');const status=params.get('status')??'';const archiveView=params.get('archivedOnly')==='true'||status==='archived'?'archived':params.get('archived')==='1'||params.get('includeArchived')==='true'?'all':'active';return{status:status==='archived'?'':status,characterId:params.get('characterId')??'',tagId:params.get('tagId')??'',q:params.get('q')??'',oldestFirst:params.get('oldestFirst')==='true',archiveView}}),[focusMode,setFocusMode]=useState(()=>new URLSearchParams(window.location.hash.split('?')[1]??'').get('doNext')==='true'),[error,setError]=useState(''),[loaded,setLoaded]=useState(()=>Boolean(seedInbox()&&peekCache('/starters/options'))),[busy,setBusy]=useState(false),[sentLink,setSentLink]=useState(false),[sentEmail,setSentEmail]=useState('')
  const [tags,setTags]=useState<{id:string;displayLabel:string}[]>([]),[options,setOptions]=useState<TrackingOptions>(()=>peekCache<TrackingOptions>('/starters/options')??{characters:[],partners:[]})
  const query=new URLSearchParams(); for(const [key,value] of Object.entries(filters)){if(key==='archiveView'||!value||value===false)continue;query.set(key,value===true?'true':String(value))} if(filters.archiveView==='archived')query.set('archivedOnly','true');if(filters.archiveView==='all')query.set('includeArchived','true'); if(focusMode&&filters.archiveView!=='archived')query.set('doNext','true'); query.set('limit','100')
  // Mirror filters into the hash (replaceState: no history entry per keystroke) so
  // Back/Reload and deep-links land on the same view, and the view is shareable.
  // Only the view (filters, Do-next) goes in the address; limit/offset are for the API.
  const viewQs=(()=>{const view=new URLSearchParams(query);view.delete('limit');view.delete('offset');return view.toString()})()
  useEffect(()=>{const raw=window.location.hash.slice(1).split('?')[0];if(!['dashboard','inbox','/inbox'].includes(raw))return;const base='#dashboard';window.history.replaceState(null,'',viewQs?`${base}?${viewQs}`:base)},[viewQs])
  async function reload(){setInbox(await api(`/inbox?${query}`));setPageOffset(0)}
  async function createStarter(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setError('');setBusy(true);const payload:Record<string,FormDataEntryValue|null>=Object.fromEntries(new FormData(event.currentTarget));payload.groupId=payload.groupId||null;payload.partnerBlogIdentifier=payload.partnerBlogIdentifier||null;try{const starter=await api<{id:string}>('/starters','POST',payload);window.location.hash=`starter/${starter.id}`}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}
  useEffect(()=>{let active=true;setError('');
    // Stale-while-revalidate: keep the current inbox while the fresh fetch is in flight;
    // a failed reload keeps the old content and only surfaces the error (no blank page).
    staleGet<typeof inbox>(`/inbox${query.size?`?${query}`:''}`)
      .then(next=>{if(active){setInbox(next);setLoaded(true)}})
      .catch(problem=>{if(active)setError(problem.message)});
    Promise.all([staleGet<TrackingOptions>('/starters/options'),api<{id:string;displayLabel:string}[]>('/tags').catch(()=>[])]).then(([nextOptions,nextTags])=>{if(active){setOptions(nextOptions);setTags(nextTags);setLoaded(true)}}).catch(problem=>{if(active)setError(problem.message)});
    return()=>{active=false}},[filters.status,filters.characterId,filters.tagId,filters.q,filters.oldestFirst,filters.archiveView,focusMode])
  useEffect(()=>{setPageOffset(0)},[filters.status,filters.characterId,filters.tagId,filters.q,filters.oldestFirst,filters.archiveView,focusMode])
  // Persist per-view scroll (Back restores where you were); sessionStorage only, so it dies with the tab.
  useEffect(()=>{try{const view=(window.location.hash.split('?')[0]||'inbox').replace(/^#/,'');const key=`puffin-scroll:${view}`;let timer:number;const save=()=>{window.sessionStorage.setItem(key,String(window.scrollY))};const onScroll=()=>{clearTimeout(timer);timer=window.setTimeout(save,150)};window.addEventListener('scroll',onScroll);return()=>{clearTimeout(timer);window.removeEventListener('scroll',onScroll)}}catch{}},[])
  useEffect(()=>{try{const view=(window.location.hash.split('?')[0]||'inbox').replace(/^#/,'');const key=`puffin-scroll:${view}`;const saved=window.sessionStorage.getItem(key);if(saved&&loaded){const y=Number(saved);if(Number.isFinite(y))window.scrollTo(0,y)}}catch{ /* sessionStorage can be disabled */ }},[loaded])
  async function assignGroup(branchId:string,groupId:string|null){try{await api(`/rp-groups/threads/${branchId}`,'POST',{groupId});await reload()}catch(problem){setError((problem as Error).message)}}
  const needsSignIn=error==='Sign in to see your writing space.'||error.includes("You've been signed out.")
  // Every hook must run before the sign-in early return below: React requires the same hook order on every render (the T8e crash).
  const entered=useEntered(loaded&&inbox.branches.length>0)
  if(needsSignIn||sentLink)return <section className={`guest-landing${sentLink ? ' is-email-confirmation' : ''}`} aria-labelledby="sign-in-title"><div className="guest-copy"><span className="guest-monogram" aria-hidden="true">RP</span><p className="eyebrow">Your new favorite RP companion</p><h1 id="sign-in-title">Keep track of what you owe.</h1><p>Threads, starter ideas, character notes, and the little things that used to live in fifteen open tabs.</p><div className="guest-feature-preview" aria-label="RP Thread Buddy features"><div className="guest-preview-card"><p className="eyebrow">Your turn</p><strong>Two replies are waiting.</strong><span>Moonlight &middot; Juniper</span></div><ul><li><strong>Know what is next</strong><span>Replies are organized by character and RP.</span></li><li><strong>Save every good idea</strong><span>Park plotting notes, asks, and starters for later.</span></li><li><strong>Stay in your writing flow</strong><span>One calm place to check threads and plan what comes next.</span></li></ul></div></div><div className="guest-card"><GuestSignIn busy={busy} setBusy={setBusy} sentLink={sentLink} setSentLink={setSentLink} sentEmail={sentEmail} setSentEmail={setSentEmail}/></div></section>
  const grouped=inbox.branches.reduce<GroupedBranches>((all,branch)=>{const name=branch.groupName??'Unsorted';(all[name]??=[]).push(branch);return all},{})
  const oldestOwedId=focusMode?inbox.branches.find(b=>b.status==='your_turn')?.id:null
  const unsortedBranches=grouped['Unsorted']??[]
  const hasMultipleRps=unsortedBranches.some(b=>b.rpUnsortedReason==='multiple_rps')
  const hasBranches = inbox.branches.length > 0
  const archivedView = filters.archiveView === 'archived'
  // A filtered view with no matches must keep its filters on screen (or there is no way to clear them).
  const filtered = Boolean(filters.status||filters.characterId||filters.tagId||filters.q||filters.oldestFirst||filters.archiveView!=='active'||focusMode)
  return <section aria-labelledby="inbox-title"><div className="inbox-hero"><div className="inbox-hero-copy"><p className="eyebrow">{archivedView?'Your saved scenes':'Reply desk'}</p><h1 id="inbox-title" className="page-heading">{archivedView?'Archived threads':filters.archiveView==='all'?'All tracked threads':'Your turn'}</h1><p className="page-description">{archivedView?'Archived threads stay saved here until you choose to restore them.':filters.archiveView==='all'?'Browse active and archived threads together.':'The scenes waiting on you, sorted by RP and character.'}</p></div>{loaded&&hasBranches&&filters.archiveView==='active'&&<ReplyRun branches={inbox.branches}/>}<a className="quick-add-link" href="#quick-add">+ Add a thread</a></div>
    {error&&<p role="alert">{error}</p>}{!loaded&&<div className="skeletons" aria-hidden="true"><div className="skeleton-row"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /></div></div><div className="skeleton-row"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /></div></div><div className="skeleton-row"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /></div></div></div>}
    {loaded&&!hasBranches&&!filtered&&<div className="empty-state onboarding"><p className="eyebrow">Start your first thread</p><h3>Build a space that keeps up with your stories.</h3><p>Add a character, then save a scene. A link is useful, never required.</p><ol><li><a href="#characters">Add a character</a></li><li>Return here to add a scene</li></ol><button type="button" className="secondary-button" onClick={openOnboardingTour}>Take the optional walkthrough</button></div>}
    {loaded&&(hasBranches||filtered)&&<div className="inbox-summary"><div><button className="do-next" type="button" aria-pressed={focusMode} onClick={()=>setFocusMode(value=>!value)}>{focusMode?'Show all active':'Oldest owed first'}</button><span className="visually-hidden" aria-live="polite">{focusMode?'Showing your oldest owed replies first.':''}</span></div><div className="reminder-summary">{inbox.overdueDraftCount>0&&<a href="#parking-lot">{inbox.overdueDraftCount} overdue {inbox.overdueDraftCount===1?'note':'notes'}</a>}{inbox.dueSoonCount>0&&<span>{inbox.dueSoonCount} check-ins this week</span>}</div><CheckTumblrButton onDone={reload}/><a className="text-action" href="#parking-lot">Parking Lot</a></div>}{loaded&&(hasBranches||filtered)&&<FilterBar filters={filters} options={options} tags={tags} onChange={setFilters}/>}
      {loaded&&<><div className="inbox-workspace">{!hasBranches&&filtered&&<div className="empty-state"><h3>No scenes match these filters</h3><p>Change or clear the filters above.</p></div>}{hasBranches&&<div className="rp-groups" data-entered={entered?'':undefined}>{Object.entries(grouped).map(([group,branches],gi)=><section className="rp-group" style={{'--i':gi} as CSSProperties} key={group}><header className="rp-deck-header"><div>{group!=='Unsorted'&&<p className="eyebrow">RP section</p>}<h3>{group}</h3></div><span className="group-count">{branches.length} {branches.length===1?'scene':'scenes'}</span></header>
        {group==='Unsorted'&&hasMultipleRps&&<p className="rp-unsorted-reason">Some characters here belong to several RP sections. Pick one for each thread below.</p>}
        {group==='Unsorted'&&!hasMultipleRps&&unsortedBranches.some(b=>b.rpUnsortedReason==='no_rps')&&<p className="rp-unsorted-reason"><a href="#characters">Add them to an RP</a> to sort these scenes.</p>}
        <div className="character-stacks">{Object.entries(branches.reduce<GroupedBranches>((all,branch)=>{(all[branch.characterName]??=[]).push(branch);return all},{})).map(([character,items],si)=>{const lead=items[0],owed=items.filter(item=>item.status==='your_turn'&&!item.archivedAt&&item.starterArchived !== 1).length;const lane=filters.archiveView==='archived'?'archived':filters.archiveView==='all'?'tracked':'active';return <article key={character} className="character-stack" style={{'--i':gi*4+si} as CSSProperties}><header className="character-deck-header"><InitialsAvatar name={character} imageUrl={lead.iconObjectKey?`/api/characters/${lead.characterId}/icon`:null}/><span><strong>{character}</strong><small>{items.length} {lane} {items.length===1?'scene':'scenes'}{owed?` · ${owed} ${owed === 1 ? 'reply owed' : 'replies owed'}`:''}</small></span></header><div className="branch-list">{items.map(branch=><div key={`${branch.id}:${branch.notes}:${branch.partnerId}`} className={branch.id===oldestOwedId?'oldest-owed':''}><BranchRow branch={branch} options={options} onChange={reload}/></div>)}</div>
          {group==='Unsorted'&&lead.rpUnsortedReason==='multiple_rps'&&<div className="rp-assign-row"><label className="eyebrow">Assign RP</label><select aria-label={`Assign RP for ${character}`} defaultValue="" onChange={e=>{if(e.target.value)assignGroup(lead.starterId,e.target.value);e.target.value=""}}><option value="" disabled>Pick an RP section…</option>{(options.groups??[]).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div>}
        </article>})}</div></section>)}</div>}{/* The form exists on an empty inbox too: the hero link and onboarding point here. */}<QuickAdd options={options} busy={busy} onSubmit={createStarter}/></div>
      {inbox.hasMore&&<div className="inbox-load-more"><button type="button" disabled={loadMoreBusy} onClick={loadMore}>{loadMoreBusy?'Loading…':'Load more scenes'}</button></div>}</>}
  </section>
}
