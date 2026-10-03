/**
 * composer-modes — Cursor-style mode selector for the Hermes composer. v13.1.
 *
 * A single mode button in the composer bar (ask/agent/plan/debug). A ComposerMiddleware
 * attaches the mode's FRAME to the draft (v12.0: `mode` + `note` as DATA, no RPC): the shell
 * sends `note` in prompt.submit and the core merges it ONLY into the model-facing bytes
 * (api_content) — the bubble shows only what was typed. The queue FREEZES the frame per
 * entry on enqueue; drains pass `fromQueue` and the middleware never re-derives.
 *   ask   → read-only (note)      agent → no note (mode still sealed)
 *   plan  → rules + `::plan-approve{file="..."}` directive (note)
 *   debug → systematic debugging in 3 phases (note)
 *
 * The PlanApproveCard (::plan-approve directive) offers 3 exits:
 *   a. Implement now → prompt.submit with the plan path
 *   b. Modify → inline editor (empty field) → prompt.submit with changes
 *   c. Continue in the prompt → the user types in the box (mode already reset)
 *
 * Hardened v5 (advice CMPA-2026-09-10-V5B, consensus 100/100/100):
 *   - state (open/draft) mirrored in ctx.storage `planDialogsV5` + rehydrated
 *     on every module evaluation → survives hot-reload and reloads.
 *     `sending` is NEVER rehydrated (transient; a stale flag would block everything).
 *   - probes via console.error('[cm-pa] …') — the only level desktop.log captures.
 *   - visible marker `v5·<bootId>` on card + pills.
 *   - ctx.onDispose for listener, flush and debounce.
 *
 * v6: debug loop (card ::debug-loop → buttons Mark as fixed / still not working).
 * v7 (advice MODEK-2026-09-10-V7B): Shift+Tab cycles the modes — listener on window
 *   with capture, scope composer/transcript (+body); skips in terminal and overlays with role;
 *   not rebindable in v1 (the gate actionAllowedInInput blocks shift-only combos in editables).
 * v8 (advice MODIC-2026-09-10-V10B): codicon icons on the pills — comment-discussion (ask),
 *   hubot (agent), checklist (plan), debug-alt (debug) — SDK Codicon at 0.75rem + shrink-0.
 * v9 (advice MODOR-2026-09-10-V9B): clean bubbles — the user's text goes FIRST; the mode
 *   note at the end with 3 blank lines (below the 4-line fold + clamp fade). plan no
 *   longer uses the builtin /plan: own payload with a verbatim replica of the rules (re-sync
 *   with agent/plan_prompt.py). Guards: explicit slash wins; idempotency by exact suffix.
 *   KNOWN LIMIT: while the agent works, a plain Enter in the composer goes through the
 *   desktop steer (session.redirect), which does NOT pass through the middleware → that send
 *   goes out unframed. Ctrl/Cmd+Enter (queue) does keep the mode at drain. Each wrap emits a
 *   probe `mw ...`. SUPERSEDED by v11.0: the note no longer lives in the text — it travels
 *   hidden via `session.note.stage`.
 * v10 (advice MODEB-2026-09-11-V10): single mode button in the composer — shows the current
 *   mode (icon + label + chevron) and cycles on click using the same cycleMode as Shift+Tab.
 *   A new session starts in Agent (reset on session change; the birth from draft null to id
 *   does NOT reset, and the mode chosen in a draft survives the first send).
 * v10.1: per-mode color on the button — ask green, agent gray (active control), plan orange,
 *   debug red — tokens --ui-green / --ui-red / --ui-orange + --ui-control-active-background.
 * v10.2: colors via inline style (CSS var) — Tailwind only compiles classes present in the
 *   app source: the plugin's bg-(--ui-red)/bg-(--ui-orange) generated no rule (transparent button).
 * v10.3 (debug round 2026-09-11): plan and debug 20% darker (color-mix 80/20 with black) to
 *   differentiate better and give the text contrast; temporary probe `modebtn ... bg=...` (removed
 *   with the cleanup turn of the debug loop).
 * v10.4: plan back to blue (var(--ui-accent), as before the per-mode colors); diagnostic
 *   probe removed (closing the debug loop without 'Mark as fixed').
 * v10.5: persistent marks of the card buttons (plan: Implement/Modify; debug:
 *   retry/fixed) mirrored in ctx.storage. Limits: local to the machine; no unmark/undo;
 *   transient mark best-effort — a click during the live turn (ephemeral id
 *   assistant-stream-…) does not survive rehydration (the plans are safe via the
 *   f: alias); the f: alias shares the mark across all cards of the same plan;
 *   theoretical collision of the ts|role key (µs timestamps make it near impossible);
 *   orphaned keys inert after deleting sessions; storage.clear() ignored (event key null).
 * v10.6: 'Read plan' button (4th) on the plan card — reader pane docked to the right
 *   (host.openWorkspace id 'composer-modes:plan-reader', markdown via Streamdown, local read via
 *   window.hermesDesktop.readFileText; probes planview *). Limits: reads the local machine
 *   (on remote it degrades with a visible error); fallback to a hidden submit (display_kind hidden)
 *   triggering desktop_preview if the seam is missing or there is no cwd.
 * v10.7: visual breathing room (mt-3 ≈ a line break) between the last message text and the
 *   plan and debug cards — nothing overlapping (user request).
 * v10.8: reader toggle on the card button — 'Read plan' opens / 'Close plan' closes the pane
 *   (host.paneVisibility of the pane 'plugin-workspace:composer-modes:plan-reader' AND the card's file;
 *   self-healing on X/⌘W/reload; Close is never blocked by a send; no persistence). Pane id
 *   renamed to namespaced 'composer-modes:plan-reader' (convention <pluginId>:<paneId>).
 * v10.9: check tick INSIDE the button (first child, same pattern as the read icon) and the 'edit' (Modify)
 *   mark only when pressing 'Send changes' (probe -> fresh -> applyMark -> sendTurn; rollback only if the mark was
 *   new); one-time purge of the false ':plan:edit' marks left by v10.8 (flag marksPurgeV9).
 * v10.10: plan-mode questions dialog — on MATERIAL ambiguity the agent writes
 *   .hermes/plans/<ts>-<slug>-questions.json and emits ::plan-questions{file="..."} as the only paragraph;
 *   card stepper ('Questions about the plan — i/n', one per screen, free option ALWAYS, Back/Next,
 *   single send with the answers + a continue instruction); own auto-reset with the right toast.
 * v10.11: 3 UX fixes to the stepper (user request) — auto-advance on option click with a 200 ms beat
 *   (the selection is painted before advancing) + anti-double-click guard of 300 ms (silent swallow, no
 *   disabled); light full-width vertical rows (ghost variant, numbered 'N. text' same color,
 *   'Other answer…' = n+1) with highlighted selection (classes + inline style per the v10.2 lesson);
 *   haptic('selection') on accepted picks (best-effort). Beat cancellation on Back/Next/Other/
 *   unmount. v1 limits: post-advance focus and aria-live = v1.1; valve to 450 ms if jumps appear.
 * v11.0 (advice HIDE-2026-09-11-V17, CONSENSUS_100): REAL hiding of the notes — the
 *   middleware no longer appends text: the note travels with `session.note.stage` (one-shot, TTL 30 s)
 *   and the core merges it ONLY into api_content (bubble = the user's exact text; history,
 *   copy and editor clean; the CSS clamp stops being the mechanism). v1 limits: steer (Enter with
 *   agent busy) loses the note — use Ctrl/Cmd+Enter (queue); first send of a new chat
 *   without sessionId → note skipped (probe); old backend ignores the stage (probe err, mode inert);
 *   the native draft.note param (no RPC) is kept for stage B with an app rebuild.
 * v12.0 (advice QUEUEFREEZE-2026-09-11-V18, CONSENSO_100): the mode is FROZEN per queued
 *   message — the middleware attaches `mode` (+ `note`) to the draft as data; the shell re-sends it
 *   as the `note` of prompt.submit; the queue captures the frame at the ENTRY (chain run once
 *   in queueCurrentDraft) and the drains (foreground, background, send-now) pass `fromQueue` + the
 *   frozen note without re-deriving. The stage RPC is REMOVED from the plugin (the core keeps it for
 *   old windows; min-build: shell with `draft.note`). v1 limits: all steer/redirect without note
 *   (direct Enter-while-busy, fallback and steer-now) — parity with v11, follow-up 'session.redirect
 *   note'; pre-v12 entries without a frame drain without a note; mode chip on the queue row (neutral
 *   label, no glyphs).
 * v12.2 (advice REPO-2026-09-11-V1): "always stage" — the v11 best-effort stage
 *   (`session.note.stage`, try/catch, no new probe) comes back IN PARALLEL with the draft's `note`.
 *   One plugin covers: new app + patched core (draft.note wins; the staged one is popped); stock app
 *   + patched core (only the stage delivers); stock app unpatched (nothing travels, silent
 *   degradation). The stage fires ONLY on the fresh derivation (never on `fromQueue` drains),
 *   BEFORE the chain's return, and uses the v11 sid (focused → active).
 *
 * v13 (full package, no patches): the backend is the ONLY source of the notes. The
 *   middleware only NOTIFIES the mode (`ctx.rest('/mode', {method:'POST'})`, awaited before
 *   returning the draft) and the agent-half turns it into the turn's note via `pre_llm_call`
 *   → api_content. `draft.note` and `session.note.stage` disappear: nothing depends on a patched
 *   core or a rebuilt renderer. The typed text is NEVER touched; `ask` is additionally
 *   enforced on the tool side (`pre_tool_call` → real read-only).
 * v13.1 (2026-09-16, live debug loop): the stage used `host.state.focusedSessionId`
 *   = the TILE runtime id (`$focusedRuntimeId`), which is NOT the `agent.session_id` the
 *   core fires `pre_llm_call` with → the store never matched and the note never reached any
 *   turn (silently: `agent` and "no note" look the same from the model). Now a single
 *   helper (`backendSid`) resolves `focusedStoredSessionId` first, with a fallback to the runtime
 *   id for old shells. Proven live: ask/debug/plan deliver their note and agent does not.
 *
 * Reload: ⌘K → "Reload desktop plugins" (fs-watch only reaches the main
 *   window; a secondary window needs a manual reload or reopen).
 */

