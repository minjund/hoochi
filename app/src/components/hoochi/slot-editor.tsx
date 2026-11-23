import type { ExistingHook, Skill } from '../../lib/backend'
import { eventHint, eventName, forAgent, UI, type Lang } from '../../lib/i18n'
import { itemFilled, type Agent, type Item, type ItemKind, type Slot, type SkillRule } from '../../lib/lifecycle'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { IconButton } from '../ui/icon-button'
import { SegmentedControl } from '../ui/segmented-control'
import { Select } from '../ui/select'
import { Switch } from '../ui/switch'
import { TextArea } from '../ui/text-area'
import { TextField } from '../ui/text-field'

type Props = {
  slot: Slot
  items: Item[]
  skills: Skill[]
  lang: Lang
  agent: Agent
  /** how this scope relates to the others for this moment */
  note?: string
  /** hooks already set up outside hoochi for this moment, shown read-only */
  existing?: ExistingHook[]
  /** switch an existing hook off or back on */
  onToggleExisting?(hook: ExistingHook, on: boolean): void
  /** when each item last ran, by its id (ms) */
  lastRun?: Readonly<Record<string, number>>
  /** more about this moment, shown under its explanation */
  extra?: ReactNode
  /** Claude Code never hands this moment to hoochi here (sec-default passes its classic hook by) */
  blocked?: boolean
  /** a saved item changed: its content by Save, its switch at once */
  onChange(item: Item): void
  onRemove(id: string): void
  /** a new, empty item for this moment (not saved until you press Save) */
  makeItem(): Item
  /** a new item saved */
  onAdd(item: Item): void
  onBack(): void
  /** where what is put in here applies, as words for the preview ("in the shop project") */
  where?: string
  /** put a saved item into other places too (opens the sheet) */
  onSend?(item: Item): void
  /** opens with this new item already filled in (from a sentence), not saved until Save */
  startWith?: Item | null
}

/** What Save writes; the on/off switch and Delete act at once. */
type Draft = Pick<Item, 'kind' | 'text' | 'command' | 'mode' | 'skill' | 'tools' | 'once'> & { rules: SkillRule[] }
const draftOf = (i: Item): Draft => ({
  kind: i.kind,
  text: i.text,
  command: i.command,
  mode: i.mode,
  skill: i.skill,
  rules: i.rules ?? [],
  tools: i.tools,
  once: i.once,
})
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

const RemoveIcon = (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="m4.5 4.5 7 7m0-7-7 7" strokeLinecap="round" />
  </svg>
)

