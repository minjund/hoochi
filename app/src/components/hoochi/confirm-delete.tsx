import { UI, type Lang } from '../../lib/i18n'

/** One more ask before something is deleted, in place: what goes, then Cancel or Delete. */
export function ConfirmDelete({ lang, message, onYes, onNo }: { lang: Lang; message: string; onYes(): void; onNo(): void }) {
  const t = UI[lang]
  return (
    <div className="hw-ask-delete" role="alertdialog" aria-label={message}>
      <span>{message}</span>
      <div>
        <button type="button" className="hw-ask-delete-no" onClick={onNo} autoFocus>
          {t.cancel}
        </button>
        <button type="button" className="hw-ask-delete-yes" onClick={onYes}>
          {t.deleteYes}
        </button>
      </div>
    </div>
  )
}