import {
  atom,
  Button,
  cn,
  Codicon,
  haptic,
  host,
  Streamdown,
  Textarea,
  Tip,
  TRANSCRIPT_DIRECTIVE_AREA,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useLayoutEffect, useRef } from 'react'

const ID = 'composer-modes'
const VER = 'v13.1'
const BOOT = Date.now().toString(36).slice(-4)

/** Probe → desktop.log via console.error (the only level captured). */
/** v13.1: the id the core knows is the *stored* (backend) one. The tile runtime id does
 *  not match `agent.session_id`, so the mode note never reached any turn. */
function backendSid() {
  try {
    const stored = host.state.focusedStoredSessionId
    const value = stored && typeof stored.get === 'function' ? stored.get() : stored
    if (value) return String(value)
  } catch (_) {
    /* no stored id: falls back to runtime */
  }
  try {
    return host.state.focusedSessionId.get() || host.state.activeSessionId.get() || null
  } catch (_) {
    return null
  }
}

/**
 * v13: the backend needs to know the mode BEFORE admitting the turn. `ctx.rest` is scoped to
 * `/api/plugins/composer-modes` — it never leaves this plugin. Best-effort: if the backend is
 * down (agent half disabled, remote backend), the send goes on and the mode is cosmetic.
 */
async function stageMode(ctx, mode, sidOverride) {
  if (typeof ctx.rest !== 'function') {
    probe('stage skip (no ctx.rest) mode=' + mode)
    return false
  }
  const sid = sidOverride || backendSid()
  if (!sid) {
    probe('stage skip (no session) mode=' + mode)
    return false
  }
  try {
    await ctx.rest('/mode', { method: 'POST', body: { session_id: sid, mode } })
    probe('stage ok mode=' + mode + ' sid=' + String(sid))
    return true
  } catch (e) {
    probe('stage FAIL mode=' + mode + ' sid=' + String(sid) + ' err=' + String((e && e.message) || e))
    return false
  }
}

/** Sole owner of the mode change: atom + storage mirror + notify the backend. */
function applyMode(ctx, mode, sidOverride) {
  activeMode.set(mode)
  void ctx.storage.set('mode', mode)
  void stageMode(ctx, mode, sidOverride)
}

function probe(msg) {
  try {
    console.error(`[cm-pa] ${msg}`)
  } catch (_) {
    /* a probe must never break */
  }
}

const MODES = [
  { id: 'ask', label: 'Ask', icon: 'comment-discussion', hint: 'Answer only — never edit files or run mutations' },
  { id: 'agent', label: 'Agent', icon: 'hubot', hint: 'Full agentic mode (default)' },
  { id: 'plan', label: 'Plan', icon: 'checklist', hint: 'Write a plan only — no execution (/plan)' },
  { id: 'debug', label: 'Debug', icon: 'debug-alt', hint: 'Systematic debugging: evidence first, then fix' }
]

/** Button background per mode — direct CSS values (inline style): Tailwind classes with var()
 *  only exist if the app source uses them; inline does not depend on the compile. */
const MODE_BG = {
  ask: 'var(--ui-green)',
  agent: 'var(--ui-control-active-background)',
  // debug 20% darker (contrast with the text); plan back to the accent blue.
  plan: 'var(--ui-accent)',
  debug: 'color-mix(in srgb, var(--ui-red) 80%, #000)'
}

/** Only files saved by /plan are accepted. Model output = untrusted. */
const PLAN_FILE_RE = /^\.hermes\/plans\/[A-Za-z0-9._-]+\.md$/

/** Round of the debug loop (attr untrusted: digits only). */
const ROUND_RE = /^[0-9]{1,3}$/

const EMPTY_DIALOG = { open: false, draft: '', sending: null }

/** Key of the storage mirror (v5). */
const DKEY = 'planDialogsV5'

/**
 * Panel state per file. Module-level atom for reactivity; mirrored to
 * ctx.storage to survive module re-evaluation and reloads.
 */
const planDialogs = atom({})
let ctxRef = null
let saveTimer = null

// ── Plan reader (v10.6) — pane docked to the right (host.openWorkspace) ──
const planReaderFile = atom(null)
const planReaderView = atom({ status: 'idle' })
let planReaderDispose = null

// ── Plan questions (v10.10) — mirror of the stepper (state per file) ──
const PLANQ_KEY = 'planQStateV1'
const EMPTY_Q = { status: 'idle', questions: null, answers: {}, index: 0, sending: null }
const planQState = atom({})
let saveQTimer = null

function getQEntry(file) {
  const all = planQState.get()
  return all[file] || EMPTY_Q
}

/** Persistable shape: `sending` is transient and NEVER persisted. */
function snapshotQ() {
  const out = {}
  for (const [k, v] of Object.entries(planQState.get())) {
    out[k] = {
      status: typeof v.status === 'string' ? v.status : 'idle',
      questions: Array.isArray(v.questions) ? v.questions : null,
      answers: v.answers && typeof v.answers === 'object' ? v.answers : {},
      index: Number.isInteger(v.index) ? v.index : 0
    }
  }
  return out
}

function flushQ() {
  try {
    if (ctxRef) ctxRef.storage.set(PLANQ_KEY, snapshotQ())
  } catch (_) {
    /* storage best-effort */
  }
}

