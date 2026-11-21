import { useState } from 'react'
import { api, type TrackingOptions } from '../lib/api'

type Resolution = { title?:string; suggestedTitle?:string; parsedCharacterNames?:string[]; preview?:string; summary?:string; sourceBlogAssigned:boolean; participants:string[];suggestedPartner?:string|null;titleNeedsPartner?:boolean;characterName?:string; candidates:{characterId:string;characterName:string;characterTag:string|null}[] }
const blogLabel=(value:string)=>value.replace(/\.tumblr\.com$/i,'')

export default function StarterFields({options,title='',characterId=''}:{options:TrackingOptions;title?:string;characterId?:string}) {
  const [selectedCharacter,setSelectedCharacter]=useState(characterId),[titleValue,setTitleValue]=useState(title),[postUrl,setPostUrl]=useState(''),[description,setDescription]=useState(''),[message,setMessage]=useState(''),[participants,setParticipants]=useState<string[]>([]),[selectedPartner,setSelectedPartner]=useState(''),[manualPartner,setManualPartner]=useState('')
  // Until the writer edits a field themselves, every new suggestion (link, character, partner) replaces it.
  const [titleTouched,setTitleTouched]=useState(Boolean(title)),[descriptionTouched,setDescriptionTouched]=useState(false),[resolution,setResolution]=useState<Resolution|null>(null)
  async function resolve(chosenCharacter=selectedCharacter) {
    if(!postUrl.trim()) return
    setMessage('Reading linked post…')
    try {
      const result=await api<Resolution>('/starters/resolve','POST',{postUrl,characterId:chosenCharacter||undefined})
      // A post matched to exactly one character: resolve again as that character so the title has both names.
      if(result.candidates.length===1&&result.candidates[0].characterId!==chosenCharacter){setSelectedCharacter(result.candidates[0].characterId);return resolve(result.candidates[0].characterId)}
      setResolution(result)
      if(!titleTouched&&(result.suggestedTitle||result.title))setTitleValue(result.suggestedTitle||result.title||'')
      if(!descriptionTouched&&(result.summary||result.preview))setDescription(result.summary||result.preview||'')
      setParticipants(result.participants)
      setSelectedPartner(current=>result.participants.includes(current)?current:result.suggestedPartner??'')
      setManualPartner(current=>current||result.parsedCharacterNames?.find(name=>name.localeCompare(options.characters.find(character=>character.id===chosenCharacter)?.name??'',undefined,{sensitivity:'accent'})!==0)||'')
      if(result.candidates.length===1){setSelectedCharacter(result.candidates[0].characterId);setMessage(`Matched ${result.candidates[0].characterName}. Review the suggested details below.`)}
      else if(result.candidates.length)setMessage('More than one character matches this post. Choose the right one below.')
      else if(!result.sourceBlogAssigned)setMessage("This looks like another writer's starter. Choose the character who owes the reply.")
      else setMessage('No character rule matches this post. You can still choose the character yourself.')
    } catch(error) { setMessage((error as Error).message) }
  }
  return <>
    <label>Scene label <span className="field-help">(Thread Buddy suggests one from a link; edit it freely.)</span><input name="title" required maxLength={300} value={titleValue} onChange={event=>{setTitleTouched(true);setTitleValue(event.target.value)}} placeholder="your character × their character #1"/></label>
    <label>Post or message link <span className="field-help">(optional)</span><input name="postUrl" type="url" maxLength={2000} value={postUrl} onChange={event=>setPostUrl(event.target.value)} onBlur={()=>void resolve()} placeholder="Paste a Tumblr link when you have one"/></label>
    <p className="field-help">A link lets Thread Buddy suggest names and a premise. No link? Track a Discord or manual scene anyway.</p>
    {message&&<p role="status">{message}</p>}
    <label>Scene premise<textarea name="description" maxLength={20000} value={description} onChange={event=>{setDescriptionTouched(true);setDescription(event.target.value)}} placeholder="Optional: what is happening in this scene?"/></label>
    <label>RP section<select name="groupId" defaultValue=""><option value="">Unsorted</option>{options.groups?.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <label>Character<select aria-label="Character" name="characterId" required value={selectedCharacter} onChange={event=>{setSelectedCharacter(event.target.value);void resolve(event.target.value)}}><option value="">Choose a character</option>{options.characters.map(character=><option value={character.id} key={character.id}>{character.name}</option>)}</select></label>
    {participants.length>0?<label>Writing partner<select name="partnerBlogIdentifier" value={selectedPartner} onChange={event=>{setSelectedPartner(event.target.value);if(!titleTouched&&resolution?.titleNeedsPartner&&resolution.characterName&&event.target.value)setTitleValue(`${resolution.characterName} × ${blogLabel(event.target.value)}`)}} required><option value="">Choose who this exchange is with</option>{participants.map(blog=><option value={blog} key={blog}>{blogLabel(blog)}</option>)}</select></label>:<label>Writing partner <span className="field-help">(optional)</span><input name="partnerName" maxLength={200} value={manualPartner} onChange={event=>setManualPartner(event.target.value)} placeholder="Their character or display name"/></label>}
  </>
}
