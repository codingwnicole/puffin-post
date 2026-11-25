import { useEffect, useState } from 'react'
import { api } from '../lib/api'

type Preferences = {
  inAppEnabled: boolean; pushEnabled: boolean; pushDevices: number; globalMuted: boolean;
  notifyReplies: boolean; notifyReminders: boolean; notifyPossibleThreads: boolean; notifyActivityRequirements: boolean;
  timezone: string; quietStartLocal: number | null; quietEndLocal: number | null; emailAvailable: boolean
}

const DEFAULTS: Preferences = { inAppEnabled: true, pushEnabled: false, pushDevices: 0, globalMuted: false, notifyReplies: true, notifyReminders: true, notifyPossibleThreads: true, notifyActivityRequirements: true, timezone: 'UTC', quietStartLocal: null, quietEndLocal: null, emailAvailable: false }

function waitForActive(registration: ServiceWorkerRegistration): Promise<ServiceWorker> {
  if (registration.active?.state === 'activated') return Promise.resolve(registration.active)
  const worker = registration.installing ?? registration.waiting
  if (!worker) return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The notification service did not start. Reload this page, then try again.')), 15_000)
    navigator.serviceWorker.ready.then(ready => {
      window.clearTimeout(timeout)
      if (ready.active?.state === 'activated') resolve(ready.active)
      else reject(new Error('The notification service did not start. Reload this page, then try again.'))
    }, reject)
  })
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('The notification service is still starting. Wait a moment, then try again.')) }, 15_000)
    const changed = () => {
      if (worker.state === 'activated' && registration.active) { window.clearTimeout(timeout); worker.removeEventListener('statechange', changed); resolve(registration.active) }
      else if (worker.state === 'redundant') { window.clearTimeout(timeout); worker.removeEventListener('statechange', changed); reject(new Error('The notification service worker failed to activate. Reload the page and try again.')) }
    }
    worker.addEventListener('statechange', changed)
    changed()
  })
}

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS)
  const [permission, setPermission] = useState<'unsupported'|'default'|'granted'|'denied'>('unsupported')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saveNeeded, setSaveNeeded] = useState(false)

  useEffect(() => {
    let active = true
    if ('Notification' in window) setPermission(Notification.permission)
    void api<Preferences>('/notifications/preferences').then(value => { if (active) { setPrefs(value); setSaveNeeded(false) } }).catch(problem => { if (active) setError((problem as Error).message) })
    return () => { active = false }
  }, [])

  function change<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPrefs(current => ({ ...current, [key]: value })); setSaveNeeded(true); setStatus(''); setError('')
  }

  async function save() {
    setBusy(true); setStatus(''); setError('')
    try { await api('/notifications/preferences', 'PUT', prefs); setSaveNeeded(false); setStatus('Notification preferences saved.') }
    catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function togglePush() {
    setBusy(true); setStatus(''); setError('')
    let subscription: PushSubscription | null = null
    try {
      if (prefs.pushEnabled) {
        const registration = await navigator.serviceWorker.getRegistration('/')
        subscription = await registration?.pushManager.getSubscription() ?? null
        await api('/push/subscription', 'DELETE')
        if (subscription) await subscription.unsubscribe()
        const next = { ...prefs, pushEnabled: false, pushDevices: 0 }
        setPrefs(next); await api('/notifications/preferences', 'PUT', next); setStatus('Browser push is off for this account.')
        return
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support push notifications.')
      if (Notification.permission === 'denied') throw new Error('Notifications are blocked for this site in browser settings. Allow them there, then try again.')
      const permissionResult = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      setPermission(permissionResult)
      if (permissionResult !== 'granted') throw new Error('Allow browser notifications to turn them on.')

      const registration = await navigator.serviceWorker.register('/puffin-post-sw.js', { scope: '/', updateViaCache: 'none' })
      await waitForActive(registration)
      const ready = await navigator.serviceWorker.ready
      const activeRegistration = ready.active?.state === 'activated' ? ready : registration
      if (!activeRegistration.active || activeRegistration.active.state !== 'activated') throw new Error('The notification service worker is not active yet. Wait a moment, then try again.')
      const key = await api<{ publicKey: string }>('/push/public-key')
      const bytes = Uint8Array.from(atob(key.publicKey.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(key.publicKey.length / 4) * 4, '=')), character => character.charCodeAt(0))
      subscription = await activeRegistration.pushManager.getSubscription()
      if (!subscription) subscription = await activeRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
      await api('/push/subscription', 'POST', { endpoint: subscription.endpoint })
      const next = { ...prefs, pushEnabled: true, pushDevices: Math.max(1, prefs.pushDevices) }
      setPrefs(next); await api('/notifications/preferences', 'PUT', next); setStatus('Browser push is connected. Send a test to check this device.')
    } catch (problem) {
      if (subscription) await subscription.unsubscribe().catch(() => undefined)
      try { const saved = await api<Preferences>('/notifications/preferences'); setPrefs(saved) } catch { /* Keep actual push status unknown rather than optimistic. */ }
      setError((problem as Error).message)
    } finally { setBusy(false) }
  }

  async function testPush() {
    setBusy(true); setError(''); setStatus('')
    try {
      if (permission !== 'granted') throw new Error('Allow browser notifications first.')
      const registration = await navigator.serviceWorker.getRegistration('/')
      if (!registration || !registration.active || registration.active.state !== 'activated') throw new Error('This site has no active notification service worker. Turn browser push off and on again.')
      await registration.showNotification('RP Thread Buddy test', { body: 'This browser can show a notification.', icon: '/favicon.svg', tag: 'rp-thread-buddy-test', data: { url: '/#settings' } })
      setStatus('Test notification sent. Check your system notification area.')
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const tz = prefs.timezone || browserTimezone
  return <section className="tracking-card notification-preferences" aria-labelledby="notification-preferences-title">
    <h2 id="notification-preferences-title">Notification preferences</h2>
    <p className="field-help">In-app activity stays available in Tumblr activity. The badge follows your in-app choices. Browser push obeys the category and quiet-hour settings below. Email delivery is not available yet.</p>
    {error && <p role="alert" className="profile-error">{error}</p>}{status && <p role="status" className="success-pulse">{status}</p>}
    <div className="notification-pref-grid">
      <fieldset><legend>Channels</legend><label><input type="checkbox" checked={prefs.inAppEnabled} onChange={event => change('inAppEnabled', event.target.checked)} /> In-app activity badge</label><p className="field-help">Activity records remain available even if the unread badge is off.</p><div className="actions"><button type="button" disabled={busy} onClick={() => void togglePush()}>{busy ? 'Working.' : prefs.pushEnabled ? `Turn off browser push (${prefs.pushDevices} device${prefs.pushDevices === 1 ? '' : 's'})` : 'Turn on browser push'}</button>{prefs.pushEnabled && <button type="button" className="secondary-button" disabled={busy} onClick={() => void testPush()}>Send test</button>}</div><p className="field-help">Browser permission: {permission}. Push is shown as on only after a subscription is saved.</p><label>Email notifications<input type="checkbox" checked={false} disabled aria-describedby="email-not-available" /></label><span id="email-not-available" className="field-help">Unavailable — email alerts have no delivery producer yet.</span></fieldset>
      <fieldset><legend>Alert categories</legend>{([
        ['notifyReplies','Replies owed'], ['notifyReminders','Thread and draft reminders'], ['notifyPossibleThreads','Tumblr activity and possible threads'], ['notifyActivityRequirements','RP activity requirements'],
      ] as const).map(([key,label]) => <label key={key}><input type="checkbox" checked={prefs[key]} onChange={event => change(key, event.target.checked)} /> {label}</label>)}<p className="field-help">Connection warnings, sprint invitations, and sprint reminders do not have notification events yet.</p></fieldset>
      <fieldset><legend>Timing</legend><label><input type="checkbox" checked={prefs.globalMuted} onChange={event => change('globalMuted', event.target.checked)} /> Pause all browser push</label><label>Time zone<select value={tz} onChange={event => change('timezone', event.target.value)}><option value={tz}>{tz}</option>{browserTimezone !== tz && <option value={browserTimezone}>{browserTimezone} (this device)</option>}<option value="UTC">UTC</option></select></label><div className="notification-quiet-row"><label>Quiet hours start<select value={prefs.quietStartLocal ?? ''} onChange={event => change('quietStartLocal', event.target.value === '' ? null : Number(event.target.value))}><option value="">Off</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2,'0')}:00</option>)}</select></label><label>Quiet hours end<select value={prefs.quietEndLocal ?? ''} onChange={event => change('quietEndLocal', event.target.value === '' ? null : Number(event.target.value))}><option value="">Off</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2,'0')}:00</option>)}</select></label></div><p className="field-help">Quiet hours use whole local hours. Set both times or leave both off. Current browser time zone: {browserTimezone}.</p></fieldset>
    </div>
    <div className="actions"><button type="button" disabled={busy || !saveNeeded} onClick={() => void save()}>{busy ? 'Saving.' : 'Save preferences'}</button></div>
  </section>
}
