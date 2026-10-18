// Every slider's number can be clicked and typed into, like volume and speed. One listener covers every panel:
// the typed number goes into the slider in the same row as if it had been dragged there, then it is saved.
// A number shown in other units than its slider says how on the span: data-scale (slider = typed x scale) and
// data-offset (added after), for example a 0 to 1 slider shown as a percentage has data-scale="0.01".

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

export function installTypedValues() {
  document.addEventListener('click', (e) => {
    const span = (e.target as HTMLElement | null)?.closest?.('.slider-row .value') as HTMLElement | null
    if (!span) return
    const range = span.closest('.slider-row')?.querySelector('input[type=range]') as HTMLInputElement | null
    if (!range || range.disabled) return
    e.preventDefault() // the row is a label: a click on it would otherwise focus the slider
    const scale = Number(span.dataset.scale ?? 1)
    const offset = Number(span.dataset.offset ?? 0)
    const shown = parseFloat((span.textContent ?? '').replace(/[^\d.+-]/g, ''))
    const start = Number.isFinite(shown) ? shown : (Number(range.value) - offset) / scale

    // The box floats over the number, so React keeps owning the span underneath.
    const r = span.getBoundingClientRect()
    const box = document.createElement('input')
    box.type = 'number'
    box.step = 'any'
    box.className = 'value-typing'
    box.value = String(Math.round(start * 100) / 100)
    Object.assign(box.style, { left: `${r.left - 6}px`, top: `${r.top - 3}px`, width: `${Math.max(56, r.width + 16)}px` })
    document.body.appendChild(box)
    box.focus()
    box.select()

    let done = false
    const finish = (apply: boolean) => {
      if (done) return
      done = true
      const typed = Number(box.value)
      box.remove()
      if (!apply || box.value.trim() === '' || !Number.isFinite(typed)) return
      setValue.call(range, String(typed * scale + offset)) // the slider keeps it inside its own min, max and step
      range.dispatchEvent(new Event('input', { bubbles: true }))
      range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) // saves it as one undo step
    }
    box.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') finish(true)
      else if (k.key === 'Escape') finish(false)
      k.stopPropagation() // arrows and letters type into the box, not into the timeline
    })
    box.addEventListener('blur', () => finish(true))
  })
}
