import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import AddThreadDialog, { starterPayload } from '../components/AddThreadDialog'
import type { InboxBranch } from '../../db/repositories/branches'
import { api, peekCache, staleGet, type TrackingOptions } from '../lib/api'
// ponytail: instant seed only for the unfiltered inbox; filtered views wait for fresh data.
const seedInbox=()=>window.location.hash.includes('?')?undefined:peekCache<{branches:InboxBranch[];yourTurnCount:number;overdueDraftCount:number;dueSoonCount:number}>('/inbox')
import SpinWheel from '../components/SpinWheel'
import BranchRow from '../components/BranchRow'
import CheckTumblrButton from '../components/CheckTumblrButton'
import InitialsAvatar from '../components/InitialsAvatar'
import FilterBar, { type InboxFilters } from '../components/FilterBar'
import { useEntered } from '../lib/motion'
import { openOnboardingTour } from '../components/OnboardingTour'


type GroupedBranches = Record<string, InboxBranch[]>

// Signed-out landing: an RP thread between a writer and the app. Each answer names one of the four things PRODUCT.md
// says set the tracker apart. Words only, by the owner's choice.
const GUEST_THREAD: [worry: string, answer: string, detail: string][] = [
  ['Three people replied to my open starter. Which of them do I owe?', 'Each partner gets their own branch.', 'One starter, three replies, three turns tracked separately, each with its own notes.'],
  ['I always stop updating my tracker after a week.', 'It reads your Tumblr for you', 'and works out whose turn it is as new posts come in.'],
  ['I want my partners to actually meet my characters.', 'Make each of them a trading card', 'and a public page, and share it only if you choose to.'],
  ['Honestly, I just need to sit down and write.', "There's a desk for that.", 'Sprints alone or in a private room, a focus timer, and a Parking Lot for half-written replies.'],
]

// owedTotal: the server's count of every owed reply (the list is paged at 100); pass it only for the unfiltered view.
// Waiting and queued come from the loaded page, so they show "+" when more pages exist.
function ReplyRun({ branches, owedTotal, partial }: { branches: InboxBranch[]; owedTotal?: number; partial: boolean }) {
  const active = branches.filter(branch => branch.status !== 'archived' && !branch.archivedAt && branch.starterArchived !== 1)
  const owed = owedTotal ?? active.filter(branch => branch.status === 'your_turn').length
  const waiting = active.filter(branch => branch.status === 'their_turn').length
  const queued = active.filter(branch => branch.status === 'queued').length
  const more = partial ? '+' : ''
  // Ring geometry: r=36 in a 84-unit box; a 4-unit gap separates the two arcs when both exist. Queued is the bare track.
  const circumference = 2 * Math.PI * 36, total = Math.max(owed + waiting + queued, 1)
  const gap = owed && waiting ? 4 : 0
  const owedLength = Math.max(0, circumference * owed / total - gap), waitingLength = Math.max(0, circumference * waiting / total - gap)
  const yours = active.filter(branch => branch.status === 'your_turn').map(branch => ({ id: branch.id, label: branch.title, href: `#starter/${branch.starterId}` }))
  return <section className="reply-run summary-card" aria-label={`${owed} replies owed, ${waiting}${more} waiting on a partner${queued ? `, ${queued}${more} queued` : ''}`}>
    <div className="reply-donut"><svg viewBox="0 0 84 84" aria-hidden="true"><circle className="ring-track" cx="42" cy="42" r="36" />{owed > 0 && <circle className="ring-owed" cx="42" cy="42" r="36" style={{ strokeDasharray: `${owedLength} ${circumference}` }} />}{waiting > 0 && <circle className="ring-waiting" cx="42" cy="42" r="36" style={{ strokeDasharray: `${waitingLength} ${circumference}`, strokeDashoffset: -(circumference * owed / total) }} />}</svg><strong>{owed}</strong><span>owed</span></div>
    <div><p className="eyebrow">Reply run</p><strong>{owed ? `${owed} scene${owed === 1 ? '' : 's'} on your desk` : 'Your desk is clear'}</strong><p className="summary-legend"><span className="legend-owed">{owed} your turn</span> <span className="legend-waiting">{waiting}{more} waiting on a partner</span>{queued > 0 && <> <span className="legend-queued">{queued}{more} queued</span></>}</p>
      <SpinWheel items={yours} empty="Nothing is your turn here right now. Enjoy the quiet."/></div>
  </section>
}

