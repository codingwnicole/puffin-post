import { expect, test } from '@playwright/test'

const APP='http://localhost:5173'
test.use({baseURL:APP})

test('check-your-email stays composed on desktop and mobile and recovers from invalid input or delivery errors',async({browser})=>{
  const context=await browser.newContext({baseURL:APP,viewport:{width:1440,height:900}})
  const page=await context.newPage()
  let sends=0,failDelivery=false
  await page.route('**/api/auth/magic-link',async route=>{
    sends++
    if(failDelivery) await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Email delivery is temporarily unavailable.'})})
    else await route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({ok:true})})
  })
  await page.goto('/')
  const email=page.getByRole('textbox',{name:'Email address'}).first()
  const submit=page.getByRole('button',{name:'Email me a sign-in link'})
  await email.fill('not-an-email')
  await submit.click()
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false)
  expect(sends).toBe(0)

  await email.fill('writer@example.test')
  await submit.click()
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible()
  await expect(page.getByText('writer@example.test')).toBeVisible()
  for(const width of [320,375,430,768,1024,1440,1920]){
    await page.setViewportSize({width,height:900})
    const layout=await page.evaluate(()=>{
      const copy=document.querySelector('.guest-copy')!.getBoundingClientRect()
      const card=document.querySelector('.guest-card')!.getBoundingClientRect()
      return {copyRight:copy.right,copyBottom:copy.bottom,cardLeft:card.left,cardTop:card.top,viewport:innerWidth,scroll:document.documentElement.scrollWidth}
    })
    expect(layout.scroll,`horizontal overflow at ${width}px`).toBeLessThanOrEqual(layout.viewport)
    if(width<=760) expect(layout.cardTop,`confirmation should stack at ${width}px`).toBeGreaterThan(layout.copyBottom-1)
    else expect(layout.cardLeft,`confirmation should align beside the copy at ${width}px`).toBeGreaterThan(layout.copyRight)
    expect(layout.cardTop,`confirmation should start within the first screen at ${width}px`).toBeLessThan(900)
  }

  await page.getByRole('button',{name:'Resend sign-in link'}).click()
  await expect.poll(()=>sends).toBe(2)
  await page.getByRole('button',{name:'Use a different email'}).click()
  await expect(page.getByRole('button',{name:'Email me a sign-in link'})).toBeVisible()

  failDelivery=true
  await page.getByRole('textbox',{name:'Email address'}).first().fill('writer@example.test')
  await page.getByRole('button',{name:'Email me a sign-in link'}).click()
  await expect(page.getByRole('alert')).toContainText('Email delivery is temporarily unavailable.')
  await expect(page.getByRole('heading',{name:'Check your email'})).toHaveCount(0)

  failDelivery=false
  await page.setViewportSize({width:375,height:812})
  await page.getByRole('button',{name:'Email me a sign-in link'}).click()
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible()
  const mobile=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,copy:document.querySelector('.guest-copy')!.getBoundingClientRect().bottom,card:document.querySelector('.guest-card')!.getBoundingClientRect().top}))
  expect(mobile.scroll).toBeLessThanOrEqual(mobile.viewport)
  expect(mobile.card).toBeGreaterThan(mobile.copy-1)
  await context.close()
})
