import { useEffect,useRef,useState } from 'react'
import { useNativeDialog } from '../lib/dialog'

export function openOnboardingTour(){window.dispatchEvent(new Event('rptb:open-onboarding'))}

const steps=[
  {title:'Your dashboard is the reply desk',body:'The dashboard gathers active scenes, groups them by RP and character, and puts your oldest owed replies within reach.',example:'Example RP: Moonlit Hours · Example character: Wren',href:'#dashboard',link:'See the dashboard'},
  {title:'Characters and RP sections',body:'Create a character, add an RP section, then assign the character. Those assignments keep threads and stats organized.',example:'Wren → Moonlit Hours · No demo records are created by this tour.',href:'#characters',link:'Open Characters'},
  {title:'Track a thread',body:'Paste a Tumblr link to read available post structure, or save a manual scene. Thread cards keep the stable premise separate from the latest reply.',example:'Wren × Rowan · "A late train brings them back to the same station."',href:'#quick-add',link:'Add a thread'},
  {title:'Know whose turn it is',body:'Turn badges show whether you owe a reply or are waiting. Archive a thread to keep it saved without counting it as active.',example:'Your turn · Their turn · Archived',href:'#dashboard',link:'Explore the dashboard'},
  {title:'Park ideas for later',body:'Save plotting notes, draft replies, starter ideas, and reminders in the Parking Lot. They stay separate from tracked thread metadata.',example:'A place for the good idea you had while brushing your teeth.',href:'#parking-lot',link:'Open the Parking Lot'},
  {title:'Make reminders yours',body:'Settings hold appearance, account, and browser notification controls. Notifications are optional, and Discord remains a future integration.',example:'Turn browser reminders on only if they fit your workflow.',href:'#settings',link:'Open Settings'},
]

export default function OnboardingTour({open,onClose}:{open:boolean;onClose:()=>void}){
  const [step,setStep]=useState(()=>{try{return Math.min(steps.length-1,Math.max(0,Number(sessionStorage.getItem('rptb-tour-step'))||0))}catch{return 0}})
  const ref=useRef<HTMLDialogElement>(null)
  useNativeDialog(ref,open)
  useEffect(()=>{if(!open)return;try{sessionStorage.setItem('rptb-tour-open','1');sessionStorage.setItem('rptb-tour-step',String(step))}catch{}},[open,step])
  if(!open)return null
  const close=(completed=false)=>{try{sessionStorage.removeItem('rptb-tour-open');if(completed)localStorage.setItem('rptb-tour-completed','v1')}catch{}if(ref.current?.open)ref.current.close();onClose()}
  const current=steps[step]
  return <dialog ref={ref} className="modal-overlay onboarding-overlay" aria-labelledby="tour-title" aria-describedby="tour-description" onCancel={event=>{event.preventDefault();close()}} onClick={event=>{if(event.target===event.currentTarget)close()}}><div className="modal-card onboarding-tour">
    <div className="tour-topline"><p className="eyebrow">Welcome to RP Thread Buddy</p><button type="button" className="text-button" onClick={()=>close()}>Exit tour</button></div>
    <p className="field-help">Step {step+1} of {steps.length}</p><h2 id="tour-title">{current.title}</h2><p id="tour-description">{current.body}</p><div className="tour-example"><strong>Example</strong><p>{current.example}</p></div><a className="button secondary-button tour-link" href={current.href}>{current.link}</a>
    <div className="tour-controls"><button type="button" className="secondary-button" disabled={step===0} onClick={()=>setStep(value=>Math.max(0,value-1))}>Back</button><div><button type="button" className="text-button" onClick={()=>close()}>Skip</button>{step<steps.length-1?<button type="button" onClick={()=>setStep(value=>value+1)}>Next</button>:<button type="button" onClick={()=>close(true)}>Finish tour</button>}</div></div>
  </div></dialog>
}