// Add a thread opens as a dialog whenever the address is #quick-add (the header link, onboarding and the command menu
// all point there). The page owns this one in-page anchor; App.tsx already routes it to the Dashboard.
function QuickAdd({options,busy,error,onSubmit}:{options:TrackingOptions;busy:boolean;error:string;onSubmit:(event:React.FormEvent<HTMLFormElement>)=>void}) {
  const readOpen=()=>window.location.hash==='#quick-add'
  const [open,setOpen]=useState(readOpen)
  useEffect(()=>{const sync=()=>setOpen(readOpen());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync)},[])
  if(!open)return null
  return <AddThreadDialog id="quick-add" options={options} busy={busy} error={error} onSubmit={onSubmit} onClose={()=>{setOpen(false);window.history.replaceState(null,'','#dashboard')}}/>
}

function GuestSignIn({busy,setBusy,sentLink,setSentLink,sentEmail,setSentEmail,emailRef}:{emailRef?:React.Ref<HTMLInputElement>;busy:boolean;setBusy:(value:boolean)=>void;sentLink:boolean;setSentLink:(value:boolean)=>void;sentEmail:string;setSentEmail:(value:string)=>void}) {
  // Own state: the page shows this landing only while its error is the sign-in message, so clearing that here dropped visitors onto an empty inbox.
  const [error,setError]=useState('')
  async function requestLink(email:string) {
    setBusy(true);setError('')
    try { await api('/auth/magic-link','POST',{email});setSentEmail(email);setSentLink(true) }
    catch(problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }
  const submit=(path:string,after:()=>void)=>async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);try{await api(path,'POST',{email:form.get('email'),password:form.get('password')});after()}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}
  if(sentLink)return <div className="email-confirmation" aria-live="polite"><h2>Check your email</h2><p>We sent a one-time sign-in link to <strong>{sentEmail}</strong>. It expires soon and works once.</p>{error&&<p role="alert">{error}</p>}<div className="email-confirmation-actions"><button type="button" disabled={busy} onClick={()=>void requestLink(sentEmail)}>{busy?'Sending...':'Resend sign-in link'}</button><button type="button" className="secondary-button" onClick={()=>{setSentLink(false);setSentEmail('');setError('')}}>Use a different email</button></div><p className="field-help">If it is not in your inbox, check spam or wait a moment before resending.</p><p className="guest-legal"><a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies</a></p></div>
  return <><form className="tracking-form" onSubmit={async event=>{event.preventDefault();const email=String(new FormData(event.currentTarget).get('email')??'').trim();await requestLink(email)}}><label>Email address<input ref={emailRef} name="email" type="email" autoComplete="email" required/></label><button disabled={busy}>{busy?'Sending...':'Email me a sign-in link'}</button></form><details className="password-option"><summary>Use a password instead</summary><form className="tracking-form" onSubmit={submit('/auth/password-sign-in',()=>window.location.reload())}><label>Email address<input name="email" type="email" autoComplete="email" required/></label><label>Password<input name="password" type="password" minLength={8} autoComplete="current-password" required/></label><button disabled={busy}>Sign in</button></form></details><p className="guest-terms">By creating an account you agree to the <a href="#terms">Terms</a> and confirm you are 16 or older.</p>{error&&<p role="alert">{error}</p>}</>
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
  // flushSync: a scene move (lib/motion.ts) snapshots the list right after this resolves, so the new list must be committed by then.
  async function reload(){const next=await api<typeof inbox>(`/inbox?${query}`);flushSync(()=>{setInbox(next);setPageOffset(0)})}
  async function createStarter(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setError('');setBusy(true);const payload=starterPayload(event.currentTarget);try{const starter=await api<{id:string}>('/starters','POST',payload);window.location.hash=`starter/${starter.id}`}catch(problem){setError((problem as Error).message)}finally{setBusy(false)}}
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
  const guestEmailRef=useRef<HTMLInputElement>(null)
  if(needsSignIn||sentLink)return <section className={`guest-landing thread-landing${sentLink ? ' is-email-confirmation' : ''}`} aria-labelledby="sign-in-title">
    <div className="guest-copy"><h1 id="sign-in-title">Know whose <span className="nowrap">turn it is,</span> <span className="nowrap">on every thread.</span></h1><p className="guest-lede">A free RP thread tracker and writing desk, in beta. It starts with Tumblr.</p></div>
    {/* The last post in the thread is the writer's turn: signing in. */}
    <div className="guest-card thread-slip">{!sentLink && <><h2><span className="thread-slip-turn">Your turn:</span> sign in or start free</h2><p className="thread-slip-note">We email you a one-time link. New accounts start the same way.</p></>}<GuestSignIn busy={busy} setBusy={setBusy} sentLink={sentLink} setSentLink={setSentLink} sentEmail={sentEmail} setSentEmail={setSentEmail} emailRef={guestEmailRef}/></div>
    <ol className="guest-thread" aria-label="What RP Thread Buddy does">
      {GUEST_THREAD.flatMap(([worry, answer, detail], index) => [
        <li key={`you-${index}`} className="thread-post is-you" style={{ '--i': index * 2 } as CSSProperties}><span className="thread-who is-you">You</span><p>{worry}</p></li>,
        <li key={`app-${index}`} className="thread-post is-app" style={{ '--i': index * 2 + 1 } as CSSProperties}><span className="thread-who is-app">Thread Buddy</span><p><strong>{answer}</strong> {detail}</p></li>,
      ])}
      {!sentLink && <li className="thread-post is-you is-last" style={{ '--i': GUEST_THREAD.length * 2 } as CSSProperties}><span className="thread-who is-you">You</span><p><button type="button" className="thread-turn" onClick={() => { guestEmailRef.current?.scrollIntoView({ block: 'center' }); guestEmailRef.current?.focus() /* focus is one of the allowed direct DOM uses */ }}>Your turn: sign in or start free</button></p></li>}
    </ol>
    {!sentLink && <p className="thread-foot">New here? Start with an email link, then add a password in Settings if you prefer. <span className="thread-foot-links"><a href="#terms">Terms</a> · <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies</a> · <a href="#roadmap">Site roadmap</a></span></p>}
  </section>
  const grouped=inbox.branches.reduce<GroupedBranches>((all,branch)=>{const name=branch.groupName??'Unsorted';(all[name]??=[]).push(branch);return all},{})
  const oldestOwedId=focusMode?inbox.branches.find(b=>b.status==='your_turn')?.id:null
  const unsortedBranches=grouped['Unsorted']??[]
  const hasMultipleRps=unsortedBranches.some(b=>b.rpUnsortedReason==='multiple_rps')
  const hasBranches = inbox.branches.length > 0
  const archivedView = filters.archiveView === 'archived'
  // A filtered view with no matches must keep its filters on screen (or there is no way to clear them).
  const owedBranches = inbox.branches.filter(branch => branch.status === 'your_turn' && !branch.archivedAt && branch.starterArchived !== 1)
  const oldestWait = owedBranches.reduce((oldest, branch) => branch.lastActivityAt ? Math.max(oldest, Date.now() - Date.parse(branch.lastActivityAt)) : oldest, 0)
  const oldestDays = Math.floor(oldestWait / 86_400_000)
  const filtered = Boolean(filters.status||filters.characterId||filters.tagId||filters.q||filters.oldestFirst||filters.archiveView!=='active'||focusMode)
  const owedCount = filtered ? owedBranches.length : Math.max(inbox.yourTurnCount, owedBranches.length)
  const owedSentence = owedCount ? `You owe ${owedCount} ${owedCount === 1 ? 'reply' : 'replies'}.${oldestDays >= 1 ? ` The oldest has waited ${oldestDays} ${oldestDays === 1 ? 'day' : 'days'}.` : ''}` : 'Nothing is waiting on you right now.'
  // Owed now: on the active, unfocused view, your-turn scenes come first (oldest first) and the RP groups below hold the rest.
  const owedLane = filters.archiveView === 'active' && !focusMode && owedBranches.length > 0
  const activityTime = (branch: InboxBranch) => branch.lastActivityAt ? Date.parse(branch.lastActivityAt) : Date.now()
  const owedSorted = owedLane ? [...owedBranches].sort((a, b) => activityTime(a) - activityTime(b)) : []
  const owedIds = new Set(owedSorted.map(branch => branch.id))
  const restGrouped = owedLane ? Object.fromEntries(Object.entries(grouped).map(([name, items]) => [name, items.filter(branch => !owedIds.has(branch.id))]).filter(([, items]) => items.length > 0)) as GroupedBranches : grouped
  return <section aria-labelledby="inbox-title" className="rd-dashboard"><div className="inbox-hero"><div className="inbox-hero-copy"><h1 id="inbox-title" className="page-heading">{archivedView?'Archived threads':filters.archiveView==='all'?'All tracked threads':'Your turn'}</h1><p className="page-description">{archivedView?'Archived threads stay saved here until you choose to restore them.':filters.archiveView==='all'?'Browse active and archived threads together.':(loaded && hasBranches ? <>{owedSentence} <span className="page-description-rest">{owedLane?'Owed scenes first, then the rest by RP and character.':'Sorted by RP and character.'}</span></> : 'The scenes waiting on you, sorted by RP and character.')}</p></div>{loaded&&hasBranches&&filters.archiveView==='active'&&<ReplyRun branches={inbox.branches} owedTotal={filtered ? undefined : inbox.yourTurnCount} partial={Boolean(inbox.hasMore)}/>}<a className="quick-add-link" href="#quick-add">+ Add a thread</a></div>
    {error&&<p role="alert">{error}</p>}{!loaded&&<div className="skeletons" aria-hidden="true"><div className="skeleton-row"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /></div></div><div className="skeleton-row"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /></div></div><div className="skeleton-row"><div className="skeleton-line skeleton-line-avatar" /><div className="skeleton-lines"><div className="skeleton-line" /><div className="skeleton-line skeleton-line-short" /></div></div></div>}
    {loaded&&!hasBranches&&!filtered&&<div className="empty-state onboarding"><p className="eyebrow">Start your first thread</p><h3>Build a space that keeps up with your stories.</h3><p>Add a character, then save a scene. A link is useful, never required.</p><ol><li><a href="#characters">Add a character</a></li><li>Return here to add a scene</li></ol><button type="button" className="secondary-button" onClick={openOnboardingTour}>Take the optional walkthrough</button></div>}
    {loaded&&(hasBranches||filtered)&&<div className="inbox-summary"><div><button className="do-next" type="button" aria-pressed={focusMode} onClick={()=>setFocusMode(value=>!value)}>{focusMode?'Show all active':'Oldest owed first'}</button><span className="visually-hidden" aria-live="polite">{focusMode?'Showing your oldest owed replies first.':''}</span></div><div className="reminder-summary">{inbox.overdueDraftCount>0&&<a href="#parking-lot">{inbox.overdueDraftCount} overdue {inbox.overdueDraftCount===1?'note':'notes'}</a>}{inbox.dueSoonCount>0&&<span>{inbox.dueSoonCount} check-ins this week</span>}</div><CheckTumblrButton onDone={reload}/><a className="text-action" href="#parking-lot">Parking Lot</a></div>}{loaded&&(hasBranches||filtered)&&<FilterBar filters={filters} options={options} tags={tags} onChange={setFilters}/>}
      {loaded&&<><div className="inbox-workspace">{!hasBranches&&filtered&&<div className="empty-state"><h3>No scenes match these filters</h3><p>Change or clear the filters above.</p></div>}{owedLane&&<section className="owed-lane" aria-labelledby="owed-title"><header className="owed-lane-header"><h2 id="owed-title">Owed now</h2><span className="group-count">{owedSorted.length} {owedSorted.length===1?'scene':'scenes'} · oldest first</span></header><div className="branch-list">{owedSorted.map(branch=><BranchRow key={`${branch.id}:${branch.notes}:${branch.partnerId}`} branch={branch} options={options} onChange={reload}/>)}</div></section>}
        {owedLane&&Object.keys(restGrouped).length>0&&<h2 className="rest-heading">Waiting and queued, by RP</h2>}
        {hasBranches&&<div className="rp-groups" data-entered={entered?'':undefined}>{Object.entries(restGrouped).map(([group,branches],gi)=><section className="rp-group" style={{'--i':gi} as CSSProperties} key={group}><header className="rp-deck-header"><div>{group!=='Unsorted'&&<p className="eyebrow">RP section</p>}<h3>{group}</h3></div><span className="group-count">{branches.length} {branches.length===1?'scene':'scenes'}</span></header>
        {group==='Unsorted'&&hasMultipleRps&&<p className="rp-unsorted-reason">Some characters here belong to several RP sections. Pick one for each thread below.</p>}
        {group==='Unsorted'&&!hasMultipleRps&&unsortedBranches.some(b=>b.rpUnsortedReason==='no_rps')&&<p className="rp-unsorted-reason"><a href="#characters">Add them to an RP</a> to sort these scenes.</p>}
        <div className="character-stacks">{Object.entries(branches.reduce<GroupedBranches>((all,branch)=>{(all[branch.characterName]??=[]).push(branch);return all},{})).map(([character,items],si)=>{const lead=items[0],owed=items.filter(item=>item.status==='your_turn'&&!item.archivedAt&&item.starterArchived !== 1).length;const lane=filters.archiveView==='archived'?'archived':filters.archiveView==='all'?'tracked':'active';return <article key={character} className="character-stack" style={{'--i':gi*4+si} as CSSProperties}><header className="character-deck-header"><InitialsAvatar name={character} imageUrl={lead.iconObjectKey?`/api/characters/${lead.characterId}/icon`:null}/><span><strong>{character}</strong><small>{items.length} {lane} {items.length===1?'scene':'scenes'}{owed?` · ${owed} ${owed === 1 ? 'reply owed' : 'replies owed'}`:''}</small></span></header><div className="branch-list">{items.map(branch=><div key={`${branch.id}:${branch.notes}:${branch.partnerId}`} className={branch.id===oldestOwedId?'oldest-owed':''}><BranchRow branch={branch} options={options} onChange={reload} showAvatar={false}/></div>)}</div>
          {group==='Unsorted'&&lead.rpUnsortedReason==='multiple_rps'&&<div className="rp-assign-row"><label className="eyebrow">Assign RP</label><select aria-label={`Assign RP for ${character}`} defaultValue="" onChange={e=>{if(e.target.value)assignGroup(lead.starterId,e.target.value);e.target.value=""}}><option value="" disabled>Pick an RP section…</option>{(options.groups??[]).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></div>}
        </article>})}</div></section>)}</div>}{/* The form exists on an empty inbox too: the hero link and onboarding point here. */}<QuickAdd options={options} busy={busy} error={error} onSubmit={createStarter}/></div>
      {inbox.hasMore&&<div className="inbox-load-more"><button type="button" disabled={loadMoreBusy} onClick={loadMore}>{loadMoreBusy?'Loading…':'Load more scenes'}</button></div>}</>}
  </section>
}