function setQEntry(file, patch) {
  const next = { ...planQState.get(), [file]: { ...getQEntry(file), ...patch } }
  planQState.set(next)
  clearTimeout(saveQTimer)
  saveQTimer = setTimeout(flushQ, 300)
}

function hydrateQ(ctx) {
  try {
    const saved = ctx.storage.get(PLANQ_KEY, null)
    if (!saved || typeof saved !== 'object') return
    const clean = {}
    for (const [k, v] of Object.entries(saved)) {
      if (!v || typeof v !== 'object') continue
      clean[k] = {
        status: typeof v.status === 'string' ? v.status : 'idle',
        questions: Array.isArray(v.questions) ? v.questions : null,
        answers: v.answers && typeof v.answers === 'object' ? v.answers : {},
        index: Number.isInteger(v.index) ? v.index : 0,
        sending: null
      }
    }
    planQState.set(clean)
    probe(`pq hydrate keys=${Object.keys(clean).length}`)
  } catch (e) {
    probe(`pq hydrate err ${String(e)}`)
  }
}

// v10.8: ids of the reader pane + mirror for desktops without host.paneVisibility.
const PLAN_READER_WS = 'composer-modes:plan-reader'
const PLAN_READER_PANE = 'plugin-workspace:' + PLAN_READER_WS
const planReaderOpen = atom(false)

function getDialogEntry(file) {
  const all = planDialogs.get()
  return all[file] || EMPTY_DIALOG
}

/** Persistable shape: `sending` is transient and NEVER persisted. */
function snapshotDialogs() {
  const out = {}
  for (const [k, v] of Object.entries(planDialogs.get())) {
    out[k] = { open: v.open === true, draft: typeof v.draft === 'string' ? v.draft : '' }
  }
  return out
}

function flushDialogs() {
  try {
    if (ctxRef) ctxRef.storage.set(DKEY, snapshotDialogs())
  } catch (_) {
    /* storage best-effort */
  }
}

function setDialogEntry(file, patch) {
  const next = { ...planDialogs.get(), [file]: { ...getDialogEntry(file), ...patch } }
  planDialogs.set(next)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushDialogs, 300)
}

/**
 * Rehydrates the mirror. Runs on every module evaluation (the hot reload
 * re-registers). `sending` is forced to null: a send does not survive a reload and a
 * stale flag would leave all the buttons disabled with no way out.
 */
function hydrateDialogs(ctx) {
  try {
    const saved = ctx.storage.get(DKEY, null)
    if (!saved || typeof saved !== 'object') return
    const clean = {}
    for (const [k, v] of Object.entries(saved)) {
      if (!v || typeof v !== 'object') continue
      clean[k] = {
        open: v.open === true,
        draft: typeof v.draft === 'string' ? v.draft : '',
        sending: null
      }
    }
    planDialogs.set(clean)
    probe(`hydrate keys=${Object.keys(clean).length} boot=${BOOT}`)
  } catch (e) {
    probe(`hydrate err ${String(e)}`)
  }
}

// ── Persistent button marks (v10.5) ──
const MARKS_KEY = 'marksV1'
const MID_RE = /^(\d+(?:\.\d+)?)-\d+-(user|assistant|system)$/
const marksStamp = atom(0)

function bumpMarks() {
  marksStamp.set(marksStamp.get() + 1)
}

function stableMid(mid) {
  const m = MID_RE.exec(String(mid || ''))
  return m ? `${m[1]}|${m[2]}` : String(mid || '')
}

function markKeys(card, btn, mid, extra) {
  const keys = []
  const stable = stableMid(mid)
  if (stable) keys.push(`m:${stable}:${card}:${btn}`)
  if (extra) keys.push(`f:${extra}:${card}:${btn}`)
  return keys
}

function readMarks() {
  try {
    const saved = ctxRef ? ctxRef.storage.get(MARKS_KEY, null) : null
    return saved && typeof saved === 'object' ? saved : {}
  } catch (_) {
    return {}
  }
}

function isMarked(card, btn, mid, extra) {
  const m = readMarks()
  return markKeys(card, btn, mid, extra).some((k) => m[k] === 1)
}

function writeMark(card, btn, mid, extra, on) {
  const keys = markKeys(card, btn, mid, extra)
  if (!keys.length) return false
  const m = readMarks()
  for (const k of keys) {
    if (on) m[k] = 1
    else delete m[k]
  }
  try {
    if (ctxRef) ctxRef.storage.set(MARKS_KEY, m)
  } catch (_) {}
  return true
}

function cardMessageId(el) {
  try {
    if (!el || typeof el.closest !== 'function') return null
    const root = el.closest('[data-message-id]')
    return root ? root.getAttribute('data-message-id') : null
  } catch (_) {
    return null
  }
}

function useCardMarks(card, btns, rootRef, getExtra) {
  const midRef = useRef(null)
  useValue(marksStamp)
  const marks = {}
  for (const b of btns) marks[b] = isMarked(card, b, midRef.current, getExtra())
  useLayoutEffect(() => {
    midRef.current = cardMessageId(rootRef.current)
    const hit = btns.filter((b) => isMarked(card, b, midRef.current, getExtra()))
    if (hit.length) probe(`markhit card=${card} btns=${hit.join(',')} mid=${stableMid(midRef.current)}`)
    bumpMarks()
  }, [])
  const applyMark = (btn, on) => {
    if (writeMark(card, btn, midRef.current, getExtra(), on)) {
      probe(`mark card=${card} btn=${btn} on=${on ? 1 : 0} mid=${stableMid(midRef.current)}`)
      bumpMarks()
    } else {
      probe(`mark skip card=${card} btn=${btn}`)
    }
  }
  return [marks, applyMark, midRef]
}

/** Slash command shape (parity with the desktop's SLASH_COMMAND_RE) — the explicit slash wins.
 *  The NOTES of each mode live in the agent-half (`modes.py`): no character of model
 *  instruction is written here. */
const SLASH_SHAPE_RE = /^\/[^\s/]*(?:\s|$)/

const activeMode = atom('agent')

/** In-flight send per debug round — transient, NOT persisted. */
const debugSending = atom({})

function isValidPlanFile(file) {
  return typeof file === 'string' && PLAN_FILE_RE.test(file)
}

/** Only question files saved by the agent are accepted (attr untrusted). */
const PLANQ_FILE_RE = /^\.hermes\/plans\/[A-Za-z0-9._-]+\.json$/

function isValidPlanQFile(file) {
  return typeof file === 'string' && PLANQ_FILE_RE.test(file)
}

function notifySafe(payload) {
  try {
    if (host && typeof host.notify === 'function') host.notify(payload)
  } catch (_) {
    /* a toast must never break the plugin */
  }
}

function submitTurn(text, displayKind) {
  const sid =
    host.state.focusedSessionId.get() || host.state.activeSessionId.get() || null
  if (!sid) {
    notifySafe({ kind: 'error', message: 'No active session to send to.' })
    return Promise.reject(new Error('no active session'))
  }
  return host.request('prompt.submit', {
    session_id: sid,
    text,
    ...(displayKind ? { display_kind: displayKind } : {})
  })
}

// ── Plan reader v10.6: opens the .md in a pane docked to the right ──

function resolvePlanAbs(file) {
  if (typeof file !== 'string' || !file) return ''
  const isAbs = file.length > 1 && (file[1] === ':' || file[0] === '/')
  if (isAbs) return file
  const cwd = host.state.cwd.get() || ''
  if (!cwd) return ''
  return (cwd.endsWith('/') ? cwd : cwd + '/') + file
}

/** Lenient validation of the questions JSON (model input = untrusted). */
function normalizeQuestions(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const list = parsed && Array.isArray(parsed.questions) ? parsed.questions : []
    const out = []
    for (const item of list) {
      if (!item || typeof item !== 'object' || typeof item.q !== 'string' || !item.q.trim()) continue
      const opts = []
      const rawOpts = Array.isArray(item.options) ? item.options : []
      for (const o of rawOpts) {
        const sv = typeof o === 'string' ? o : o && typeof o.label === 'string' ? o.label : ''
        const t = sv.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
        if (t) opts.push(t)
        if (opts.length >= 5) break
      }
      out.push({ q: item.q.trim().slice(0, 400), options: opts })
      if (out.length >= 5) break
    }
    return out
  } catch (_) {
    return null
  }
}

