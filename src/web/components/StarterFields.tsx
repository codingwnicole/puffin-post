import type { TrackingOptions } from '../lib/api'

export default function StarterFields({ options, title = '', characterId = '' }: { options:TrackingOptions; title?:string; characterId?:string }) {
  return <>
    <label>Starter title<input name="title" required maxLength={300} defaultValue={title} /></label>
    <label>Character<select aria-label="Character" name="characterId" required defaultValue={characterId}><option value="">Choose a character</option>
      {options.characters.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
    <label>Tumblr blog<input name="rootBlogId" required maxLength={200} placeholder="your-blog.tumblr.com" /></label>
    <label>Tumblr post ID<input name="rootPostId" required inputMode="numeric" pattern="[0-9]{1,30}" /></label>
  </>
}
