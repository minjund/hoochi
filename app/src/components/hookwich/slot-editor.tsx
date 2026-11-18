import type { Skill } from '../../lib/backend'
import { eventHint, eventName, UI, type Lang } from '../../lib/i18n'
import type { Item, ItemKind, Slot } from '../../lib/lifecycle'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
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
  onChange(item: Item): void
  onRemove(id: string): void
  onAdd(): void
  onBack(): void
}

/** Everything put into one moment, each item editable in place. */
export function SlotEditor({ slot, items, skills, lang, onChange, onRemove, onAdd, onBack }: Props) {
  const t = UI[lang]
  return (
    <div className="hw-editor">
      <div className="hw-editor-head">
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t.back}
        </Button>
      </div>
      <div className="hw-editor-title">
        <strong>{eventName(slot.event, lang)}</strong>
        <code>{slot.event}</code>
        {!slot.canInject && <span className="hw-tag">{t.onlyCommandsTag}</span>}
      </div>
      <p className="hw-editor-hint">{eventHint(slot.event, lang)}</p>

      {items.length === 0 && <p className="hw-editor-empty">{t.empty}</p>}

      {items.map(item => (
        <ItemCard
          key={item.id}
          item={item}
          slot={slot}
          skills={skills}
          lang={lang}
          onChange={onChange}
          onRemove={() => onRemove(item.id)}
        />
      ))}

      <Button variant="secondary" size="sm" onClick={onAdd}>
        + {t.add}
      </Button>
    </div>
  )
}

function ItemCard({
  item,
  slot,
  skills,
  lang,
  onChange,
  onRemove,
}: {
  item: Item
  slot: Slot
  skills: Skill[]
  lang: Lang
  onChange(item: Item): void
  onRemove(): void
}) {
  const t = UI[lang]
  const set = (patch: Partial<Item>) => onChange({ ...item, ...patch })
  const kinds: { value: ItemKind; label: string; disabled?: boolean }[] = [
    { value: 'text', label: t.kinds.text, disabled: !slot.canInject },
    { value: 'command', label: t.kinds.command },
    { value: 'skill', label: t.kinds.skill, disabled: !slot.canInject },
  ]

  return (
    <Card className="hw-item">
      <CardContent className="hw-item-body">
        <div className="hw-item-row">
          <SegmentedControl
            size="sm"
            aria-label={t.kindLabel}
            options={kinds}
            value={item.kind}
            onChange={kind => set({ kind })}
          />
          <Switch
            size="sm"
            checked={item.enabled}
            onChange={e => set({ enabled: e.target.checked })}
            label={t.enabled}
          />
        </div>

        {item.kind === 'text' && (
          <TextArea
            aria-label={t.kinds.text}
            placeholder={t.textPlaceholder}
            minRows={2}
            maxRows={8}
            value={item.text}
            onChange={e => set({ text: e.target.value })}
          />
        )}

        {item.kind === 'command' && (
          <>
            <TextField
              aria-label={t.kinds.command}
              placeholder={t.commandPlaceholder}
              size="sm"
              prefix="$ "
              inputClassName="hw-mono"
              value={item.command}
              onChange={e => set({ command: e.target.value })}
            />
            {slot.canInject ? (
              <div className="hw-field">
                <span className="hw-field-label">{t.modeLabel}</span>
                <SegmentedControl
                  size="sm"
                  aria-label={t.modeLabel}
                  options={[
                    { value: 'always', label: t.modes.always },
                    { value: 'onFail', label: t.modes.onFail },
                  ]}
                  value={item.mode}
                  onChange={mode => set({ mode })}
                />
              </div>
            ) : (
              <p className="hw-editor-hint">{t.sideEffect}</p>
            )}
          </>
        )}

        {item.kind === 'skill' && (
          <Select
            size="sm"
            aria-label={t.kinds.skill}
            placeholder={skills.length ? t.pickSkill : t.noSkills}
            options={skills.map(s => ({ value: s.name, label: s.name, description: s.description }))}
            value={item.skill || null}
            onChange={skill => set({ skill })}
          />
        )}

        {slot.hasTools && (
          <TextField
            size="sm"
            aria-label={t.tools}
            placeholder={t.tools}
            value={item.tools}
            onChange={e => set({ tools: e.target.value })}
          />
        )}

        <div className="hw-item-row">
          <Switch
            size="sm"
            checked={item.once}
            onChange={e => set({ once: e.target.checked })}
            label={t.once}
            description={t.onceHint}
          />
          <Button variant="ghost" size="sm" onClick={onRemove}>
            {t.remove}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
