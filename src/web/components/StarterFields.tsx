import { useState } from 'react'
import { api, type TrackingOptions } from '../lib/api'

type Resolution = {
  title?:string
  suggestedTitle?:string
  preview?:string
  sourceBlogIdentifier:string
  sourceBlogAssigned:boolean
  participants:string[]
  tags:string[]
  candidates:{ characterId:string; characterName:string; characterTag:string|null }[]
}
const blogLabel = (value:string) => value.replace(/\.tumblr\.com$/i, '')

export default function StarterFields({ options, title = '', characterId = '' }: { options:TrackingOptions; title?:string; characterId?:string }) {
  const [selectedCharacter, setSelectedCharacter] = useState(characterId)
  const [titleValue, setTitleValue] = useState(title)
  const [postUrl, setPostUrl] = useState('')
  const [message, setMessage] = useState('')
  const [participants, setParticipants] = useState<string[]>([])
  const [selectedPartner, setSelectedPartner] = useState('')

  async function resolve(chosenCharacter = selectedCharacter) {
    if (!postUrl.trim()) return
    setMessage('Checking Tumblr post.')
    try {
      const result = await api<Resolution>('/starters/resolve', 'POST', { postUrl, characterId:chosenCharacter || undefined })
      if (!titleValue && (result.suggestedTitle || result.title)) setTitleValue(result.suggestedTitle || result.title || '')
      setParticipants(result.participants)
      // One possible partner can be selected for the writer. More than one is a real
      // tracking decision, so leave it blank and ask rather than guessing.
      setSelectedPartner(current => result.participants.length === 1 ? result.participants[0] : result.participants.includes(current) ? current : '')
      if (result.candidates.length === 1) {
        setSelectedCharacter(result.candidates[0].characterId)
        setMessage(`Matched ${result.candidates[0].characterName}${result.candidates[0].characterTag ? ` via #${result.candidates[0].characterTag}` : ''}.`)
      } else if (result.candidates.length) setMessage('More than one character matches this post. Choose the right one below.')
      else if (!result.sourceBlogAssigned) setMessage(result.participants.length > 1 ? "Puffin found several possible writing partners. Choose the one for this exchange." : "This is another writer's starter. Choose the character who owes the reply.")
      else setMessage('No character rule matches this post. Check the character tag in Tumblr connections.')
    } catch (error) { setMessage((error as Error).message) }
  }

  return <>
    <label>Scene label <span className="field-help">(Puffin suggests one from the post; edit it freely.)</span><input name="title" maxLength={300} value={titleValue} onChange={event => setTitleValue(event.target.value)} placeholder="your character × their character #1 — premise" /></label>
    <label>Tumblr post or reply link<input name="postUrl" type="url" required maxLength={2000} value={postUrl} onChange={event => setPostUrl(event.target.value)} onBlur={() => void resolve()} placeholder="https://your-blog.tumblr.com/post/…" /></label>
    <p className="field-help">Paste the Tumblr link. Puffin Post reads the blog, post, tags, and reblog chain for you.</p>
    {message && <p role="status">{message}</p>}
    <label>RP section<select name="groupId" defaultValue=""><option value="">Unsorted</option>{options.groups?.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label>Character<select aria-label="Character" name="characterId" required value={selectedCharacter} onChange={event => { setSelectedCharacter(event.target.value); void resolve(event.target.value) }}><option value="">Choose a character</option>{options.characters.map(character => <option value={character.id} key={character.id}>{character.name}</option>)}</select></label>
    {participants.length > 0 && <label>Writing partner<select name="partnerBlogIdentifier" value={selectedPartner} onChange={event => setSelectedPartner(event.target.value)} required><option value="">Choose who this exchange is with</option>{participants.map(blog => <option value={blog} key={blog}>{blogLabel(blog)}</option>)}</select></label>}
  </>
}
