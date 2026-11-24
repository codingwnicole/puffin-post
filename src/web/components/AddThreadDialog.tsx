import { useRef, type FormEvent } from 'react'
import type { TrackingOptions } from '../lib/api'
import { useNativeDialog } from '../lib/dialog'
import StarterFields from './StarterFields'

/** The one Add a thread form, as a dialog. Used by the Dashboard (#quick-add) and by Tumblr activity's "Add to
 * tracker", so tracking a scene is the same process everywhere. A post link prefills what Thread Buddy can read;
 * the premise always starts empty (the post is shown as a reference, see StarterFields). */
export default function AddThreadDialog({ id = 'add-thread', options, busy, error, source, postUrl, characterId, onSubmit, onClose }: {
  id?: string; options: TrackingOptions; busy: boolean; error: string; source?: string; postUrl?: string; characterId?: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useNativeDialog(dialogRef)
  const titleId = `${id}-title`
  return <dialog ref={dialogRef} className="quick-add-panel add-thread-dialog" id={id} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="add-thread-head"><div><h2 id={titleId}>Add a thread</h2><p>{source ?? 'Track Tumblr, Discord, or an entirely manual scene. With a post link, Thread Buddy reads the participants and shows the post for reference; without one, it saves the scene you describe.'}</p></div><button type="button" className="secondary-button" onClick={onClose}>Close</button></div>
    <form className="tracking-form" onSubmit={onSubmit}><StarterFields options={options} characterId={characterId} postUrl={postUrl} />{error && <p role="alert">{error}</p>}<div className="actions"><button disabled={busy}>{busy ? 'Adding thread...' : 'Add thread'}</button><button type="button" className="secondary-button" onClick={onClose}>Cancel</button></div></form>
  </dialog>
}

/** Turns the form into the POST /starters body, exactly as the Dashboard always has. */
export function starterPayload(form: HTMLFormElement) {
  const payload: Record<string, FormDataEntryValue | null> = Object.fromEntries(new FormData(form))
  payload.groupId = payload.groupId || null
  payload.partnerBlogIdentifier = payload.partnerBlogIdentifier || null
  return payload
}
