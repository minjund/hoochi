import type { Skill } from '../../lib/backend'
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
  onChange(item: Item): void
  onRemove(id: string): void
  onAdd(): void
  onBack(): void
}

/** Everything put into one slot, each item editable in place. */
export function SlotEditor({ slot, items, skills, onChange, onRemove, onAdd, onBack }: Props) {
  return (
    <div className="hw-editor">
      <div className="hw-editor-head">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Lifecycle
        </Button>
        <div className="hw-editor-title">
          <strong>{slot.event}</strong>
          {!slot.canInject && <code>commands only</code>}
        </div>
      </div>
      <p className="hw-editor-hint">{slot.hint}</p>

      {items.length === 0 && <p className="hw-editor-empty">Nothing here yet.</p>}

      {items.map(item => (
        <ItemCard
          key={item.id}
          item={item}
          slot={slot}
          skills={skills}
          onChange={onChange}
          onRemove={() => onRemove(item.id)}
        />
      ))}

      <Button variant="secondary" size="sm" onClick={onAdd}>
        + Add to {slot.event}
      </Button>
    </div>
  )
}

function ItemCard({
  item,
  slot,
  skills,
  onChange,
  onRemove,
}: {
  item: Item
  slot: Slot
  skills: Skill[]
  onChange(item: Item): void
  onRemove(): void
}) {
  const set = (patch: Partial<Item>) => onChange({ ...item, ...patch })
  const kinds: { value: ItemKind; label: string; disabled?: boolean }[] = [
    { value: 'text', label: 'Text', disabled: !slot.canInject },
    { value: 'command', label: 'Command' },
    { value: 'skill', label: 'Skill', disabled: !slot.canInject },
  ]

  return (
    <Card className="hw-item">
      <CardContent className="hw-item-body">
        <div className="hw-item-row">
          <SegmentedControl
            size="sm"
            aria-label="What to put in"
            options={kinds}
            value={item.kind}
            onChange={kind => set({ kind })}
          />
          <Switch
            size="sm"
            checked={item.enabled}
            onChange={e => set({ enabled: e.target.checked })}
            label="On"
          />
        </div>

        {item.kind === 'text' && (
          <TextArea
            aria-label="Text"
            placeholder="e.g. Answer in English, and keep it short."
            minRows={2}
            maxRows={8}
            value={item.text}
            onChange={e => set({ text: e.target.value })}
          />
        )}

        {item.kind === 'command' && (
          <>
            <TextField
              aria-label="Command"
              placeholder="e.g. npm test"
              size="sm"
              prefix="$"
              inputClassName="hw-mono"
              value={item.command}
              onChange={e => set({ command: e.target.value })}
            />
            {slot.canInject ? (
              <SegmentedControl
                size="sm"
                aria-label="When to put its output in"
                options={[
                  { value: 'always', label: 'Always add output' },
                  { value: 'onFail', label: 'Only when it fails' },
                ]}
                value={item.mode}
                onChange={mode => set({ mode })}
              />
            ) : (
              <p className="hw-editor-hint">
                Runs here for its side effects; the model doesn't see the output.
              </p>
            )}
          </>
        )}

        {item.kind === 'skill' && (
          <Select
            size="sm"
            aria-label="Skill"
            placeholder={skills.length ? 'Pick a skill' : 'No skills found'}
            options={skills.map(s => ({ value: s.name, label: s.name, description: s.description }))}
            value={item.skill || null}
            onChange={skill => set({ skill })}
          />
        )}

        {slot.hasTools && (
          <TextField
            size="sm"
            aria-label="Tools"
            placeholder="Only for these tools (e.g. Bash, Edit) — empty: all"
            value={item.tools}
            onChange={e => set({ tools: e.target.value })}
          />
        )}

        <div className="hw-item-row">
          <Switch
            size="sm"
            checked={item.once}
            onChange={e => set({ once: e.target.checked })}
            label="Once"
            description="Switches itself off after it runs"
          />
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
