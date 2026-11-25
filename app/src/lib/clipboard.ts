/** Text to the clipboard, with the old way when the browser has no clipboard; `done` after. */
export function copyText(text: string, done: () => void) {
  const fallback = () => {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
    done()
  }
  if (navigator.clipboard) void navigator.clipboard.writeText(text).then(done, fallback)
  else fallback()
}
