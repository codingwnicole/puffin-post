import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type TrackingOptions } from '../lib/api'
import { acquireSprintLock, deleteLocalSprint, getLocalSprint, listLocalSprints, saveLocalSprint } from '../lib/sprint-drafts'
import { countWords, creditedWordCount, makeReplySegment, sprintTotals, updateCreditMask, type LocalSprint, type ReplySegment, type SprintPhase, type SprintKind } from '../../shared/writing-sprints'
import SprintStats from '../components/SprintStats'

interface SprintHistory {
  id: string; title: string; kind: SprintKind; startedAt: string; endedAt: string
  durationSeconds: number; wordsCredited: number; repliesCompleted: number; goalWords: number | null; participantCount: number
}
interface ThreadOption { id: string; starterId: string; title: string; characterName?: string | null; partnerName?: string | null }
interface RoomParticipant { id: string; name: string; connected: boolean; wordsCredited: number; repliesCompleted: number; isHost: boolean }
interface RoomRound {
  number: number; startedAt: number | null; endedAt: number; durationSeconds: number
  participants: Array<{ id: string; name: string; wordsCredited: number; repliesCompleted: number }>
}
interface RoomState {
  roomId: string; name: string; hostId: string; durationSeconds: number; goalWords: number | null; participantLimit: number
  status: 'waiting' | 'running' | 'paused' | 'finished'; roundNumber: number; roundStartedAt: number | null
  deadlineAt: number | null; remainingMs: number; expiresAt: number; participants: RoomParticipant[]; rounds: RoomRound[]
}
interface RoomJoin { participantId: string; participantToken: string; state: RoomState }
interface RoomCreate extends RoomJoin { roomId: string; inviteToken: string }

type View = 'home' | 'solo-setup' | 'solo' | 'room-setup' | 'join-room' | 'room'
const SESSION_PREFIX = 'rptb-sprint-room-token:'
const INVITE_PREFIX = 'rptb-sprint-room-invite:'

function replyCount(count: number): string { return `${count.toLocaleString()} ${count === 1 ? 'reply' : 'replies'}` }
function iso(time: number): string { return new Date(time).toISOString() }
function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
function roomDraftId(roomId: string, participantId: string, roundNumber: number): string {
  return `room:${roomId}:${participantId}:${roundNumber}`
}
function makeSprint(durationSeconds: number, goalWords: number | null, title: string, kind: SprintKind = 'solo'): LocalSprint {
  const now = iso(Date.now())
  return {
    id: crypto.randomUUID(), kind, title: title.trim().slice(0, 120), durationSeconds, goalWords,
    phase: 'ready', startedAt: null, endedAt: null, deadlineAt: null, remainingMs: durationSeconds * 1000,
    segments: [makeReplySegment()], historySavedAt: null, createdAt: now, updatedAt: now,
  }
}
function makeRoomSprint(roomId: string, participantId: string, state: RoomState): LocalSprint {
  const now = iso(Date.now())
  return {
    id: roomDraftId(roomId, participantId, state.roundNumber), kind: 'room', roomId, participantId,
    roundNumber: state.roundNumber, title: state.name, durationSeconds: state.durationSeconds, goalWords: state.goalWords,
    phase: phaseForRoom(state.status), startedAt: state.roundStartedAt === null ? null : iso(state.roundStartedAt),
    endedAt: null, deadlineAt: state.deadlineAt, remainingMs: state.remainingMs,
    segments: [makeReplySegment()], historySavedAt: null, createdAt: now, updatedAt: now,
  }
}
function phaseForRoom(status: RoomState['status']): SprintPhase {
  return status === 'running' ? 'running' : status === 'paused' ? 'paused' : status === 'finished' ? 'finished' : 'ready'
}
function sessionKey(prefix: string, roomId: string): string { return prefix + roomId }
function readSession(key: string): string | null { try { return sessionStorage.getItem(key) } catch { return null } }
function writeSession(key: string, value: string): boolean { try { sessionStorage.setItem(key, value); return true } catch { return false } }
function removeSession(key: string): void { try { sessionStorage.removeItem(key) } catch { /* Browser storage can be blocked. */ } }
function parseInvite(value: string): { roomId: string; token: string } | null {
  try {
    const url = new URL(value, window.location.origin)
    const hash = url.hash.slice(1)
    const [path, query = ''] = hash.split('?')
    const match = /^sprint-room\/([0-9a-f-]{36})$/iu.exec(path)
    const token = new URLSearchParams(query || url.search).get('invite')
    return match && token ? { roomId: match[1], token } : null
  } catch { return null }
}

