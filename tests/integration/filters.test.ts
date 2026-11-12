import { describe,it,expect,afterEach } from 'vitest'
import { trackingFixture,starterInput } from './tracking-fixture'

describe('combined inbox filters',()=>{
  let dispose:undefined|(()=>Promise<void>)
  afterEach(async()=>{await dispose?.()})
  it('combines character, tag, status, and search inside the active workspace',async()=>{
    const fx=await trackingFixture();dispose=fx.dispose
    const starter=await fx.request('/api/starters','POST',starterInput).then(r=>r.json() as Promise<{id:string}>)
    const tag=await fx.request('/api/tags','POST',{label:'Angst'}).then(r=>r.json() as Promise<{id:string}>)
    await fx.request(`/api/tags/${tag.id}/starters/${starter.id}`,'POST')
    await fx.request(`/api/starters/${starter.id}/branches`,'POST',{partnerId:'partner-a',status:'your_turn'})
    const result=await fx.request(`/api/inbox?characterId=character-a&tagId=${tag.id}&status=your_turn&q=open`)
    expect((await result.json() as {branches:unknown[]}).branches).toHaveLength(1)
    expect((await fx.request(`/api/inbox?tagId=${tag.id}`,'GET',undefined,'b')).status).toBe(200)
    await expect((await fx.request(`/api/inbox?tagId=${tag.id}`,'GET',undefined,'b')).json()).resolves.toMatchObject({branches:[]})
  })
})