const BackIcon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M10 3.5 5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Everything put into one moment, each item editable in place. */
export function SlotEditor({
  slot,
  items,
  skills,
  lang,
  agent,
  note,
  existing = [],
  onToggleExisting,
  lastRun = {},
  extra,
  blocked = false,
  onChange,
  onRemove,
  makeItem,
  onAdd,
  onBack,
  where = '',
  onSend,
  startWith = null,
}: Props) {
  const t = UI[lang]
  // A new item waits here until it is saved; cards with unsaved changes are listed by id.
  const [fresh, setFresh] = useState<Item | null>(startWith)
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set())
  const [leaving, setLeaving] = useState(false)
  const markUnsaved = (id: string, dirty: boolean) =>
    setUnsaved(prev => {
      if (prev.has(id) === dirty) return prev
      const next = new Set(prev)
      if (dirty) next.add(id)
      else next.delete(id)
      return next
    })
  const pending = unsaved.size > 0 || fresh !== null
  const back = () => (pending ? setLeaving(true) : onBack())
  // Esc goes back too (not while a popup over the panel is open: Esc closes that).
  const backRef = useRef(back)
  backRef.current = back
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.hw-modal')) return
      backRef.current()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  // A plugin hook switches the whole plugin off, so that asks first.
  const [asking, setAsking] = useState<ExistingHook | null>(null)
  // One existing hook at a time opens to show what it does.
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="hw-editor">
      <div className="hw-editor-head">
        <Button variant="secondary" size="sm" icon={BackIcon} onClick={back} title="Esc">
          {t.back}
        </Button>
      </div>
      {leaving && (
        <div className="hw-confirm" role="alertdialog">
          <span>{t.unsavedLeave}</span>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setLeaving(false)}>
              {t.keepEditing}
            </Button>
            <Button size="sm" variant="destructive" onClick={onBack}>
              {t.leaveAnyway}
            </Button>
          </div>
        </div>
      )}
      <p className="hw-step">
        <span>1</span>
        {t.stepWhen}
      </p>
      <div className="hw-editor-title">
        <strong title={slot.event}>{eventName(slot.event, lang, agent)}</strong>
        {!slot.canInject && <span className="hw-tag">{t.onlyCommandsTag}</span>}
        {blocked && <span className="hw-tag hw-tag-blocked">{t.blockedTag}</span>}
      </div>
      <p className="hw-editor-hint">{eventHint(slot.event, lang, agent)}</p>
      {blocked && (
        <p className="hw-blocked" data-blocked>
          {t.blockedNote}
        </p>
      )}
      {note && <p className="hw-note">{note}</p>}
      {extra}

      {existing.length > 0 && (
        <section className="hw-existing" aria-label={t.existingTitle}>
          <div className="hw-existing-title">
            {t.existingTitle} <span>{existing.filter(h => !h.off).length}</span>
          </div>
          <ul>
            {existing.map(h => (
              <li key={h.id} data-off={h.off || undefined}>
                <div className="hw-existing-row">
                  <button
                    type="button"
                    className="hw-existing-text"
                    aria-expanded={open === h.id}
                    title={t.whatItRuns}
                    onClick={() => setOpen(open === h.id ? null : h.id)}
                  >
                    <b>
                      <span className="hw-existing-caret" aria-hidden="true">
                        {open === h.id ? '▾' : '▸'}
                      </span>{' '}
                      {h.origin?.name ?? h.name}
                    </b>
                    <span>
                      {h.off ? `${t.existingOff} · ` : ''}
                      {t.existingFrom(h.from)}
                      {h.origin && h.origin.name !== h.name ? ` · ${h.name}` : ''}
                      {h.matcher ? ` · ${t.onlyWhen(h.matcher)}` : ''}
                    </span>
                  </button>
                  {onToggleExisting && (
                    <Switch
                      size="sm"
                      aria-label={t.existingSwitch(h.name)}
                      title={h.toggle === 'plugin' ? t.pluginOnly : undefined}
                      checked={!h.off}
                      onChange={e => {
                        const on = e.currentTarget.checked
                        if (!on && h.toggle === 'plugin') setAsking(h)
                        else onToggleExisting(h, on)
                      }}
                    />
                  )}
                </div>
                {open === h.id && <HookDetail hook={h} lang={lang} />}
              </li>
            ))}
          </ul>
          {asking && (
            <div className="hw-confirm" role="alertdialog">
              <span>{t.pluginWhole(asking.from.replace('plugin:', ''))}</span>
              <div>
                <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                  {t.cancel}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    onToggleExisting?.(asking, false)
                    setAsking(null)
                  }}
                >
                  {t.turnOffPlugin}
                </Button>
              </div>
            </div>
          )}
          <p className="hw-editor-hint">
            {t.existingNote} {t.reopenNote}
          </p>
        </section>
      )}

      {items.length === 0 && <p className="hw-editor-empty">{t.empty}</p>}

      {items.map(item => (
        <ItemCard
          key={item.id}
          item={item}
          slot={slot}
          skills={skills}
          lang={lang}
          agent={agent}
          onSave={onChange}
          onSwitch={enabled => onChange({ ...item, enabled })}
          onRemove={() => {
            markUnsaved(item.id, false)
            onRemove(item.id)
          }}
          onDirty={dirty => markUnsaved(item.id, dirty)}
          lastRun={lastRun[item.id]}
          where={where}
          onSend={onSend ? () => onSend(item) : undefined}
        />
      ))}

      {fresh ? (
        <ItemCard
          key={fresh.id}
          item={fresh}
          isNew
          slot={slot}
          skills={skills}
          lang={lang}
          agent={agent}
          onSave={item => {
            onAdd(item)
            setFresh(null)
          }}
          onSwitch={enabled => setFresh({ ...fresh, enabled })}
          onRemove={() => setFresh(null)}
          onDirty={() => undefined}
          where={where}
        />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={blocked}
          title={blocked ? t.blockedShort : undefined}
          onClick={() => setFresh(makeItem())}
        >
          + {t.add}
        </Button>
      )}
    </div>
  )
}