/** Answers payload (v10.10): the user's answers first, the EN instruction at the end. */
function planQAnswersBody(file, questions, answersMap) {
  const lines = [`Answers to the plan questions (${file}):`]
  questions.forEach((item, i) => {
    const a = answersMap[i]
    const shown = a === null || a === undefined || a === '' ? '(no answer)' : String(a)
    lines.push(`${i + 1}) ${item.q}`)
    lines.push(`→ ${shown}`)
  })
  lines.push('')
  lines.push(
    'Continue in PLAN MODE: now write the plan following your plan-mode instructions, save it under .hermes/plans/ as markdown, and end your reply with ONLY the ::plan-approve directive. If an answer is missing, list it under open questions instead of guessing. You may delete the questions JSON file once the plan is saved.'
  )
  return lines.join('\n')
}

function planQContinueBody(file) {
  return [
    `I could not read or answer your questions (${file}).`,
    '',
    'Continue in PLAN MODE: write the plan now choosing sensible defaults, list the assumptions and open questions in the plan, and end your reply with ONLY the ::plan-approve directive.'
  ].join('\n')
}

/** Answers send: direct (no middleware, no 450 slice); hard ceiling 16K. */
function submitPlanAnswers(text, label) {
  const body = String(text || '')
  if (!body.trim()) return Promise.reject(new Error('empty answers'))
  if (body.length > 16000) {
    notifySafe({ kind: 'error', message: 'The answers are too long to send.' })
    return Promise.reject(new Error('answers too long'))
  }
  probe(`pq send kind=${label} len=${body.length}`)
  return submitTurn(body)
}

function openPlanReader(file) {
  probe(`planview open file=${file}`)
  const abs = resolvePlanAbs(file)
  const canPane =
    typeof host.openWorkspace === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.hermesDesktop?.readFileText === 'function'
  if (!canPane || !abs) {
    probe(`planview fallback abs=${abs || '(no cwd)'}`)
    const target = abs || file
    submitTurn(
      `Open ${target} in the preview pane: run desktop_preview with action "open" and url "${target}". ` +
        'Do not write any text in your reply — no confirmation, no explanation.',
      'hidden'
    )
    return
  }
  planReaderFile.set(file)
  planReaderView.set({ status: 'idle' })
  planReaderDispose = host.openWorkspace(PLAN_READER_WS, {
    title: `Plan — ${String(file).split('/').pop() || file}`,
    dock: { pane: 'workspace', pos: 'right' },
    minWidth: '22rem',
    onClose: () => {
      planReaderDispose = null
      planReaderFile.set(null)
      planReaderOpen.set(false)
      if (typeof host.paneVisibility !== 'function') probe('planview mirror close')
      probe('planview close')
    },
    render: () => jsx(PlanReaderPane, {})
  })
  planReaderOpen.set(true)
  if (typeof host.paneVisibility !== 'function') probe(`planview mirror open file=${file}`)
  probe('planview pane')
}

/** Toggle-close (v10.8): runs ONLY the live handle — a stale disposer would remove the re-registered pane. */
function closePlanReader() {
  const d = planReaderDispose
  if (typeof d !== 'function') {
    probe('planview close skip no-dispose')
    return
  }
  planReaderDispose = null
  try {
    d()
  } catch (e) {
    probe(`planview close err ${String((e && e.message) || e)}`)
  }
}

function PlanReaderPane() {
  const file = useValue(planReaderFile)
  const view = useValue(planReaderView)
  useEffect(() => {
    if (!file) return undefined
    const abs = resolvePlanAbs(file)
    if (!abs) {
      planReaderView.set({ status: 'err', msg: 'No workspace (empty cwd): cannot resolve the path.' })
      return undefined
    }
    const read = typeof window !== 'undefined' && window.hermesDesktop ? window.hermesDesktop.readFileText : null
    if (typeof read !== 'function') {
      planReaderView.set({ status: 'err', msg: 'readFileText not available in this shell.' })
      return undefined
    }
    let alive = true
    planReaderView.set({ status: 'loading' })
    Promise.resolve(read(abs))
      .then((r) => {
        if (!alive) return
        if (r && r.binary) {
          planReaderView.set({ status: 'err', msg: 'The file is binary: it cannot be shown.' })
          probe(`planview err file=${file} binary`)
          return
        }
        const text = String((r && r.text) || '')
        planReaderView.set({ status: 'ok', text, truncated: !!(r && r.truncated) })
        probe(`planview ok file=${file} len=${text.length}`)
      })
      .catch((e) => {
        if (!alive) return
        planReaderView.set({ status: 'err', msg: String((e && e.message) || e) })
        probe(`planview err file=${file} msg=${String((e && e.message) || e)}`)
      })
    return () => {
      alive = false
    }
  }, [file])

  const wrap = (children) =>
    jsx('div', {
      className: 'h-full min-h-0 overflow-auto p-2.5 text-(--ui-text-secondary)',
      children
    })
  if (!file) return wrap('No plan selected.')
  if (view.status === 'loading') return wrap('Reading the plan…')
  if (view.status === 'err') return wrap(view.msg || 'Could not read the plan.')
  const body =
    typeof Streamdown === 'function'
      ? jsx(Streamdown, { mode: 'static', children: view.text || '' })
      : jsx('pre', {
          className:
            'whitespace-pre-wrap break-words font-mono text-[0.66rem] leading-relaxed',
          children: view.text || ''
        })
  if (!view.truncated) return wrap(body)
  return jsx('div', {
    className: 'h-full min-h-0 overflow-auto p-2.5 text-(--ui-text-secondary)',
    children: [
      jsx('div', {
        key: 'tr',
        className: 'mb-2 text-xs',
        children: 'Large file: view truncated at 512 KiB.'
      }),
      body
    ]
  })
}