export default function WritingSprintsPage({ roomId = '', inviteToken = '' }: { roomId?: string; inviteToken?: string }) {
  const [view, setView] = useState<View>(roomId ? 'room' : 'home')
  const [activeRoomId, setActiveRoomId] = useState(roomId)
  const [invite, setInvite] = useState(inviteToken)
  const [draft, setDraft] = useState<LocalSprint | null>(null)
  const draftRef = useRef<LocalSprint | null>(null)
  const [localSessions, setLocalSessions] = useState<LocalSprint[]>([])
  const [history, setHistory] = useState<SprintHistory[]>([])
  const [options, setOptions] = useState<TrackingOptions>({ characters: [], partners: [], groups: [] })
  const [threads, setThreads] = useState<ThreadOption[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [clockNow, setClockNow] = useState(Date.now())
  const [durationMinutes, setDurationMinutes] = useState(15)
  const [customMinutes, setCustomMinutes] = useState('')
  const [goalInput, setGoalInput] = useState('')
  const [sprintTitle, setSprintTitle] = useState('')
  const [roomTitle, setRoomTitle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [participantLimit, setParticipantLimit] = useState(8)
  const [roomPassword, setRoomPassword] = useState('')
  const [inviteUrlInput, setInviteUrlInput] = useState('')
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [participantId, setParticipantId] = useState('')
  const participantIdRef = useRef('')
  const [roomConnected, setRoomConnected] = useState(false)
  const [reconnectFailed, setReconnectFailed] = useState(false)
  const [roomBusy, setRoomBusy] = useState(false)
  const [roomLimitInput, setRoomLimitInput] = useState(15)
  const [roomGoalInput, setRoomGoalInput] = useState('')
  const [roomError, setRoomError] = useState('')
  const [roomPasswordInput, setRoomPasswordInput] = useState('')
  const [segmentBusyId, setSegmentBusyId] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState('')
  const [clearConfirmId, setClearConfirmId] = useState('')
  const [message, setMessage] = useState('')
  const [storageError, setStorageError] = useState('')
  const [draftReadOnly, setDraftReadOnly] = useState(false)
  const [lockUnsupported, setLockUnsupported] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historySaving, setHistorySaving] = useState(false)
  const lockReleaseRef = useRef<() => void>(() => undefined)
  const historyAttempts = useRef(new Set<string>())
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const reconnectEnabled = useRef(false)
  const fallbackToken = useRef<{ roomId: string; token: string } | null>(null)
  const autoJoinRoom = useRef('')
  const syncingRoom = useRef(false)

  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => {
    let active = true
    void listLocalSprints().then(saved => { if (active) setLocalSessions(saved) })
    void api<SprintHistory[]>('/sprints').then(saved => { if (active) { setHistory(saved); setSignedIn(true) } }).catch(() => undefined)
    void api<TrackingOptions>('/starters/options').then(value => { if (active) setOptions(value) }).catch(() => undefined)
    void api<{ branches: Array<{ id: string; starterId: string; title: string; characterName?: string | null; partnerName?: string | null }> }>('/inbox?limit=200')
      .then(value => { if (active) setThreads(value.branches.map(branch => ({ id: branch.id, starterId: branch.starterId, title: branch.title, characterName: branch.characterName, partnerName: branch.partnerName }))) })
      .catch(() => undefined)
    const tick = window.setInterval(() => setClockNow(Date.now()), 250)
    return () => { active = false; window.clearInterval(tick) }
  }, [])

  useEffect(() => {
    if (!draft || view !== 'solo' || draft.kind !== 'solo' || draft.phase !== 'running' || draft.deadlineAt === null || clockNow < draft.deadlineAt) return
    setDraft(current => current?.id === draft.id ? { ...current, phase: 'finished', endedAt: iso(draft.deadlineAt!), deadlineAt: null, remainingMs: 0, updatedAt: iso(Date.now()) } : current)
  }, [clockNow, draft, view])

  useEffect(() => {
    if (!draft) return
    const timer = window.setTimeout(() => {
      void saveLocalSprint(draft).then(() => {
        setStorageError('')
        setLocalSessions(current => [draft, ...current.filter(item => item.id !== draft.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      }).catch(error => setStorageError((error as Error).message || 'Your draft could not be saved on this device. Keep this tab open and copy your replies.'))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [draft])

  useEffect(() => () => {
    reconnectEnabled.current = false
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current)
    socketRef.current?.close(1000, 'Page closed')
    lockReleaseRef.current()
  }, [])

  async function activateDraft(next: LocalSprint): Promise<boolean> {
    lockReleaseRef.current()
    const lock = await acquireSprintLock(next.id)
    lockReleaseRef.current = lock.release
    setLockUnsupported(!lock.supported)
    setDraftReadOnly(lock.supported && !lock.acquired)
    setDraft(next)
    setStorageError('')
    return !lock.supported || lock.acquired
  }

  async function saveHistory(result: LocalSprint, roomSummary?: { wordsCredited: number; repliesCompleted: number; durationSeconds: number; endedAt: number; participantCount: number }, retry = false) {
    if (!result.startedAt || result.historySavedAt || (!retry && historyAttempts.current.has(result.id))) return
    historyAttempts.current.add(result.id)
    const totals = sprintTotals(result.segments)
    const activeSeconds = roomSummary?.durationSeconds ?? Math.max(0, Math.floor(result.durationSeconds - result.remainingMs / 1000))
    const body = {
      id: result.id, title: result.title.trim() || 'Writing sprint', kind: result.kind,
      startedAt: result.startedAt, endedAt: roomSummary ? iso(roomSummary.endedAt) : result.endedAt ?? iso(Date.now()),
      durationSeconds: activeSeconds, wordsCredited: roomSummary?.wordsCredited ?? totals.creditedWords,
      repliesCompleted: roomSummary?.repliesCompleted ?? totals.repliesCompleted,
      goalWords: result.goalWords, participantCount: roomSummary?.participantCount ?? 1,
    }
    setHistorySaving(true)
    try {
      const saved = await api<SprintHistory>('/sprints', 'POST', body)
      const updated = { ...result, historySavedAt: iso(Date.now()), updatedAt: iso(Date.now()) }
      try { await saveLocalSprint(updated) } catch (error) { setStorageError((error as Error).message || 'Stats saved, but the local draft could not be updated.') }
      setDraft(current => current?.id === updated.id ? updated : current)
      setLocalSessions(current => [updated, ...current.filter(item => item.id !== updated.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setHistory(current => [saved, ...current.filter(item => item.id !== saved.id)].sort((a, b) => b.endedAt.localeCompare(a.endedAt)))
      setHistoryError('')
    } catch (error) {
      const detail = (error as Error).message
      setHistoryError(detail.includes("You've been signed out") ? 'Sign in to save this result to account history. Your sprint and writing are still on this device.' : detail)
    } finally { setHistorySaving(false) }
  }

  useEffect(() => {
    if (draft?.phase === 'finished' && draft.startedAt && !draft.historySavedAt && draft.kind === 'solo') void saveHistory(draft)
  }, [draft])

  function setSegment(segmentId: string, change: (segment: ReplySegment) => ReplySegment) {
    setDraft(current => current ? ({ ...current, updatedAt: iso(Date.now()), segments: current.segments.map(segment => segment.id === segmentId ? change(segment) : segment) }) : current)
  }

  async function startSolo() {
    const minutes = customMinutes ? Number(customMinutes) : durationMinutes
    const goal = goalInput.trim() ? Number(goalInput) : null
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 360) { setMessage('Choose a sprint length from 1 to 360 minutes.'); return }
    if (goal !== null && (!Number.isInteger(goal) || goal < 1 || goal > 1_000_000)) { setMessage('Enter a word goal from 1 to 1,000,000.'); return }
    const next = makeSprint(minutes * 60, goal, sprintTitle)
    await activateDraft(next)
    setView('solo')
    setMessage('Draft saved on this device. Start the timer when you are ready.')
  }

  function updateSoloPhase(action: 'start' | 'pause' | 'resume' | 'end') {
    if (!draft || draft.kind !== 'solo' || draftReadOnly) return
    const now = Date.now()
    if (action === 'start') setDraft({ ...draft, phase: 'running', startedAt: draft.startedAt ?? iso(now), endedAt: null, deadlineAt: now + draft.remainingMs, updatedAt: iso(now) })
    if (action === 'pause' && draft.deadlineAt !== null) setDraft({ ...draft, phase: 'paused', deadlineAt: null, remainingMs: Math.max(0, draft.deadlineAt - now), updatedAt: iso(now) })
    if (action === 'resume') setDraft({ ...draft, phase: 'running', deadlineAt: now + draft.remainingMs, updatedAt: iso(now) })
    if (action === 'end') setDraft({ ...draft, phase: 'finished', deadlineAt: null, remainingMs: draft.phase === 'running' && draft.deadlineAt !== null ? Math.max(0, draft.deadlineAt - now) : draft.remainingMs, endedAt: iso(now), updatedAt: iso(now) })
  }

  async function copyReply(text: string, complete = false, segmentId?: string) {
    if (!text.trim()) { setMessage('Add reply text before copying.'); return }
    if (complete && draft && segmentId) {
      const segment = draft.segments.find(item => item.id === segmentId)
      if (!segment || segment.completedAt) return
      const finished: ReplySegment = { ...segment, completedAt: iso(Date.now()), creditedSnapshot: creditedWordCount(segment.text, segment.creditMask), collapsed: true }
      const hasBlank = draft.segments.some(item => item.id !== segmentId && !item.completedAt && !item.text.trim())
      const next: LocalSprint = { ...draft, updatedAt: iso(Date.now()), segments: [...draft.segments.map(item => item.id === segmentId ? finished : item), ...(hasBlank ? [] : [makeReplySegment()])] }
      setSegmentBusyId(segmentId)
      try { await saveLocalSprint(next); setDraft(next) }
      catch (error) { setStorageError((error as Error).message || 'Could not save this completion. The reply was not marked complete.'); setSegmentBusyId(''); return }
      try { await navigator.clipboard.writeText(text); setMessage('Reply completed and copied. Your credited sprint total is preserved.') }
      catch { setMessage('Reply completed and saved, but clipboard access failed. Use Copy Reply to retry.') }
      setSegmentBusyId('')
      return
    }
    try { await navigator.clipboard.writeText(text); setMessage('Reply copied.') }
    catch { setMessage('Clipboard access failed. Select the reply text and copy it manually.') }
  }

  function addSegment() {
    if (!draft || draftReadOnly) return
    setDraft({ ...draft, updatedAt: iso(Date.now()), segments: [...draft.segments, makeReplySegment()] })
  }

  async function saveToParkingLot(segment: ReplySegment) {
    if (!draft || draftReadOnly || !segment.text.trim()) return
    if (segment.text.length > 20_000) { setMessage('The Parking Lot accepts up to 20,000 characters per draft. Copy this reply or split it first.'); return }
    setSegmentBusyId(segment.id)
    const payload = { title: segment.title.trim() || 'Sprint reply', notes: segment.text, purpose: 'reply', characterId: segment.characterId }
    try {
      const saved = await api<{ id: string }>(segment.parkingLotDraftId ? `/reply-drafts/${segment.parkingLotDraftId}` : '/reply-drafts', segment.parkingLotDraftId ? 'PATCH' : 'POST', payload)
      setSegment(segment.id, current => ({ ...current, parkingLotDraftId: saved.id }))
      setMessage(segment.parkingLotDraftId ? 'Parking Lot copy updated.' : 'Reply saved to the Parking Lot. The copy there is stored with your account.')
    } catch (error) { setMessage((error as Error).message || 'Could not save this reply to the Parking Lot.') }
    finally { setSegmentBusyId('') }
  }

  async function openLocalSession(session: LocalSprint) {
    let next = session
    if (session.kind === 'solo' && session.phase === 'running' && session.deadlineAt !== null && session.deadlineAt <= Date.now()) {
      next = { ...session, phase: 'finished', endedAt: iso(session.deadlineAt), deadlineAt: null, remainingMs: 0 }
      try { await saveLocalSprint(next) } catch { /* The editor still opens with the recovered in-memory copy. */ }
    }
    if (session.kind === 'room') {
      setRoomState(null)
      setParticipantId('')
      participantIdRef.current = ''
      setActiveRoomId('')
    }
    await activateDraft(next)
    setView('solo')
  }

  function connectRoomSocket(id: string, token: string) {
    reconnectEnabled.current = true
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current)
    socketRef.current?.close(1000, 'Reconnect')
    const connect = (attempt: number) => {
      if (!reconnectEnabled.current || activeRoomId && activeRoomId !== id) return
      const url = new URL(`/api/sprint-rooms/${id}/socket`, window.location.origin)
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      socketRef.current = socket
      let authenticated = false
      socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', participantToken: token }))
      socket.onmessage = event => {
        let packet: { type?: string; state?: RoomState; participantId?: string; message?: string }
        try { packet = JSON.parse(String(event.data)) as typeof packet } catch { return }
        if (packet.type === 'joined') { if (packet.participantId === participantIdRef.current) setRoomConnected(true); return }
        if (packet.type === 'state' && packet.state) { authenticated = true; setRoomConnected(true); setReconnectFailed(false); void applyRoomState(packet.state) }
        if (packet.type === 'error') setRoomError(packet.message ?? 'The room did not accept that update.')
      }
      socket.onclose = event => {
        if (socketRef.current !== socket) return
        setRoomConnected(false)
        // Terminal closes: retrying cannot succeed, so stop instead of looping.
        const terminal: Record<number, string> = {
          4001: 'This room is open in another tab, so this tab disconnected.',
          4003: 'The host removed you from this room.',
          1008: 'Your room access expired or is no longer valid.',
          1001: 'This room has expired.',
        }
        if (terminal[event.code]) { reconnectEnabled.current = false; setRoomError(terminal[event.code]); return }
        const next = authenticated ? 0 : attempt + 1
        if (reconnectEnabled.current && next < 8) reconnectTimer.current = window.setTimeout(() => connect(next), Math.min(1000 * (2 ** next), 10_000))
        else if (reconnectEnabled.current) setReconnectFailed(true)
      }
      socket.onerror = () => setRoomConnected(false)
    }
    connect(0)
  }

  async function applyRoomState(next: RoomState) {
    setRoomState(next)
    const personId = participantIdRef.current
    if (!personId) return
    const current = draftRef.current
    if (current?.kind === 'room' && current.roomId === next.roomId && current.roundNumber !== next.roundNumber) {
      const previous = next.rounds.find(round => round.number === current.roundNumber)
      if (previous && previous.startedAt !== null) {
        const summary = previous.participants.find(person => person.id === personId)
        if (summary) void saveHistory({ ...current, phase: 'finished', endedAt: iso(previous.endedAt), remainingMs: 0 }, {
          wordsCredited: summary.wordsCredited, repliesCompleted: summary.repliesCompleted, durationSeconds: previous.durationSeconds,
          endedAt: previous.endedAt, participantCount: previous.participants.length,
        })
      }
    }
    const id = roomDraftId(next.roomId, personId, next.roundNumber)
    let local = current?.id === id ? current : await getLocalSprint(id) ?? makeRoomSprint(next.roomId, personId, next)
    const round = next.rounds.find(item => item.number === next.roundNumber)
    local = {
      ...local, title: next.name, durationSeconds: next.status === 'finished' && round ? round.durationSeconds : next.durationSeconds, goalWords: next.goalWords,
      phase: phaseForRoom(next.status), startedAt: local.startedAt ?? (next.roundStartedAt === null ? null : iso(next.roundStartedAt)),
      endedAt: next.status === 'finished' ? iso(round?.endedAt ?? Date.now()) : null,
      deadlineAt: next.deadlineAt, remainingMs: next.status === 'running' && next.deadlineAt !== null ? Math.max(0, next.deadlineAt - Date.now()) : next.remainingMs,
      updatedAt: iso(Date.now()),
    }
    if (current?.id !== id) {
      const editable = await activateDraft(local)
      if (!editable) { setRoomConnected(false); return }
    } else setDraft(local)
    if (next.status === 'finished' && local.startedAt && !local.historySavedAt && !historyAttempts.current.has(local.id)) {
      const participant = round?.participants.find(person => person.id === personId)
      if (round && participant && round.startedAt !== null) void saveHistory(local, {
        wordsCredited: participant.wordsCredited, repliesCompleted: participant.repliesCompleted,
        durationSeconds: round.durationSeconds, endedAt: round.endedAt, participantCount: round.participants.length,
      })
    }
  }

  async function enterRoom(input: { roomId: string; inviteToken?: string; password?: string; name?: string; token?: string; initialState?: RoomState }) {
    setRoomBusy(true)
    setRoomError('')
    const token = input.token ?? readSession(sessionKey(SESSION_PREFIX, input.roomId)) ?? (fallbackToken.current?.roomId === input.roomId ? fallbackToken.current.token : null)
    const invitation = (input.inviteToken ?? invite) || readSession(sessionKey(INVITE_PREFIX, input.roomId)) || ''
    try {
      let joined: RoomJoin
      if (input.initialState && token) {
        joined = { participantId: input.initialState.hostId, participantToken: token, state: input.initialState }
      } else {
        const request = token
          ? { participantToken: token, ...(invitation ? { inviteToken: invitation } : {}) }
          : { inviteToken: invitation, displayName: input.name, password: input.password }
        try { joined = await api<RoomJoin>(`/sprint-rooms/${input.roomId}/join`, 'POST', request) }
        catch (error) {
          if (!token || !invitation) throw error
          removeSession(sessionKey(SESSION_PREFIX, input.roomId))
          joined = await api<RoomJoin>(`/sprint-rooms/${input.roomId}/join`, 'POST', { inviteToken: invitation, displayName: input.name, password: input.password })
        }
      }
      setActiveRoomId(input.roomId)
      setInvite(invitation)
      setRoomState(joined.state)
      setParticipantId(joined.participantId)
      participantIdRef.current = joined.participantId
      const stored = writeSession(sessionKey(SESSION_PREFIX, input.roomId), joined.participantToken)
      if (!stored) fallbackToken.current = { roomId: input.roomId, token: joined.participantToken }
      if (invitation) writeSession(sessionKey(INVITE_PREFIX, input.roomId), invitation)
      const id = roomDraftId(input.roomId, joined.participantId, joined.state.roundNumber)
      const local = await getLocalSprint(id) ?? makeRoomSprint(input.roomId, joined.participantId, joined.state)
      const editable = await activateDraft(local)
      setView('room')
      if (editable) connectRoomSocket(input.roomId, joined.participantToken)
      else setRoomError('This sprint is already open in another tab, so this tab is read-only. Close the other tab to reconnect here.')
    } catch (error) { setRoomError((error as Error).message || 'Could not join this room.') }
    finally { setRoomBusy(false) }
  }

  useEffect(() => {
    if (!roomId) return
    setActiveRoomId(roomId)
    setInvite(inviteToken)
    setView('room')
    const token = readSession(sessionKey(SESSION_PREFIX, roomId))
    if (token && autoJoinRoom.current !== roomId) {
      autoJoinRoom.current = roomId
      void enterRoom({ roomId, inviteToken, token })
    }
  }, [roomId, inviteToken])

  const totals = useMemo(() => draft ? sprintTotals(draft.segments) : { editorWords: 0, creditedWords: 0, repliesCompleted: 0 }, [draft])
  useEffect(() => {
    if (roomState?.status !== 'waiting') return
    setRoomLimitInput(Math.max(1, Math.round(roomState.durationSeconds / 60)))
    setRoomGoalInput(roomState.goalWords?.toString() ?? '')
  }, [roomState?.status, roomState?.roundNumber, roomState?.durationSeconds, roomState?.goalWords])
  const soloRemaining = draft ? (draft.phase === 'running' && draft.deadlineAt !== null ? Math.max(0, draft.deadlineAt - clockNow) : draft.remainingMs) : 0
  const roomRemaining = roomState ? (roomState.status === 'running' && roomState.deadlineAt !== null ? Math.max(0, roomState.deadlineAt - clockNow) : roomState.remainingMs) : 0
  const activeSegments = draft?.segments.filter(segment => !segment.completedAt) ?? []
  const completedSegments = draft?.segments.filter(segment => Boolean(segment.completedAt)) ?? []

  function roomSend(packet: unknown) {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(packet))
    else setRoomError('You are disconnected. Reconnect before changing room settings.')
  }

  function handleTextChange(segment: ReplySegment, text: string, inputType: string) {
    const isRunning = draft?.kind === 'room'
      ? roomState?.status === 'running' && roomState.deadlineAt !== null && roomState.deadlineAt > Date.now()
      : draft?.phase === 'running' && draft.deadlineAt !== null && draft.deadlineAt > Date.now()
    setSegment(segment.id, current => ({ ...current, text, creditMask: updateCreditMask(current.text, current.creditMask, text, inputType, Boolean(isRunning)) }))
  }

  const updateRoomProgress = useRef<number | null>(null)
  useEffect(() => {
    if (!draft || draft.kind !== 'room' || !roomConnected || draftReadOnly) return
    if (updateRoomProgress.current !== null) window.clearTimeout(updateRoomProgress.current)
    updateRoomProgress.current = window.setTimeout(() => roomSend({ type: 'progress', wordsCredited: totals.creditedWords, repliesCompleted: totals.repliesCompleted }), 700)
    return () => { if (updateRoomProgress.current !== null) window.clearTimeout(updateRoomProgress.current) }
  }, [draft?.kind, totals.creditedWords, totals.repliesCompleted, roomConnected, draftReadOnly])

  async function createRoom() {
    const minutes = customMinutes ? Number(customMinutes) : durationMinutes
    const goal = goalInput.trim() ? Number(goalInput) : null
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 360) { setRoomError('Choose a round length from 1 to 360 minutes.'); return }
    if (goal !== null && (!Number.isInteger(goal) || goal < 1 || goal > 1_000_000)) { setRoomError('Enter a word goal from 1 to 1,000,000.'); return }
    if (!displayName.trim()) { setRoomError('Add a display name for the room.'); return }
    setRoomBusy(true)
    setRoomError('')
    try {
      const created = await api<RoomCreate>('/sprint-rooms', 'POST', {
        name: roomTitle.trim() || 'Writing sprint room', hostName: displayName.trim(), durationSeconds: minutes * 60,
        goalWords: goal, participantLimit, ...(roomPassword ? { password: roomPassword } : {}),
      })
      const credentialStored = writeSession(sessionKey(SESSION_PREFIX, created.roomId), created.participantToken)
      writeSession(sessionKey(INVITE_PREFIX, created.roomId), created.inviteToken)
      fallbackToken.current = { roomId: created.roomId, token: created.participantToken }
      if (credentialStored) window.location.hash = `sprint-room/${created.roomId}?invite=${created.inviteToken}`
      else {
        setActiveRoomId(created.roomId)
        setInvite(created.inviteToken)
        await enterRoom({ roomId: created.roomId, inviteToken: created.inviteToken, token: created.participantToken, initialState: created.state })
        setRoomError('Browser session storage is blocked. Keep this tab open to stay connected as host.')
      }
    } catch (error) { setRoomError((error as Error).message || 'The room could not be created.') }
    finally { setRoomBusy(false) }
  }

  function joinPastedInvite() {
    const parsed = parseInvite(inviteUrlInput.trim())
    if (!parsed) { setRoomError('Paste a valid RP Thread Buddy sprint invitation link.'); return }
    window.location.hash = `sprint-room/${parsed.roomId}?invite=${parsed.token}`
  }

  function leaveRoom() {
    reconnectEnabled.current = false
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current)
    socketRef.current?.close(1000, 'Left room')
    socketRef.current = null
    setRoomConnected(false)
    setRoomState(null)
    setParticipantId('')
    participantIdRef.current = ''
    setDraft(null)
    lockReleaseRef.current()
    removeSession(sessionKey(SESSION_PREFIX, activeRoomId))
    setActiveRoomId('')
    setView('home')
    window.location.hash = 'tools/sprints'
  }

  async function copyInvite() {
    const token = invite || (activeRoomId ? readSession(sessionKey(INVITE_PREFIX, activeRoomId)) : null)
    if (!activeRoomId || !token) { setMessage('The invitation link is unavailable in this tab.'); return }
    const link = `${window.location.origin}/#sprint-room/${activeRoomId}?invite=${token}`
    try { await navigator.clipboard.writeText(link); setMessage('Private room invitation copied.') }
    catch { setMessage('Clipboard access failed. Copy the invitation link from the address bar.') }
  }

  function renderSegment(segment: ReplySegment, completed: boolean) {
    const words = countWords(segment.text)
    const credited = completed ? segment.creditedSnapshot ?? 0 : creditedWordCount(segment.text, segment.creditMask)
    const busy = segmentBusyId === segment.id
    const associatedCharacter = options.characters.find(character => character.id === segment.characterId)?.name
    const associatedThread = threads.find(thread => thread.starterId === segment.starterId)
    return <article className={`tracking-card sprint-segment${completed ? ' sprint-segment-done' : ''}`} key={segment.id}>
      <header className="sprint-segment-head">
        <div><p className="eyebrow">{completed ? 'Completed reply' : 'Reply segment'}</p><h3>{segment.title.trim() || (completed ? 'Untitled reply' : 'New reply')}</h3></div>
        <div className="sprint-segment-head-actions">
          <span>{words} editor words · {credited} credited</span>
          {completed && <button type="button" className="secondary-button" disabled={!segment.text.trim()} onClick={() => void copyReply(segment.text)}>Copy Reply</button>}
          {completed && <button type="button" className="secondary-button" aria-expanded={!segment.collapsed} onClick={() => setSegment(segment.id, current => ({ ...current, collapsed: !current.collapsed }))}>{segment.collapsed ? 'Expand' : 'Collapse'}</button>}
        </div>
      </header>
      {!completed || !segment.collapsed ? <>
        <label className="sprint-field">Reply title<input value={segment.title} maxLength={120} disabled={draftReadOnly} onChange={event => setSegment(segment.id, current => ({ ...current, title: event.target.value }))} placeholder="e.g. Rowan replies to the starter" /></label>
        {!completed && <div className="sprint-associations">
          <label className="sprint-field">Character<select value={segment.characterId ?? ''} disabled={draftReadOnly} onChange={event => setSegment(segment.id, current => ({ ...current, characterId: event.target.value || null }))}><option value="">No character</option>{options.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
          <label className="sprint-field">Tracked thread<select value={segment.starterId ?? ''} disabled={draftReadOnly} onChange={event => setSegment(segment.id, current => ({ ...current, starterId: event.target.value || null }))}><option value="">No thread</option>{threads.map(thread => <option key={thread.starterId} value={thread.starterId}>{[thread.characterName, thread.partnerName].filter(Boolean).join(' × ') || 'Tracked thread'} · {thread.title}</option>)}</select></label>
        </div>}
        {completed && <p className="field-help">{associatedCharacter ? `Character: ${associatedCharacter}` : 'No character selected'}{associatedThread ? ` · Thread: ${associatedThread.title}` : ''}</p>}
        <label className="sprint-field">Reply text<textarea value={segment.text} disabled={draftReadOnly || completed} onChange={event => handleTextChange(segment, event.target.value, (event.nativeEvent as InputEvent).inputType || '')} placeholder="Write this reply here. Other room participants never see it." /></label>
        <div className="sprint-segment-actions">
          {!completed && <button type="button" disabled={draftReadOnly || busy || !segment.text.trim()} onClick={() => void copyReply(segment.text)}>Copy Reply</button>}
          {!completed && <button type="button" disabled={draftReadOnly || busy || !segment.text.trim()} onClick={() => void copyReply(segment.text, true, segment.id)}>{busy ? 'Saving…' : 'Finish & Copy'}</button>}
          {completed && <button type="button" className="secondary-button" disabled={draftReadOnly} onClick={() => setSegment(segment.id, current => ({ ...current, completedAt: null, creditedSnapshot: null, collapsed: false }))}>Reopen to edit</button>}
          {!completed && <button type="button" className="secondary-button" disabled={draftReadOnly || busy || !segment.text.trim() || segment.text.length > 20_000} onClick={() => void saveToParkingLot(segment)}>{busy ? 'Saving…' : segment.parkingLotDraftId ? 'Update Parking Lot copy' : 'Save to Parking Lot'}</button>}
          {completed && !segment.text && <span className="field-help">Reply text cleared; the completed word snapshot remains.</span>}
          {completed && segment.text && clearConfirmId === segment.id ? <span className="sprint-inline-confirm">Clear this device copy? Its sprint totals stay saved. <button type="button" disabled={draftReadOnly} onClick={() => { setSegment(segment.id, current => ({ ...current, text: '', creditMask: '', collapsed: true })); setClearConfirmId(''); setMessage('Reply text cleared from this device. Its completed statistics remain.') }}>Clear text</button><button type="button" className="secondary-button" onClick={() => setClearConfirmId('')}>Keep it</button></span> : completed && segment.text ? <button type="button" className="secondary-button" disabled={draftReadOnly} onClick={() => setClearConfirmId(segment.id)}>Clear text, keep stats</button> : null}
          {!completed && activeSegments.length > 1 && (deleteConfirmId === segment.id
            ? <span className="sprint-inline-confirm">Delete this reply and its current credit? <button type="button" disabled={draftReadOnly} onClick={() => { setDraft(current => current ? { ...current, segments: current.segments.filter(item => item.id !== segment.id), updatedAt: iso(Date.now()) } : current); setDeleteConfirmId('') }}>Delete reply</button><button type="button" className="secondary-button" onClick={() => setDeleteConfirmId('')}>Keep it</button></span>
            : <button type="button" className="secondary-button" disabled={draftReadOnly} onClick={() => setDeleteConfirmId(segment.id)}>Delete reply</button>)}
        </div>
      </> : <p className="sprint-preserved-note">Text is saved on this device. Reopen to edit or copy it again.</p>}
    </article>
  }

  if (view === 'home') return <section className="writing-sprints" aria-labelledby="sprints-title">
    <a href="#tools" className="text-action">← Back to writing tools</a>
    <h1 id="sprints-title" className="page-heading">Writing sprints</h1>
    <p className="page-description">Write several separate RP replies in one timed session. Each reply keeps its own draft and copy button; the sprint totals stay even after you clear finished text.</p>
    <p className="sprint-privacy-note">Reply text stays in this browser. Sprint history stores only totals. A room shares participant names, credited words, completed replies, and connection status—never reply text.</p>
    {signedIn && <SprintStats />}
    <div className="sprint-entry-grid">
      <article className="tracking-card"><h2>Solo sprint</h2><p>Set a timer and work through as many replies as you want.</p><button type="button" onClick={() => setView('solo-setup')}>Set up a solo sprint</button></article>
      <article className="tracking-card"><h2>Private room</h2><p>Invite friends with a private link. Guests can join with a display name—no account required.</p><div className="actions"><button type="button" onClick={() => setView('room-setup')}>Create room</button><button type="button" className="secondary-button" onClick={() => { setRoomError(''); setView('join-room') }}>Join room</button></div></article>
    </div>
    <section className="tracking-card sprint-history"><div className="sprint-section-head"><div><h2>Saved sprint drafts</h2></div><span>Writing stays on this device</span></div>
      {localSessions.length ? <ul>{localSessions.map(session => <li key={session.id}><div><strong>{session.title || (session.kind === 'room' ? 'Room sprint' : 'Writing sprint')}</strong><span>{session.phase === 'finished' ? 'Finished' : session.phase === 'running' ? 'In progress' : session.phase === 'paused' ? 'Paused' : 'Ready'} · {sprintTotals(session.segments).creditedWords} words · {replyCount(sprintTotals(session.segments).repliesCompleted)}</span></div><div className="actions"><button type="button" className="secondary-button" onClick={() => void openLocalSession(session)}>{session.kind === 'room' ? 'Review on this device' : session.phase === 'finished' ? 'Review' : 'Resume'}</button>{deleteConfirmId === session.id ? <span className="sprint-inline-confirm">Delete this local draft and its text? <button type="button" onClick={() => void deleteLocalSprint(session.id).then(() => { setLocalSessions(current => current.filter(item => item.id !== session.id)); setDeleteConfirmId('') }).catch(error => setStorageError((error as Error).message || 'This local sprint could not be deleted.'))}>Delete</button><button type="button" className="secondary-button" onClick={() => setDeleteConfirmId('')}>Keep</button></span> : <button type="button" className="secondary-button" onClick={() => setDeleteConfirmId(session.id)}>Delete on this device</button>}</div></li>)}</ul> : <p className="field-help">Your started sprints will appear here for recovery and review.</p>}
    </section>
    {signedIn && <section className="tracking-card sprint-history"><div className="sprint-section-head"><div><h2>Sprint history</h2></div><span>Totals only; reply text is not uploaded</span></div>{history.length ? <ul>{history.map(item => <li key={item.id}><div><strong>{item.title || 'Writing sprint'}</strong><span>{new Date(item.endedAt).toLocaleString()} · {item.durationSeconds} active seconds · {item.wordsCredited} words · {replyCount(item.repliesCompleted)}{item.kind === 'room' ? ` · ${item.participantCount} participants` : ''}</span></div><span>{item.goalWords ? `${item.wordsCredited}/${item.goalWords} goal` : 'No goal'}</span></li>)}</ul> : <p className="field-help">Finished registered-user sprints will appear here.</p>}</section>}
    {message && <p className="tool-copied" role="status">{message}</p>}
  </section>

  if (view === 'solo-setup' || view === 'room-setup') {
    const isRoom = view === 'room-setup'
    return <section className="writing-sprints" aria-labelledby="sprint-setup-title"><a href="#tools/sprints" className="text-action" onClick={event => { event.preventDefault(); setView('home') }}>← Writing sprints</a><h1 id="sprint-setup-title" className="page-heading">{isRoom ? 'Create a room' : 'Set up a solo sprint'}</h1>
      {isRoom && <div className="sprint-form"><label className="sprint-field">Room name<input value={roomTitle} maxLength={80} onChange={event => setRoomTitle(event.target.value)} placeholder="Late-night reply sprint" /></label><label className="sprint-field">Your room display name<input value={displayName} maxLength={32} onChange={event => setDisplayName(event.target.value)} placeholder="Name everyone will see" /></label></div>}
      <fieldset className="sprint-duration"><legend>Duration</legend><div>{[...([5, 10, 15, 25, 45, 60] as const)].map(minutes => <label key={minutes}><input type="radio" name="sprint-duration" checked={durationMinutes === minutes && !customMinutes} onChange={() => { setDurationMinutes(minutes); setCustomMinutes('') }} />{minutes} minutes</label>)}</div><label className="sprint-field">Custom minutes<input type="number" min="1" max="360" value={customMinutes} onChange={event => setCustomMinutes(event.target.value)} placeholder="1–360" /></label></fieldset>
      <div className="sprint-form"><label className="sprint-field">Optional word goal<input type="number" min="1" max="1000000" value={goalInput} onChange={event => setGoalInput(event.target.value)} placeholder="No goal" /></label>{!isRoom && <label className="sprint-field">Optional sprint title<input value={sprintTitle} maxLength={120} onChange={event => setSprintTitle(event.target.value)} placeholder="Friday replies" /></label>}</div>
      {isRoom && <div className="sprint-form"><label className="sprint-field">Participant limit<select value={participantLimit} onChange={event => setParticipantLimit(Number(event.target.value))}>{[2, 4, 8, 12, 20, 32].map(count => <option key={count} value={count}>{count} people</option>)}</select></label><label className="sprint-field">Optional room password<input type="password" autoComplete="new-password" minLength={4} maxLength={128} value={roomPassword} onChange={event => setRoomPassword(event.target.value)} placeholder="At least 4 characters" /></label></div>}
      {isRoom && <p className="field-help">The invitation link is private. Guests need only a temporary display name. Room replies never leave their own browser.</p>}
      {message && <p role="status" className="tool-copied">{message}</p>}{roomError && <p role="alert" className="profile-error">{roomError}</p>}
      <div className="actions"><button type="button" disabled={roomBusy} onClick={() => isRoom ? void createRoom() : void startSolo()}>{roomBusy ? 'Creating…' : isRoom ? 'Create private room' : 'Start solo sprint'}</button><button type="button" className="secondary-button" onClick={() => setView('home')}>Cancel</button></div>
    </section>
  }

  if (view === 'join-room') return <section className="writing-sprints" aria-labelledby="join-room-title"><a href="#tools/sprints" className="text-action" onClick={event => { event.preventDefault(); setView('home') }}>← Writing sprints</a><h1 id="join-room-title" className="page-heading">Join a private room</h1><p className="page-description">Paste the invitation link. No account or email is needed.</p><div className="tracking-card sprint-form"><label className="sprint-field">Invitation link<input value={inviteUrlInput} onChange={event => setInviteUrlInput(event.target.value)} placeholder="https://rpthreadbuddy.app/#sprint-room/…" /></label><label className="sprint-field">Display name<input value={displayName} maxLength={32} onChange={event => setDisplayName(event.target.value)} placeholder="What other writers will see" /></label><label className="sprint-field">Room password, if required<input type="password" autoComplete="current-password" maxLength={128} value={roomPasswordInput} onChange={event => setRoomPasswordInput(event.target.value)} /></label>{roomError && <p role="alert" className="profile-error">{roomError}</p>}<div className="actions"><button type="button" disabled={roomBusy} onClick={joinPastedInvite}>Continue to room</button></div></div></section>

  if (view === 'room' && !roomState) return <section className="writing-sprints" aria-labelledby="room-title"><a href="#tools/sprints" className="text-action" onClick={event => { event.preventDefault(); setView('home') }}>← Writing sprints</a><h1 id="room-title" className="page-heading">Join room</h1><p className="page-description">Choose a temporary display name. Your reply drafts remain private on this device.</p><div className="tracking-card sprint-form"><label className="sprint-field">Display name<input value={displayName} maxLength={32} onChange={event => setDisplayName(event.target.value)} placeholder="Name everyone will see" /></label>{!inviteToken && !invite && <p className="field-help">Open the room invitation link to join.</p>}<label className="sprint-field">Room password, if required<input type="password" autoComplete="current-password" maxLength={128} value={roomPasswordInput} onChange={event => setRoomPasswordInput(event.target.value)} /></label>{roomError && <p role="alert" className="profile-error">{roomError}</p>}<div className="actions"><button type="button" disabled={roomBusy || !activeRoomId || (!inviteToken && !invite && !readSession(sessionKey(SESSION_PREFIX, activeRoomId)))} onClick={() => void enterRoom({ roomId: activeRoomId, inviteToken: inviteToken || invite, password: roomPasswordInput, name: displayName })}>{roomBusy ? 'Joining…' : 'Join sprint room'}</button><button type="button" className="secondary-button" onClick={() => setView('home')}>Cancel</button></div></div></section>

  if (!draft) return <section className="writing-sprints"><p role="status">Loading sprint…</p></section>

  const isRoom = draft.kind === 'room' && roomState !== null
  const isRoomReview = draft.kind === 'room' && roomState === null
  const roomHost = Boolean(roomState && participantId && roomState.hostId === participantId)
  const timerMs = isRoom ? roomRemaining : soloRemaining
  const goal = isRoom ? roomState?.goalWords ?? null : draft.goalWords
  const goalProgress = goal ? Math.min(100, Math.round(totals.creditedWords / goal * 100)) : 0
  const rounds = roomState?.rounds ?? []

  return <section className="writing-sprints" aria-labelledby="active-sprint-title">
    <a href="#tools/sprints" className="text-action" onClick={event => { event.preventDefault(); if (isRoom) leaveRoom(); else { setView('home'); lockReleaseRef.current() } }}>← Writing sprints</a>
    <div className="sprint-session-heading"><div><p className="eyebrow">{isRoom ? 'Private room' : isRoomReview ? 'Room sprint review' : 'Solo sprint'}</p><h1 id="active-sprint-title" className="page-heading">{isRoom ? roomState?.name ?? 'Room sprint' : draft.title || 'Writing sprint'}</h1></div>{isRoom && <button type="button" className="secondary-button" onClick={() => void copyInvite()}>Copy invite link</button>}</div>
    {isRoomReview && <p className="sprint-privacy-note">This is the copy saved on this device. It is not connected to the room, and edits here do not change room totals.</p>}
    <div className="sprint-live-grid">
      <section className="tracking-card sprint-timer"><p className="eyebrow">{isRoom ? `Round ${roomState?.roundNumber ?? 1}` : isRoomReview ? 'Last room timer snapshot' : 'Time remaining'}</p><p className="sprint-clock" aria-label={`${Math.floor(timerMs / 60000)} minutes ${Math.ceil(timerMs / 1000) % 60} seconds remaining`}>{formatClock(timerMs)}</p><p className="field-help">{isRoom ? roomState?.status === 'waiting' ? 'Waiting for the host to start.' : roomState?.status === 'paused' ? 'Paused by the host.' : roomState?.status === 'finished' ? 'This round is finished.' : 'The room timer is running.' : isRoomReview ? 'Saved locally for review; the room timer is no longer connected.' : draft.phase === 'ready' ? 'Ready when you are.' : draft.phase === 'paused' ? 'Paused.' : draft.phase === 'finished' ? 'Sprint finished. Your replies are still here.' : 'Keep going.'}</p>
        {!isRoom && !isRoomReview && <div className="actions">{draft.phase === 'ready' && <button type="button" disabled={draftReadOnly} onClick={() => updateSoloPhase('start')}>Start</button>}{draft.phase === 'running' && <button type="button" className="secondary-button" disabled={draftReadOnly} onClick={() => updateSoloPhase('pause')}>Pause</button>}{draft.phase === 'paused' && <button type="button" disabled={draftReadOnly} onClick={() => updateSoloPhase('resume')}>Resume</button>}{(draft.phase === 'running' || draft.phase === 'paused') && <button type="button" className="secondary-button" disabled={draftReadOnly} onClick={() => updateSoloPhase('end')}>End early</button>}</div>}
        {isRoom && roomHost && <div className="actions">{roomState?.status === 'waiting' && <button type="button" disabled={!roomConnected || draftReadOnly} onClick={() => roomSend({ type: 'action', action: 'start' })}>Start round</button>}{roomState?.status === 'running' && <><button type="button" className="secondary-button" disabled={!roomConnected || draftReadOnly} onClick={() => roomSend({ type: 'action', action: 'pause' })}>Pause</button><button type="button" className="secondary-button" disabled={!roomConnected || draftReadOnly} onClick={() => roomSend({ type: 'action', action: 'end' })}>End round</button></>}{roomState?.status === 'paused' && <><button type="button" disabled={!roomConnected || draftReadOnly} onClick={() => roomSend({ type: 'action', action: 'resume' })}>Resume</button><button type="button" className="secondary-button" disabled={!roomConnected || draftReadOnly} onClick={() => roomSend({ type: 'action', action: 'end' })}>End round</button></>}{roomState?.status === 'finished' && <button type="button" disabled={!roomConnected || draftReadOnly} onClick={() => roomSend({ type: 'action', action: 'next-round' })}>Set up next round</button>}</div>}
      </section>
      <section className="tracking-card sprint-progress"><p className="eyebrow">Your progress</p><div className="sprint-metrics"><span><strong>{totals.creditedWords.toLocaleString()}</strong> words credited</span><span><strong>{totals.repliesCompleted.toLocaleString()}</strong> replies completed</span><span><strong>{totals.editorWords.toLocaleString()}</strong> words in editors</span></div>{goal !== null && <div className="sprint-goal"><div><span>Word goal</span><strong>{totals.creditedWords.toLocaleString()} / {goal.toLocaleString()}</strong></div><progress value={goalProgress} max="100" aria-label="Word goal progress" /></div>}
        <p className="field-help">Only complete words typed while the timer runs are credited. Pasted text is excluded; attribution is best-effort in the browser.</p>
      </section>
    </div>

    {isRoom && <section className="tracking-card sprint-room-panel"><div className="sprint-section-head"><div><p className="eyebrow">Room progress</p><h2>Writers</h2></div><span role="status">{roomConnected ? 'Connected' : reconnectFailed ? 'Disconnected' : 'Reconnecting…'}</span></div><p className="field-help">Only aggregate counts are shared. Reply text, titles, character names, and tracked threads stay private.</p>{roomError && <p role="alert" className="profile-error">{roomError}</p>}
      <ul className="sprint-participants">{roomState?.participants.map(person => <li key={person.id}><div><strong>{person.name}{person.isHost ? ' · host' : ''}</strong><span>{person.connected ? 'Connected' : 'Reconnecting'} · {person.wordsCredited.toLocaleString()} words · {replyCount(person.repliesCompleted)}</span></div>{roomHost && !person.isHost && <button type="button" className="secondary-button" disabled={!roomConnected || draftReadOnly} onClick={() => roomSend({ type: 'action', action: 'remove-participant', participantId: person.id })}>Remove</button>}</li>)}</ul>
      {roomHost && roomState?.status === 'waiting' && <form className="sprint-room-config" onSubmit={event => { event.preventDefault(); roomSend({ type: 'action', action: 'configure', durationSeconds: roomLimitInput * 60, goalWords: roomGoalInput.trim() ? Number(roomGoalInput) : null }) }}><label className="sprint-field">Next round minutes<input type="number" min="1" max="360" value={roomLimitInput} onChange={event => setRoomLimitInput(Number(event.target.value))} /></label><label className="sprint-field">Word goal<input type="number" min="1" max="1000000" value={roomGoalInput} onChange={event => setRoomGoalInput(event.target.value)} placeholder="No goal" /></label><button type="submit" disabled={!roomConnected || draftReadOnly}>Update round settings</button></form>}
      {rounds.length > 0 && <details className="sprint-round-history"><summary>Completed rounds ({rounds.length})</summary><ul>{rounds.map(round => <li key={round.number}><strong>Round {round.number}</strong><span>{round.durationSeconds} active seconds · {round.participants.map(person => `${person.name}: ${person.wordsCredited} words, ${replyCount(person.repliesCompleted)}`).join(' · ')}</span></li>)}</ul></details>}
      <div className="actions">{reconnectFailed && !roomConnected && <button type="button" onClick={() => { const token = readSession(sessionKey(SESSION_PREFIX, activeRoomId)) ?? (fallbackToken.current?.roomId === activeRoomId ? fallbackToken.current.token : null); setReconnectFailed(false); setRoomError(''); if (token) connectRoomSocket(activeRoomId, token); else setRoomError('Room access is unavailable in this tab. Open the invitation link again.') }}>Reconnect</button>}<button type="button" className="secondary-button" onClick={leaveRoom}>Leave room</button></div>
    </section>}

    {draftReadOnly && <p className="offline-banner" role="status">This sprint is open in another tab. This tab is read-only to protect your local draft.</p>}
    {lockUnsupported && <p className="field-help">This browser cannot lock a sprint draft across tabs. Keep this sprint open in one tab to avoid overwriting local changes.</p>}
    {storageError && <p className="profile-error" role="alert">{storageError}</p>}
    {message && <p className="tool-copied" role="status">{message}</p>}

    <div className="sprint-workspace-head"><div><h2>Reply segments</h2></div><button type="button" className="secondary-button" disabled={draftReadOnly} onClick={addSegment}>Add reply</button></div>
    <p className="sprint-privacy-note">Each reply is separate, saved locally, and copied on its own. Clearing a completed reply keeps its credited snapshot. Reopening a completed reply removes its reply-complete mark; current typed words remain credited until you edit or clear them.</p>
    {activeSegments.map(segment => renderSegment(segment, false))}
    {completedSegments.length > 0 && <section className="sprint-completed-list" aria-labelledby="completed-replies-title"><div className="sprint-section-head"><div><h2 id="completed-replies-title">Completed replies</h2></div><span>{replyCount(completedSegments.length)}</span></div>{completedSegments.map(segment => renderSegment(segment, true))}</section>}
    {draft.phase === 'finished' && <section className="tracking-card sprint-results"><p className="eyebrow">Sprint result</p><h2>{totals.creditedWords.toLocaleString()} words · {replyCount(totals.repliesCompleted)}</h2><p>{Math.floor((draft.durationSeconds * 1000 - draft.remainingMs) / 1000)} active seconds{draft.goalWords ? ` · ${Math.min(100, Math.round(totals.creditedWords / draft.goalWords * 100))}% of word goal` : ''}</p>{historyError && <p role="alert" className="profile-error">{historyError}</p>}{historySaving && <p role="status">Saving totals to account history…</p>}{draft.historySavedAt ? <p role="status">Totals saved to your account history. Reply text remains on this device.</p> : draft.startedAt && <button type="button" disabled={historySaving} onClick={() => void saveHistory(draft, undefined, true)}>Retry saving stats</button>}</section>}
  </section>
}
