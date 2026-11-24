import { expect, test } from '@playwright/test'

const branch = (status: string) => ({ id:'b1',starterId:'s',title:'Rain on the docks',characterId:'c',characterName:'Writer',partnerLabel:'Friend',partnerId:null,status,notes:'',
  rootPostId:'111',rootBlogId:'writer.tumblr.com',latestPostId:'999',lastPoster:'friend.tumblr.com',starterArchived:0,archivedAt:null,refreshError:null })

test('Open on Tumblr goes to the latest reply on the partner\'s blog, and Check Tumblr now reloads the inbox', async ({ page }) => {
  let status = 'your_turn', refreshes = 0
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') return route.fulfill({ json:{ user:{ id:'u1',name:'Tester' } } })
    if (path === '/api/tumblr-activity/unread-count') return route.fulfill({ json:{ count:0 } })
    if (path === '/api/starters/options') return route.fulfill({ json:{ characters:[{ id:'c',name:'Writer' }],partners:[] } })
    if (path === '/api/inbox') return route.fulfill({ json:{ branches:[branch(status)],yourTurnCount:status === 'your_turn' ? 1 : 0,overdueDraftCount:0,dueSoonCount:0 } })
    if (path === '/api/refresh') {
      refreshes++
      if (refreshes > 1) return route.fulfill({ status:429,contentType:'text/plain',body:'Tumblr was just checked. Try again in 90 seconds.' })
      status = 'their_turn'
      return route.fulfill({ json:{ checked:1,failed:0 } })
    }
    return route.fulfill({ json:[] })
  })
  await page.goto('/')
  const card = page.locator('article.branch-card')
  await card.locator('.scene-card-trigger').click()
  await expect(card.getByRole('link',{ name:'Open on Tumblr' })).toHaveAttribute('href','https://www.tumblr.com/friend/999')
  // Scene details open in a modal drawer; close it to use the page again.
  await page.keyboard.press('Escape')

  await expect(card.locator('.turn-badge')).toHaveText('Your turn')
  await page.getByRole('button',{ name:'Check Tumblr now' }).click()
  await expect(page.getByRole('status').filter({ hasText:'Checked Tumblr just now.' })).toBeVisible()
  await expect(card.locator('.turn-badge')).toHaveText('Their turn')

  await page.getByRole('button',{ name:'Check Tumblr now' }).click()
  await expect(page.getByRole('alert').filter({ hasText:'Try again in 90 seconds' })).toBeVisible()
})
