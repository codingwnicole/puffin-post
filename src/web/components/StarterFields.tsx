import { useEffect, useState } from 'react'
import { api, type TrackingOptions } from '../lib/api'

type Resolution = { title?:string; suggestedTitle?:string; parsedCharacterNames?:string[]; preview?:string; summary?:string; sourceBlogAssigned:boolean; sourceBlogOwned?:boolean; starterAuthor?:{status:'user'|'partner'|'unresolved';blogIdentifier:string|null;evidence:string}; participants:string[];suggestedPartner?:string|null;titleNeedsPartner?:boolean;characterName?:string; candidates:{characterId:string;characterName:string;characterTag:string|null}[] }
const blogLabel=(value:string)=>value.replace(/\.tumblr\.com$/i,'')

export default function StarterFields({options,title='',characterId='',postUrl:initialPostUrl=''}:{options:TrackingOptions;title?:string;characterId?:string;postUrl?:string}) {
  const [selectedCharacter,setSelectedCharacter]=useState(characterId),[titleValue,setTitleValue]=useState(title),[postUrl,setPostUrl]=useState(initialPostUrl),[description,setDescription]=useState(''),[message,setMessage]=useState(''),[participants,setParticipants]=useState<string[]>([]),[selectedPartner,setSelectedPartner]=useState(''),[manualPartner,setManualPartner]=useState(''),[initialTurn,setInitialTurn]=useState('')
  // Until the writer edits a field themselves, every new suggestion (link, character, partner) replaces it.
  const [titleTouched,setTitleTouched]=useState(Boolean(title)),[resolution,setResolution]=useState<Resolution|null>(null)
  async function resolve(chosenCharacter=selectedCharacter) {
    if(!postUrl.trim()) return
    setMessage('Reading linked post…')
    try {
      const result=await api<Resolution>('/starters/resolve','POST',{postUrl,characterId:chosenCharacter||undefined})
      // A post matched to exactly one character: resolve again as that character so the title has both names.
      if(result.candidates.length===1&&result.candidates[0].characterId!==chosenCharacter){setSelectedCharacter(result.candidates[0].characterId);return resolve(result.candidates[0].characterId)}
      setResolution(result)
      if(!titleTouched&&(result.suggestedTitle||result.title))setTitleValue(result.suggestedTitle||result.title||'')
      // The premise stays the writer's own words: the post's opening lines used to land here and read as a premise
      // nobody wrote. The post is shown beside the field as a reference instead (owner request, redesign phase 2).
      setParticipants(result.participants)
      setSelectedPartner(current=>result.participants.includes(current)?current:result.suggestedPartner??'')
      setManualPartner(current=>current||result.parsedCharacterNames?.find(name=>name.localeCompare(options.characters.find(character=>character.id===chosenCharacter)?.name??'',undefined,{sensitivity:'accent'})!==0)||'')
      if(result.candidates.length===1){setSelectedCharacter(result.candidates[0].characterId);setMessage(`Matched ${result.candidates[0].characterName}. Review the suggested details below.`)}
      else if(result.candidates.length)setMessage('More than one character matches this post. Choose the right one below.')
      else if(result.starterAuthor?.status==='user')setMessage('The original starter is on one of your connected blogs. Choose the character for this scene.')
      else if(result.starterAuthor?.status==='partner')setMessage(`Tumblr confirmed the original starter is on ${blogLabel(result.starterAuthor.blogIdentifier??'')}. Choose the character who owes the reply.`)
      else if(result.sourceBlogOwned)setMessage("This post is from one of your connected blogs, but Tumblr couldn't verify the original starter. Confirm who owes the next reply below.")
      else if(result.starterAuthor?.status==='unresolved')setMessage("Tumblr couldn't verify who wrote the original starter. Confirm who owes the next reply below.")
      else if(!result.sourceBlogAssigned)setMessage("This post isn't from one of your assigned or connected blogs. Choose the character who owes the reply.")
      else setMessage('No character rule matches this post. You can still choose the character yourself.')
    } catch(error) { setMessage((error as Error).message) }
  }
  // Opened with a link (e.g. from Tumblr activity): read the post once, as if it had just been pasted.
  useEffect(()=>{if(initialPostUrl)void resolve()},[])
  return <>
    <label>Scene label <span className="field-help">(Thread Buddy suggests one from a link; edit it freely.)</span><input name="title" required maxLength={300} value={titleValue} onChange={event=>{setTitleTouched(true);setTitleValue(event.target.value)}} placeholder="your character × their character #1"/></label>
    <label>Post or message link <span className="field-help">(optional)</span><input name="postUrl" type="url" maxLength={2000} value={postUrl} onChange={event=>setPostUrl(event.target.value)} onBlur={()=>void resolve()} placeholder="Paste a Tumblr link when you have one"/></label>
    <p className="field-help">A link lets Thread Buddy suggest names and shows the post for reference. No link? Track a Discord or manual scene anyway.</p>
    {/* Always rendered: a live region must exist before it changes, and reserving its space stops the lookup (on blur) from shifting the submit button under the cursor. */}<p role="status" className="field-status">{message}</p>
    <label>Scene premise<textarea name="description" maxLength={20000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Optional, in your own words: what is happening in this scene?"/></label>
    {/* One line either way, so the preview arriving after the link lookup never moves the submit button. */}
    {resolution?.preview||resolution?.summary
      ? <details className="source-preview"><summary>Show the linked post <span className="field-help">(for reference; not saved as your premise)</span></summary><blockquote className="preserve-lines">{resolution.preview||resolution.summary}</blockquote></details>
      : <p className="source-preview source-preview-empty field-help">Paste a link to see the post here for reference.</p>}
    <label>RP section<select name="groupId" defaultValue=""><option value="">Unsorted</option>{options.groups?.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label>Character<select aria-label="Character" name="characterId" required value={selectedCharacter} onChange={event=>{setSelectedCharacter(event.target.value);void resolve(event.target.value)}}><option value="">Choose a character</option>{options.characters.map(character=><option value={character.id} key={character.id}>{character.name}</option>)}</select></label>
    {participants.length>0?<label>Writing partner<select name="partnerBlogIdentifier" value={selectedPartner} onChange={event=>{setSelectedPartner(event.target.value);if(!titleTouched&&resolution?.titleNeedsPartner&&resolution.characterName&&event.target.value)setTitleValue(`${resolution.characterName} × ${blogLabel(event.target.value)}`)}} required><option value="">Choose who this exchange is with</option>{participants.map(blog=><option value={blog} key={blog}>{blogLabel(blog)}</option>)}</select></label>:<label>Writing partner <span className="field-help">(optional)</span><input name="partnerName" maxLength={200} value={manualPartner} onChange={event=>setManualPartner(event.target.value)} placeholder="Their character or display name"/></label>}
    {postUrl&&resolution?.starterAuthor?.status==='unresolved'&&<label>Who owes the next reply?<select name="initialTurn" value={initialTurn} onChange={event=>setInitialTurn(event.target.value)} required><option value="">Choose the turn</option><option value="your_turn">I owe the next reply</option><option value="their_turn">My partner owes the next reply</option></select></label>}
  </>
}