function ItemCard({
  item,
  slot,
  skills,
  lang,
  agent,
  isNew = false,
  onSave,
  onSwitch,
  onRemove,
  onDirty,
  lastRun,
  where,
  onSend,
}: {
  item: Item
  slot: Slot
  skills: Skill[]
  lang: Lang
  agent: Agent
  /** not saved yet: Cancel instead of Delete, and Save adds it */
  isNew?: boolean
  onSave(item: Item): void
  onSwitch(enabled: boolean): void
  onRemove(): void
  onDirty(dirty: boolean): void
  /** when it last ran (ms), if it has */
  lastRun?: number
  where: string
  onSend?(): void
}) {
  const t = UI[lang]
  const say = (text: string) => forAgent(text, agent)
  // What you typed stays here until Save; the saved item changing elsewhere (switched off in
  // another window) does not throw it away.
  const saved = draftOf(item)
  const [draft, setDraft] = useState<Draft>(saved)
  const [base, setBase] = useState<Draft>(saved)
  if (!same(base, saved)) {
    setBase(saved)
    if (same(draft, base)) setDraft(saved)
  }
  const dirty = isNew || !same(draft, saved)
  const empty = !itemFilled({ ...item, ...draft })
  useEffect(() => onDirty(!isNew && dirty), [dirty, isNew, onDirty])
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }))
  const save = () => {
    if (!dirty || empty) return
    // Rows left wholly blank go; a half-filled one stays to finish later (the plugin skips it).
    onSave({ ...item, ...draft, rules: draft.rules.filter(r => r.when.trim() !== '' || r.skill !== '') })
  }
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    }
  }
  const item_ = { ...item, ...draft }
  const kinds: { value: ItemKind; label: string; disabled?: boolean }[] = [
    { value: 'text', label: t.kinds.text, disabled: !slot.canInject },
    { value: 'command', label: t.kinds.command },
    { value: 'skill', label: t.kinds.skill, disabled: !slot.canInject },
    { value: 'rules', label: t.kinds.rules, disabled: !slot.canInject },
  ]
  const blankRule: SkillRule = { when: '', skill: '' }
  const setRule = (at: number, patch: Partial<SkillRule>) =>
    set({ rules: draft.rules.map((r, i) => (i === at ? { ...r, ...patch } : r)) })

  return (
    <Card className="hw-item" data-unsaved={dirty || undefined}>
      <CardContent className="hw-item-body" onKeyDown={onKey}>
        <p className="hw-step">
          <span>2</span>
          {t.stepWhat}
        </p>
        <div className="hw-item-row">
          <SegmentedControl
            size="sm"
            aria-label={t.kindLabel}
            options={kinds}
            value={item_.kind}
            onChange={kind =>
              set(kind === 'rules' && draft.rules.length === 0 ? { kind, rules: [blankRule] } : { kind })
            }
          />
          <Switch
            size="sm"
            checked={item.enabled}
            onChange={e => onSwitch(e.target.checked)}
            label={t.enabled}
          />
        </div>

        {item_.kind === 'text' && (
          <TextArea
            aria-label={t.kinds.text}
            placeholder={t.textPlaceholder}
            minRows={2}
            maxRows={8}
            value={item_.text}
            onChange={e => set({ text: e.target.value })}
          />
        )}

        {item_.kind === 'command' && (
          <>
            <TextField
              aria-label={t.kinds.command}
              placeholder={t.commandPlaceholder}
              size="sm"
              prefix="$ "
              inputClassName="hw-mono"
              value={item_.command}
              onChange={e => set({ command: e.target.value })}
            />
            {slot.canInject ? (
              <div className="hw-field">
                <span className="hw-field-label">{say(t.modeLabel)}</span>
                <SegmentedControl
                  size="sm"
                  aria-label={say(t.modeLabel)}
                  options={[
                    { value: 'always', label: t.modes.always },
                    { value: 'onFail', label: t.modes.onFail },
                  ]}
                  value={item_.mode}
                  onChange={mode => set({ mode })}
                />
              </div>
            ) : (
              <p className="hw-editor-hint">{say(t.sideEffect)}</p>
            )}
          </>
        )}

        {item_.kind === 'skill' && (
          <Select
            size="sm"
            aria-label={t.kinds.skill}
            placeholder={skills.length ? t.pickSkill : t.noSkills}
            options={skills.map(s => ({ value: s.name, label: s.name, description: s.description }))}
            value={item_.skill || null}
            onChange={skill => set({ skill })}
          />
        )}

        {item_.kind === 'rules' && (
          <div className="hw-field">
            <span className="hw-field-label">{say(t.rulesHint)}</span>
            {item_.rules.map((rule, at) => (
              <div className="hw-rule" key={at}>
                <TextField
                  size="sm"
                  aria-label={t.ruleWhen}
                  placeholder={t.ruleWhen}
                  value={rule.when}
                  onChange={e => setRule(at, { when: e.target.value })}
                />
                <Select
                  size="sm"
                  aria-label={t.kinds.skill}
                  placeholder={skills.length ? t.pickSkill : t.noSkills}
                  options={skills.map(s => ({ value: s.name, label: s.name, description: s.description }))}
                  value={rule.skill || null}
                  onChange={skill => setRule(at, { skill })}
                />
                <IconButton
                  size="sm"
                  icon={RemoveIcon}
                  label={t.ruleRemove}
                  onClick={() => set({ rules: draft.rules.filter((_, i) => i !== at) })}
                />
              </div>
            ))}
            <div>
              <Button variant="ghost" size="sm" onClick={() => set({ rules: [...draft.rules, blankRule] })}>
                + {t.ruleAdd}
              </Button>
            </div>
          </div>
        )}

        {slot.hasTools && (
          <TextField
            size="sm"
            aria-label={t.tools}
            placeholder={t.tools}
            value={item_.tools}
            onChange={e => set({ tools: e.target.value })}
          />
        )}

        <div className="hw-preview" aria-live="polite">
          <span>✓ {t.previewTitle}</span>
          <p>
            {t.preview({
              where,
              moment: eventName(slot.event, lang, agent),
              ai: t.agents[agent],
              kind: item_.kind,
              text: item_.text.trim(),
              command: item_.command.trim(),
              skill: item_.skill,
              onFail: item_.mode === 'onFail',
              inject: slot.canInject,
              tools: slot.hasTools ? item_.tools.trim() : '',
              once: item_.once,
            })}
          </p>
        </div>
        <div className="hw-item-row">
          <Switch
            size="sm"
            checked={item_.once}
            onChange={e => set({ once: e.target.checked })}
            label={t.once}
            description={t.onceHint}
          />
          <div className="hw-item-actions">
            {onSend && !isNew && !dirty && !empty && (
              <Button variant="secondary" size="sm" onClick={onSend}>
                {t.sendOne}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onRemove}>
              {isNew ? t.cancel : t.remove}
            </Button>
            {dirty && !isNew && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(saved)}>
                {t.revert}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || empty}
              title={empty ? t.saveEmpty : '⌘↵'}
              onClick={save}
            >
              {dirty ? t.save : t.savedDone}
            </Button>
          </div>
        </div>
        <p className="hw-item-ran">
          {lastRun ? t.lastRan(t.ago(Math.max(0, Date.now() - lastRun))) : t.neverRan}
        </p>
      </CardContent>
    </Card>
  )
}

