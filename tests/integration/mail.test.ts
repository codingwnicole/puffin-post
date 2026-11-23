import { afterEach, expect, it, vi } from 'vitest'
import { resendMailSender } from '../../src/auth/magic-links'
import type { Env } from '../../src/worker'

afterEach(() => { vi.restoreAllMocks() })

it('sends magic links from MAIL_FROM with replies going to the support inbox', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const env = { RESEND_API_KEY: 'test-key', MAIL_FROM: 'RP Thread Buddy <hello@mail.rpthreadbuddy.app>' } as Env
  await resendMailSender(env).send({ to: 'writer@example.com', url: 'https://rpthreadbuddy.app/api/auth/verify?token=x', html: '' })
  const [url, init] = fetchSpy.mock.calls[0]
  expect(url).toBe('https://api.resend.com/emails')
  expect(JSON.parse(String(init?.body))).toMatchObject({ from: 'RP Thread Buddy <hello@mail.rpthreadbuddy.app>', to: ['writer@example.com'], reply_to: ['support@rpthreadbuddy.app'] })
})