export default {
  id: ID,
  name: 'Composer Modes',
  register(ctx) {
    ctxRef = ctx

    // v10.9: one-time purge of the false ':plan:edit' marks (v10.8 marked on OPENING the editor).
    try {
      if (!ctx.storage.get('marksPurgeV9', false)) {
        const purgeMap = readMarks()
        let purgeN = 0
        for (const k of Object.keys(purgeMap)) {
          if (k.endsWith(':plan:edit')) {
            delete purgeMap[k]
            purgeN += 1
          }
        }
        ctx.storage.set(MARKS_KEY, purgeMap)
        ctx.storage.set('marksPurgeV9', true)
        probe(`marks purge edit n=${purgeN}`)
      }
    } catch (_) {
      /* a purge must never break the register */
    }
    probe(
      `register ver=${VER} boot=${BOOT} notelocal=backend hash=${String((typeof location !== 'undefined' && location.hash) || '').slice(0, 24)}`
    )
    try {
      probe(
        `caps sid=${String(host.state.focusedSessionId.get())} backend=${String(backendSid())} req=${typeof host.request} evt=${typeof host.onEvent} dispose=${typeof ctx.onDispose}`
      )
    } catch (e) {
      probe(`caps err ${String(e)}`)
    }
    hydrateDialogs(ctx)
    hydrateQ(ctx)

    const onMarksStorage = (e) => {
      try {
        if (!e || e.key !== 'hermes.plugin.' + ID + '.' + MARKS_KEY) return
        bumpMarks()
      } catch (_) {}
    }
    window.addEventListener('storage', onMarksStorage)
    ctx.onDispose(() => window.removeEventListener('storage', onMarksStorage))

    // v10.8: real visibility of the reader pane (Read/Close toggle). Feature-detect in register.
    if (typeof host.paneVisibility === 'function') {
      const vis = host.paneVisibility(PLAN_READER_PANE)
      probe(`read vis=${vis.get() ? 1 : 0}`)
      ctx.onDispose(
        vis.listen((v) => {
          probe(`read vis=${v ? 1 : 0}`)
        })
      )
    }

    ctx.i18n.register({
      en: {
        modesLabel: 'Mode',
        tip: mode => `${mode} mode active`
      },
      es: {
        modesLabel: 'Modo',
        tip: mode => `Modo ${mode} activo`
      }
    })

    // Restore the persisted mode (sync API: get(key, fallback) → value).
    const savedMode = ctx.storage.get('mode', 'agent')
    if (MODES.some((m) => m.id === savedMode)) activeMode.set(savedMode)
    // On load: the backend starts in 'agent' (default). We push the persisted mode so that
    // the first send is already aligned even if the middleware does not get to run (steer, cards).
    void stageMode(ctx, activeMode.get())

    // ── Approval card: box + inline editor ──
    function PlanApproveCard({ file }) {
      const dialogs = useValue(planDialogs)
      const entry = (file && dialogs[file]) || EMPTY_DIALOG
      const modifyOpen = entry.open
      const draft = entry.draft
      const sending = entry.sending
      const rootRef = useRef(null)
      const [marks, applyMark, midRef] = useCardMarks('plan', ['go', 'edit'], rootRef, () => file)

      // v10.8: reader toggle — pane visible AND the file of THIS card.
      const readerFile = useValue(planReaderFile)
      const paneVis = useValue(
        typeof host.paneVisibility === 'function' ? host.paneVisibility(PLAN_READER_PANE) : planReaderOpen
      )
      const reading = paneVis === true && readerFile === file

      useEffect(() => {
        probe(`mount file=${file} boot=${BOOT}`)
        return () => probe(`unmount file=${file} boot=${BOOT}`)
      }, [file])

      if (!isValidPlanFile(file)) {
        probe(`skip invalid file=${String(file)}`)
        return null
      }

      const setEntry = (patch) => setDialogEntry(file, patch)

      const sendTurn = (text, key, freshMark) => {
        const body = String(text || '').slice(0, 450)
        if (!body.trim()) return
        probe(`send key=${key} len=${body.length} file=${file}`)
        setEntry({ sending: key })
        Promise.resolve()
          .then(() => submitTurn(body))
          .then(() => {
            probe(`send ok key=${key} file=${file}`)
            setEntry({ sending: null, open: false, draft: '' })
          })
          .catch((e) => {
            probe(`send err key=${key} ${String((e && e.message) || e)}`)
            if (key === 'go') applyMark('go', false)
            else if (key === 'edit' && freshMark) applyMark('edit', false)
            setEntry({ sending: null })
            notifySafe({ kind: 'error', message: 'Could not send. Try from the prompt box.' })
          })
      }

      const implementText = `Implement the plan at ${file} now. Follow it step by step.`

      return jsxs('div', {
        ref: rootRef,
        className: 'mt-3 rounded-lg border border-(--ui-stroke-secondary) p-3',
        children: [
          jsx('div', {
            key: 'head',
            className: 'mb-1 text-sm font-semibold',
            children: `Plan ready — what next? ${VER}·${BOOT}`
          }),
          jsx('div', {
            key: 'file',
            className: 'mb-2 truncate text-xs text-(--ui-text-tertiary)',
            children: file
          }),
          jsx('div', {
            key: 'hint',
            className: 'mb-3 text-xs text-(--ui-text-tertiary)',
            children: 'Full detail in the plan file.'
          }),
          jsxs('div', {
            key: 'row',
            className: 'flex flex-wrap items-center gap-1.5',
            children: [
              jsx(Button, {
                key: 'go',
                disabled: sending !== null || marks.go,
                'aria-pressed': marks.go,
                onClick: () => {
                  probe(`click go file=${file}`)
                  if (isMarked('plan', 'go', midRef.current, file)) {
                    probe('dup go')
                    return
                  }
                  applyMark('go', true)
                  sendTurn(implementText, 'go')
                },
                children: [
                  marks.go
                    ? jsx(Codicon, { key: 'tick-go', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  sending === 'go' ? 'Sending…' : 'Implement now'
                ]
              }),
              jsx(Button, {
                key: 'edit',
                disabled: sending !== null,
                'aria-pressed': marks.edit,
                onClick: () => {
                  probe(`click edit open file=${file}`)
                  setEntry({ open: true })
                },
                children: [
                  marks.edit
                    ? jsx(Codicon, { key: 'tick-edit', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  'Modificar'
                ]
              }),
              jsx(Button, {
                key: 'copy',
                disabled: sending !== null,
                onClick: () => {
                  probe('click copy')
                  try {
                    void ctx.os.writeClipboard(file)
                    notifySafe({ kind: 'info', message: 'Plan path copied.' })
                  } catch (_) {
                    /* clipboard best-effort */
                  }
                },
                children: 'Copiar path'
              }),
              jsx(Button, {
                key: 'read',
                disabled: sending !== null && !reading,
                'aria-pressed': reading,
                onClick: () => {
                  const freshVis =
                    typeof host.paneVisibility === 'function'
                      ? host.paneVisibility(PLAN_READER_PANE).get() === true
                      : planReaderOpen.get() === true
                  const fresh = freshVis && planReaderFile.get() === file
                  probe(`click read act=${fresh ? 'close' : 'open'} file=${file}`)
                  if (fresh) closePlanReader()
                  else openPlanReader(file)
                },
                children: [
                  jsx(Codicon, {
                    key: 'i',
                    name: reading ? 'close' : 'open-preview',
                    size: '0.75rem',
                    className: 'mr-1 shrink-0'
                  }),
                  reading ? 'Close plan' : 'Read plan'
                ]
              })
            ]
          }),
          jsx('div', {
            key: 'alt',
            className: 'mt-2 text-xs text-(--ui-text-tertiary)',
            children: 'Or write in the prompt box to adjust the plan.'
          }),
          modifyOpen && jsx('div', {
            key: 'editor',
            className: 'mt-2 rounded-md border border-(--ui-stroke-secondary) p-2',
            children: jsxs('div', {
              children: [
                jsx('div', {
                  key: 't',
                  className: 'mb-1 text-xs font-semibold',
                  children: 'Modify the plan'
                }),
                jsx('div', {
                  key: 'd',
                  className: 'mb-1 text-xs text-(--ui-text-tertiary)',
                  children: 'Describe what to change. Sent as a new turn that references the plan.'
                }),
                jsx(Textarea, {
                  key: 'ta',
                  value: draft,
                  rows: 5,
                  placeholder: 'Describe what to change in the plan…',
                  onChange: (e) => setEntry({ draft: e.target.value })
                }),
                jsxs('div', {
                  key: 'row',
                  className: 'mt-1.5 flex items-center gap-1.5',
                  children: [
                    jsx(Button, {
                      key: 'cancel',
                      disabled: sending !== null,
                      onClick: () => {
                        probe(`close reason=cancel file=${file}`)
                        setEntry({ open: false })
                      },
                      children: 'Cancel'
                    }),
                    jsx(Button, {
                      key: 'send',
                      disabled: sending !== null || !draft.trim(),
                      onClick: () => {
                        probe(`click edit send file=${file}`)
                        const freshEdit = !isMarked('plan', 'edit', midRef.current, file)
                        applyMark('edit', true)
                        sendTurn(`Update the plan at ${file} with these changes: ${draft}`, 'edit', freshEdit)
                      },
                      children: sending === 'edit' ? 'Enviando…' : 'Enviar cambios'
                    })
                  ]
                })
              ]
            })
          })
        ]
      })
    }

    ctx.register({
      id: 'plan-approve',
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: 'plan-approve',
        render: ({ attrs }) => jsx(PlanApproveCard, { file: attrs.file })
      }
    })

    // ── Plan questions card (v10.10) — stepper within the family ──
    function PlanQuestionsCard({ file }) {
      const all = useValue(planQState)
      const entry = (file && all[file]) || EMPTY_Q
      const rootRef = useRef(null)
      const beatRef = useRef(null)
      const lastPickRef = useRef(0)
      const [marks, applyMark, midRef] = useCardMarks('planq', ['send'], rootRef, () => file)
      const valid = isValidPlanQFile(file)
      const sent = marks.send === true
      const sending = entry.sending === 'send'
      const questions = Array.isArray(entry.questions) ? entry.questions : []
      const total = questions.length
      const answers = entry.answers || {}
      const index = Math.min(Math.max(Number.isInteger(entry.index) ? entry.index : 0, 0), Math.max(total - 1, 0))
      const current = questions[index] || null
      const a = answers[index] === undefined ? null : answers[index]

      useEffect(() => {
        probe(`pq mount file=${file} boot=${BOOT}`)
        return () => {
          if (beatRef.current) clearTimeout(beatRef.current)
          probe(`pq unmount file=${file} boot=${BOOT}`)
        }
      }, [file])

      useEffect(() => {
        if (entry.status === 'err') probe(`pq fallback reason=${valid ? 'read-err' : 'invalid-file'}`)
      }, [entry.status, valid])

      useEffect(() => {
        if (!valid || !file || sent) return undefined
        if (entry.questions) return undefined
        const abs = resolvePlanAbs(file)
        if (!abs) {
          setQEntry(file, { status: 'err', msg: 'No workspace (empty cwd): cannot resolve the path.' })
          return undefined
        }
        const read = typeof window !== 'undefined' && window.hermesDesktop ? window.hermesDesktop.readFileText : null
        if (typeof read !== 'function') {
          setQEntry(file, { status: 'err', msg: 'readFileText not available in this shell.' })
          return undefined
        }
        let alive = true
        setQEntry(file, { status: 'loading' })
        Promise.resolve(read(abs))
          .then((r) => {
            if (!alive) return
            if (r && r.binary) {
              setQEntry(file, { status: 'err', msg: 'The questions file is binary.' })
              probe(`pq load err file=${file} binary`)
              return
            }
            const list = normalizeQuestions(r ? r.text : '')
            if (!list || !list.length) {
              setQEntry(file, { status: 'err', msg: 'Could not read valid questions from the file.' })
              probe(`pq load err file=${file} parse`)
              return
            }
            setQEntry(file, { status: 'ok', questions: list, answers: {}, index: 0 })
            probe(`pq load ok n=${list.length}`)
          })
          .catch((e) => {
            if (!alive) return
            setQEntry(file, { status: 'err', msg: String((e && e.message) || e) })
            probe(`pq load err file=${file} msg=${String((e && e.message) || e)}`)
          })
        return () => {
          alive = false
        }
      }, [file, valid, sent, entry.questions])

      const tick = (key) => jsx(Codicon, { key, name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
      const answered = (ans) =>
        !!ans &&
        ((ans.kind === 'opt' && typeof ans.opt === 'string' && ans.opt.length > 0) ||
          (ans.kind === 'text' && typeof ans.text === 'string' && ans.text.trim().length > 0))
      const allAnswered = total > 0 && questions.every((_, i) => answered(answers[i]))
      const shownAnswer = (ans) => (!ans ? '' : ans.kind === 'opt' ? ans.opt || '' : ans.text || '')

      const pickOption = (opt) => {
        if (sending || sent) return
        if (Date.now() - lastPickRef.current < 300) {
          probe('pq guard skip')
          return
        }
        lastPickRef.current = Date.now()
        const prev = a || {}
        setQEntry(file, {
          answers: { ...answers, [index]: { kind: 'opt', opt, text: typeof prev.text === 'string' ? prev.text : '' } }
        })
        probe(`pq answer q=${index + 1} kind=opt`)
        try {
          haptic('selection')
        } catch (_) {}
        if (index < total - 1) {
          beatRef.current = setTimeout(() => {
            beatRef.current = null
            goto(index + 1)
          }, 200)
        }
      }
      const pickOther = () => {
        if (sending || sent) return
        if (Date.now() - lastPickRef.current < 300) {
          probe('pq guard skip')
          return
        }
        lastPickRef.current = Date.now()
        if (beatRef.current) {
          clearTimeout(beatRef.current)
          beatRef.current = null
          probe('pq beat cancel')
        }
        const prev = a || {}
        setQEntry(file, {
          answers: {
            ...answers,
            [index]: {
              kind: 'text',
              opt: typeof prev.opt === 'string' ? prev.opt : null,
              text: typeof prev.text === 'string' ? prev.text : ''
            }
          }
        })
        probe(`pq answer q=${index + 1} kind=text`)
        try {
          haptic('selection')
        } catch (_) {}
      }
      const typeText = (t) => {
        if (sending || sent) return
        const prev = a || {}
        setQEntry(file, {
          answers: {
            ...answers,
            [index]: { kind: 'text', opt: typeof prev.opt === 'string' ? prev.opt : null, text: t }
          }
        })
      }
      const goto = (i) => {
        if (beatRef.current) {
          clearTimeout(beatRef.current)
          beatRef.current = null
          probe('pq beat cancel')
        }
        const n = Math.min(Math.max(i, 0), Math.max(total - 1, 0))
        setQEntry(file, { index: n })
        probe(`pq step i=${n + 1}/${total}`)
      }
      const sendAnswers = () => {
        if (sending || sent || !allAnswered) return
        const fresh = !isMarked('planq', 'send', midRef.current, file)
        const map = {}
        questions.forEach((_, i) => {
          map[i] = shownAnswer(answers[i]) || '(no answer)'
        })
        applyMark('send', true)
        setQEntry(file, { sending: 'send' })
        submitPlanAnswers(planQAnswersBody(file, questions, map), 'answers')
          .then(() => {
            probe(`pq send ok file=${file}`)
            setQEntry(file, { sending: null })
          })
          .catch((e) => {
            probe(`pq send err ${String((e && e.message) || e)}`)
            if (fresh) applyMark('send', false)
            setQEntry(file, { sending: null })
            notifySafe({ kind: 'error', message: 'Could not send. Try from the prompt box.' })
          })
      }
      const sendContinue = () => {
        if (sending || sent) return
        const fresh = !isMarked('planq', 'send', midRef.current, file)
        applyMark('send', true)
        setQEntry(file, { sending: 'send' })
        submitPlanAnswers(planQContinueBody(file), 'continue')
          .then(() => {
            probe(`pq continue ok file=${file}`)
            setQEntry(file, { sending: null })
          })
          .catch((e) => {
            probe(`pq continue err ${String((e && e.message) || e)}`)
            if (fresh) applyMark('send', false)
            setQEntry(file, { sending: null })
            notifySafe({ kind: 'error', message: 'Could not send. Try from the prompt box.' })
          })
      }

      const header = jsx('div', {
        key: 'head',
        className: 'mb-1 text-sm font-semibold text-(--ui-text-primary)',
        children: `${total > 0 ? `Questions about the plan — ${index + 1}/${total}` : 'Questions about the plan'} · ${VER}·${BOOT}`
      })
      const shell = (children) =>
        jsxs('div', {
          ref: rootRef,
          className: 'mt-3 rounded-lg border border-(--ui-stroke-secondary) p-3',
          children
        })
      const fallbackBtn = jsx(Button, {
        key: 'cont',
        disabled: sending || sent,
        'aria-pressed': sent,
        onClick: sendContinue,
        children: [sent ? tick('tick-cont') : null, sending ? 'Sending…' : 'Continue without answering']
      })

      if (!valid) {
        return shell([
          header,
          jsx('div', {
            key: 'bad',
            className: 'mb-2 text-xs text-(--ui-text-tertiary)',
            children: 'Invalid directive.'
          }),
          fallbackBtn
        ])
      }
      if (entry.status === 'loading') {
        return shell([
          header,
          jsx('div', { key: 'ld', className: 'text-xs text-(--ui-text-tertiary)', children: 'Reading the questions…' })
        ])
      }
      if (entry.status === 'err' || !current) {
        return shell([
          header,
          jsx('div', {
            key: 'err',
            className: 'mb-2 text-xs text-(--ui-text-tertiary)',
            children: entry.msg || 'Could not read the questions.'
          }),
          fallbackBtn
        ])
      }

      const optionRow = (opt, i) => {
        const selected = !!a && a.kind === 'opt' && a.opt === opt
        return jsx(Button, {
          key: `opt-${i}`,
          variant: 'ghost',
          role: 'radio',
          'aria-checked': selected,
          disabled: sent || sending,
          className: cn('w-full justify-start text-left whitespace-normal', selected && 'bg-(--ui-control-active-background) text-(--ui-text-primary)'),
          style: selected ? { background: 'var(--ui-control-active-background)', color: 'var(--ui-text-primary)' } : undefined,
          onClick: () => pickOption(opt),
          children: [selected ? tick('tick-opt') : null, `${i + 1}. ${opt}`]
        })
      }
      const otherActive = !!a && a.kind === 'text'
      const otherRow = jsx(Button, {
        key: 'other',
        variant: 'ghost',
        role: 'radio',
        'aria-checked': otherActive,
        disabled: sent || sending,
        className: cn('w-full justify-start text-left whitespace-normal', otherActive && 'bg-(--ui-control-active-background) text-(--ui-text-primary)'),
        style: otherActive ? { background: 'var(--ui-control-active-background)', color: 'var(--ui-text-primary)' } : undefined,
        onClick: pickOther,
        children: [otherActive ? tick('tick-other') : null, `${current.options.length + 1}. Other answer…`]
      })
      const freeField = otherActive
        ? jsx(Textarea, {
            key: 'free',
            value: a && typeof a.text === 'string' ? a.text : '',
            maxLength: 500,
            rows: 3,
            placeholder: 'Write your answer…',
            disabled: sent || sending,
            className: 'mt-1.5',
            onChange: (e) => typeText(e && e.target ? e.target.value : '')
          })
        : null

      return shell([
        header,
        jsx('div', { key: 'q', className: 'mb-2 text-sm text-(--ui-text-secondary)', children: current.q }),
        jsxs('div', {
          key: 'opts',
          role: 'radiogroup',
          className: 'flex flex-col items-stretch gap-1',
          children: [...current.options.map((opt, i) => optionRow(opt, i)), otherRow, freeField]
        }),
        jsxs('div', {
          key: 'footer',
          className: 'mt-2 flex flex-wrap items-center gap-1.5',
          children: [
            jsx(Button, {
              key: 'back',
              disabled: sending || index === 0,
              onClick: () => goto(index - 1),
              children: 'Back'
            }),
            index < total - 1
              ? jsx(Button, {
                  key: 'next',
                  disabled: sending || sent || !answered(a),
                  onClick: () => goto(index + 1),
                  children: 'Next'
                })
              : jsx(Button, {
                  key: 'send',
                  disabled: sending || sent || !allAnswered,
                  'aria-pressed': sent,
                  onClick: sendAnswers,
                  children: [sent ? tick('tick-send') : null, sending ? 'Sending…' : 'Send answers']
                })
          ]
        }),
        jsx('div', {
          key: 'alt',
          className: 'mt-1.5 text-xs text-(--ui-text-tertiary)',
          children: sent
            ? 'To adjust something, write in the prompt box.'
            : 'Answer each question (option or text) and send them all together.'
        })
      ])
    }

    ctx.register({
      id: 'plan-questions',
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: 'plan-questions',
        render: ({ attrs }) => jsx(PlanQuestionsCard, { file: attrs.file })
      }
    })

    // ── Debug loop card ──
    function DebugLoopCard({ round }) {
      const sendingMap = useValue(debugSending)
      const rk = `r${round}`
      const sending = sendingMap[rk] || null
      const valid = ROUND_RE.test(String(round))
      const rootRef = useRef(null)
      const [marks, applyMark, midRef] = useCardMarks('debug', ['retry', 'fixed'], rootRef, () => null)

      useEffect(() => {
        probe(`mount debug-loop round=${round} boot=${BOOT}`)
        return () => probe(`unmount debug-loop round=${round} boot=${BOOT}`)
      }, [round])

      const setSending = (v) => {
        const next = { ...debugSending.get() }
        if (v === null) delete next[rk]
        else next[rk] = v
        debugSending.set(next)
      }

      const sendTurn = (text, key) => {
        if (sending !== null) return
        const body = String(text || '').slice(0, 450)
        if (!body.trim()) return
        probe(`send key=${key} len=${body.length} round=${round}`)
        setSending(key)
        Promise.resolve()
          .then(() => submitTurn(body))
          .then(() => {
            probe(`send ok key=${key} round=${round}`)
            setSending(null)
          })
          .catch((e) => {
            probe(`send err key=${key} ${String((e && e.message) || e)}`)
            if (key === 'retry' || key === 'fixed') applyMark(key, false)
            setSending(null)
            notifySafe({ kind: 'error', message: 'Could not send. Try from the prompt box.' })
          })
      }

      const nextRound = (Number(round) || 0) + 1
      const stillBrokenText = `I already did the steps and the bug is STILL NOT WORKING. Read the debug logs/instrumentation output, find the root cause with evidence, apply the fix, and reply with the next sequential steps for me to test. If there are no logs or no new evidence, do not guess: say what is missing, extend or fix the logging if it failed silently, and ask me to re-run the steps to capture it. End with a new ::debug-loop{round="${nextRound}"} directive.`
      const fixedText =
        'The bug is FIXED. Remove ALL the debug instrumentation you added in ANY round (logs, scripts, config flags). Do not rely on memory: search the project for the log strings/markers you introduced and clean every file you touched. Restore the code to its pre-debug state, list each file cleaned, and flag anything you could not fully restore.'

      return jsxs('div', {
        ref: rootRef,
        className: 'mt-3 rounded-lg border border-(--ui-stroke-secondary) p-3',
        children: [
          jsx('div', {
            key: 'head',
            className: 'mb-1 text-sm font-semibold',
            children: `Debug mode — round ${valid ? round : '?'} ${VER}·${BOOT}`
          }),
          jsx('div', {
            key: 'hint',
            className: 'mb-3 text-xs text-(--ui-text-tertiary)',
            children: 'Follow the steps in the message above; then use a button.'
          }),
          jsxs('div', {
            key: 'row',
            className: 'flex flex-wrap items-center gap-1.5',
            children: [
              jsx(Button, {
                key: 'broken',
                disabled: sending !== null || marks.retry,
                'aria-pressed': marks.retry,
                onClick: () => {
                  probe(`click retry round=${round}`)
                  if (isMarked('debug', 'retry', midRef.current, null)) {
                    probe('dup retry')
                    return
                  }
                  applyMark('retry', true)
                  sendTurn(stillBrokenText, 'retry')
                },
                children: [
                  marks.retry
                    ? jsx(Codicon, { key: 'tick-retry', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  sending === 'retry' ? 'Sending…' : "I already did the steps, it's still not working"
                ]
              }),
              jsx(Button, {
                key: 'fixed',
                disabled: sending !== null || marks.fixed,
                'aria-pressed': marks.fixed,
                onClick: () => {
                  probe(`click fixed round=${round}`)
                  if (isMarked('debug', 'fixed', midRef.current, null)) {
                    probe('dup fixed')
                    return
                  }
                  applyMark('fixed', true)
                  sendTurn(fixedText, 'fixed')
                },
                children: [
                  marks.fixed
                    ? jsx(Codicon, { key: 'tick-fixed', name: 'check', size: '0.75rem', className: 'mr-1 shrink-0' })
                    : null,
                  sending === 'fixed' ? 'Sending…' : 'Mark as fixed'
                ]
              })
            ]
          })
        ]
      })
    }

    ctx.register({
      id: 'debug-loop',
      area: TRANSCRIPT_DIRECTIVE_AREA,
      data: {
        name: 'debug-loop',
        render: ({ attrs }) => jsx(DebugLoopCard, { round: attrs.round })
      }
    })

    // ── Auto-reset: when the plan arrives, go back to agent so follow-ups
    //    (modify / text in the box) are NOT re-prefixed with /plan ──
    if (host && typeof host.onEvent === 'function') {
      const disposeEvent = host.onEvent('message.complete', (event) => {
        try {
          const _pl = (event && event.payload) || {}
          probe('mc hit mode=' + activeMode.get() + ' keys=' + Object.keys(_pl).join('+') + ' tlen=' + String(typeof _pl.text === 'string' ? _pl.text.length : -1) + ' dir=' + String(typeof _pl.text === 'string' && _pl.text.indexOf('::') >= 0))
          if (activeMode.get() !== 'plan') return
          const payload = (event && event.payload) || {}
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text) return
          if (text.includes('::plan-questions')) {
            applyMode(ctx, 'agent')
            probe('auto-reset planq->agent')
            notifySafe({
              kind: 'info',
              message: 'The agent has questions — answer in the card. Mode reset to Agent.'
            })
            return
          }
          if (text.includes('::plan-approve') || text.includes('.hermes/plans/')) {
            applyMode(ctx, 'agent')
            probe('auto-reset to agent')
            notifySafe({
              kind: 'info',
              message: 'Plan ready — mode reset to Agent. Implement, modify, or write in the prompt.'
            })
          }
        } catch (_) {
          /* a listener must never break the app dispatch */
        }
      })
      if (typeof disposeEvent === 'function') ctx.onDispose(disposeEvent)
    }
    // ── Auto-reset of the debug loop: when the card appears (::debug-loop
    //    in the reply), go back to agent. Otherwise each typed message gets
    //    re-prefixed with the contract and RE-INSTRUMENTS the project ──
    if (host && typeof host.onEvent === 'function') {
      const disposeDebugEvent = host.onEvent('message.complete', (event) => {
        try {
          if (activeMode.get() !== 'debug') return
          const payload = (event && event.payload) || {}
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text.includes('::debug-loop')) return
          applyMode(ctx, 'agent')
          probe('auto-reset debug->agent')
          notifySafe({ kind: 'info', message: 'Debug card ready — continue with its buttons. Mode reset to Agent.' })
        } catch (_) {
          /* a listener must never break the dispatch */
        }
      })
      if (typeof disposeDebugEvent === 'function') ctx.onDispose(disposeDebugEvent)
    }

    // Flush the mirrors and clear the debounce on unload/reload.
    ctx.onDispose(() => {
      clearTimeout(saveTimer)
      clearTimeout(saveQTimer)
      flushDialogs()
      flushQ()
      if (planReaderDispose) {
        const d = planReaderDispose
        planReaderDispose = null
        try {
          d()
        } catch (_) {
          /* closing a panel must never break the dispose */
        }
      }
      probe(`dispose boot=${BOOT}`)
    })

    // ── Single mode button in the composer bar ──
    function ModeButton() {
      const mode = useValue(activeMode)
      const sid = useValue(host.state.focusedSessionId)
      const current = MODES.find((m) => m.id === mode) || MODES[0]

      // Reset on new session. D1 (advice MODEB-V10): birth from a draft
      // (null to id) is NOT a new session — choosing a mode in a draft survives
      // the first send and the persisted mode is not clobbered after a reload.
      const lastSid = useRef(sid)
      useEffect(() => {
        if (sid === lastSid.current) return
        const prevSid = lastSid.current
        lastSid.current = sid
        if (prevSid === null && sid !== null) return
        if (activeMode.get() !== 'agent') {
          applyMode(ctx, 'agent', backendSid())
          probe(`session change reset sid=${String(sid)} backend=${String(backendSid())}`)
        }
      }, [sid])

      return jsxs('div', {
        className: 'flex shrink-0 items-center gap-0.5',
        children: [
          jsx(Tip, {
            key: 'mode',
            label: `${current.hint} · clic o Shift+Tab: Ask → Agent → Plan → Debug · ${VER}·${BOOT}`,
            children: jsxs('button', {
              type: 'button',
              'data-mode': current.id,
              'aria-label': `${current.label} mode — click or Shift+Tab to change`,
              className: cn(
                'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[0.6875rem] font-medium transition-opacity',
                'hover:opacity-90'
              ),
              style: {
                backgroundColor: MODE_BG[current.id] || MODE_BG.agent,
                color: 'var(--ui-text-primary)'
              },
              onClick: cycleMode,
              children: [
                jsx(Codicon, { key: 'i', name: current.icon, size: '0.75rem', className: 'shrink-0' }),
                current.label,
                jsx(Codicon, { key: 'c', name: 'chevron-down', size: '0.625rem', className: 'shrink-0 opacity-60' })
              ]
            })
          })
        ]
      })
    }

    ctx.register({
      id: 'pills',
      area: 'composer.actions',
      order: 10,
      render: () => jsx(ModeButton, {})
    })

    // ── Mode cycle: sole owner — the button and Shift+Tab both call it ──
    function cycleMode() {
      const prev = activeMode.get()
      const idx = MODES.findIndex((m) => m.id === prev)
      const next = MODES[(idx + 1) % MODES.length].id // idx -1 (unknown mode) → ask
      applyMode(ctx, next)
      probe(`cycle ${prev}->${next}`)
    }

    // ── Shortcut: Shift+Tab cycles the mode (capture on window, scope work-area) ──
    const WORK_AREA =
      '[data-slot="composer-root"], [data-slot="composer-surface"], [data-slot="composer-bounds"]'
    const SKIP_TARGET =
      '.xterm, [data-terminal], [role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]'
    const onModeKey = (e) => {
      if (e.key !== 'Tab' || !e.shiftKey) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.repeat) return
      if (typeof document === 'undefined' || !document.hasFocus()) return
      const el = e.target instanceof Element ? e.target : null
      if (!el) return
      if (el.closest(SKIP_TARGET)) return
      const isBody = el === document.body || el === document.documentElement
      if (!isBody && !el.closest(WORK_AREA)) return
      try {
        cycleMode()
        e.preventDefault()
        e.stopPropagation()
      } catch (_) {
        /* a listener must never break the app dispatch */
      }
    }
    window.addEventListener('keydown', onModeKey, true)
    ctx.onDispose(() => window.removeEventListener('keydown', onModeKey, true))

    // ── Middleware v13: NOTIFIES the backend of the mode and never touches the text ──
    //    The await guarantees the backend already knows the mode (and its note) by the
    //    time the turn is admitted; the queue re-runs the chain at drain, so a queued
    //    send uses the live mode at drain. If the backend does not respond, the send
    //    goes out anyway (mode cosmetic) — a middleware never eats a message.
    ctx.register({
      id: 'rewrite',
      area: 'composer.middleware',
      order: 10,
      data: {
        handler: async (draft) => {
          try {
            const mode = activeMode.get()
            const text = String(draft.text || '').trim()
            if (!text) return draft
            const hasAtts = !!(draft.attachments && draft.attachments.length)
            // Explicit slash wins: text that IS a command never carries a note.
            if (!hasAtts && SLASH_SHAPE_RE.test(text)) return draft
            await stageMode(ctx, mode)
            probe('mw v13 mode=' + mode)
            return draft
          } catch (_) {
            return draft
          }
        }
      }
    })
  }
}