/** What an existing hook runs, when, for how long, and a line about it. */
function HookDetail({ hook, lang }: { hook: ExistingHook; lang: Lang }) {
  const t = UI[lang]
  const [copied, setCopied] = useState(false)
  const body = hook.body || hook.detail
  const copy = () => {
    const done = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
    const fallback = () => {
      const area = document.createElement('textarea')
      area.value = body
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
      done()
    }
    if (navigator.clipboard) void navigator.clipboard.writeText(body).then(done, fallback)
    else fallback()
  }
  return (
    <dl className="hw-run">
      <dt>{t.runKinds[hook.kind] ?? hook.kind}</dt>
      <dd>
        <code>{body}</code>
        <Button size="sm" variant="ghost" onClick={copy}>
          {copied ? t.copyDone : t.copy}
        </Button>
      </dd>
      <dt>{t.runWhen}</dt>
      <dd>
        {hook.matcher ? t.onlyWhen(hook.matcher) : t.runAlways}
        {hook.timeout ? ` · ${t.runLimit(hook.timeout)}` : ''}
      </dd>
      {hook.about && (
        <>
          <dt>{t.runAbout}</dt>
          <dd className="hw-run-about" title={hook.about}>
            {hook.about}
          </dd>
        </>
      )}
      <dt>{t.runOrigin}</dt>
      <dd>
        {hook.origin ? (
          <>
            {t.originApp(hook.origin.name)}
            <br />
            <code>{hook.origin.path}</code>
          </>
        ) : hook.from.startsWith('plugin:') ? (
          t.originPlugin(hook.from.slice('plugin:'.length))
        ) : (
          t.originUnknown
        )}
      </dd>
      {hook.file && (
        <>
          <dt>{t.runFile}</dt>
          <dd>
            <code>{hook.file}</code>
          </dd>
        </>
      )}
    </dl>
  )
}
