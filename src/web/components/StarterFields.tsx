import { useState } from 'react'
import { api, type TrackingOptions } from '../lib/api'

type Resolution = { title?:string; suggestedTitle?:string; preview?:string; sourceBlogAssigned:boolean; participants:string[]; candidates:{characterId:string;characterName:string;characterTag:string|null}[] }
const blogLabel=(value:string)=>value.replace(/\.tumblr\.com$/i,'')

export default function StarterFields({options,title='',characterId=''}:{options:TrackingOptions;title?:string;characterId?:string}) {
  const [selectedCharacter,setSelectedCharacter]=useState(characterId),[titleValue,setTitleValue]=useState(title),[postUrl,setPostUrl]=useState(''),[description,setDescription]=useState(''),[message,setMessage]=useState(''),[participants,setParticipants]=useState<string[]>([]),[selectedPartner,setSelectedPartner]=useState('')
  async function resolve(chosenCharacter=selectedCharacter) {
    if(!postUrl.trim()) return
    setMessage('Reading linked post…')
    try {
      const result=await api<Resolution>('/starters/resolve','POST',{postUrl,characterId:chosenCharacter||undefined})
      if(!titleValue&&(result.suggestedTitle||result.title))setTitleValue(result.suggestedTitle||result.title||'')
      if(!description&&result.preview)setDescription(result.preview)
      setParticipants(result.participants)
      setSelectedPartner(current=>result.participants.length===1?result.participants[0]:result.participants.includes(current)?current:'')
      if(result.candidates.length===1){setSelectedCharacter(result.candidates[0].characterId);setMessage(`Matched ${result.candidates[0].characterName}. Review the suggested details below.`)}
      else if(result.candidates.length)setMessage('More than one character matches this post. Choose the right one below.')
      else if(!result.sourceBlogAssigned)setMessage("This looks like another writer's starter. Choose the character who owes the reply.")
      else setMessage('No character rule matches this post. You can still choose the character yourself.')
    } catch(error) { setMessage((error as Error).message) }
  }
  return <>
    <label>Scene label <span className="field-help">(Puffin suggests one from a link; edit it freely.)</span><input name="title" required maxLength={300} value={titleValue} onChange={event=>setTitleValue(event.target.value)} placeholder="your character × their character #1"/></label>
    <label>Post or message link <span className="field-help">(optional)</span><input name="postUrl" type="url" maxLength={2000} value={postUrl} onChange={event=>setPostUrl(event.target.value)} onBlur={()=>void resolve()} placeholder="Paste a Tumblr link when you have one"/></label>
    <p className="field-help">A link lets Puffin suggest names and a premise. No link? Track a Discord or manual scene anyway.</p>
    {message&&<p role="status">{message}</p>}
    <label>Scene premise<textarea name="description" maxLength={20000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Optional: what is happening in this scene?"/></label>
    <label>RP section<select name="groupId" defaultValue=""><option value="">Unsorted</option>{options.groups?.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label>Character<select aria-label="Character" name="characterId" required value={selectedCharacter} onChange={event=>{setSelectedCharacter(event.target.value);void resolve(event.target.value)}}><option value="">Choose a character</option>{options.characters.map(character=><option value={character.id} key={character.id}>{character.name}</option>)}</select></label>
    {participants.length>0?<label>Writing partner<select name="partnerBlogIdentifier" value={selectedPartner} onChange={event=>setSelectedPartner(event.target.value)} required><option value="">Choose who this exchange is with</option>{participants.map(blog=><option value={blog} key={blog}>{blogLabel(blog)}</option>)}</select></label>:<label>Writing partner <span className="field-help">(optional)</span><input name="partnerName" maxLength={200} placeholder="Their character or display name"/></label>}
  </>
}
