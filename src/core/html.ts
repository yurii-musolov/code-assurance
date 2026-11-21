import { escapeHtml, isValidSha, relTime } from './render'

// Webview markup. Record text is escaped; commands go back as messages that
// carry only a record id, which the extension looks up in its own store.

const csp = (cspSource: string, nonce: string): string =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `style-src 'unsafe-inline' ${cspSource}; script-src 'nonce-${nonce}'">`

export interface HistoryEntry {
  recordId: string
  status: 'confirmed' | 'outdated' | 'ambiguous' | 'replaced'
  createdAt: string
  scope: string
  commit: string
  commitLink: string | null
  comment?: string | undefined
}

export interface HistoryInput {
  sourcePath: string
  nowIso: string
  people: { name: string; chains: { entries: HistoryEntry[]; revoked: boolean }[] }[]
}

const GLYPH = { confirmed: '✓', outdated: '⚠', ambiguous: '?', replaced: '·' } as const

function entryHtml(e: HistoryEntry, nowIso: string): string {
  const sha = isValidSha(e.commit) ? escapeHtml(e.commit.slice(0, 7)) : ''
  const shaHtml = !sha
    ? ''
    : e.commitLink?.startsWith('https://')
      ? ` <a href="${escapeHtml(e.commitLink)}"><code>${sha}</code></a>`
      : ` <code>${sha}</code>`
  const id = escapeHtml(e.recordId)
  const button = (c: string, label: string): string =>
    ` <button data-cmd="${c}" data-id="${id}">${label}</button>`
  const buttons =
    (e.status === 'outdated' || e.status === 'ambiguous'
      ? button('reconfirm', 'Confirm again')
      : '') +
    (e.status === 'ambiguous' ? button('resolve', 'Resolve') : '') +
    (e.status !== 'replaced' ? button('reveal', 'Go to') : '') +
    button('showDiff', 'Diff')
  const comment = e.comment ? `<blockquote>${escapeHtml(e.comment)}</blockquote>` : ''
  return (
    `<li class="${e.status}"><span class="glyph">${GLYPH[e.status]}</span> ` +
    `<strong>${e.status}</strong> · ${escapeHtml(e.scope)} · ${relTime(e.createdAt, nowIso)}` +
    `${shaHtml}${buttons}${comment}</li>`
  )
}

export function historyHtml(input: HistoryInput, cspSource: string, nonce: string): string {
  const sections = input.people
    .map((p) => {
      const chains = p.chains
        .map((c) => {
          const list = `<ul>${c.entries.map((e) => entryHtml(e, input.nowIso)).join('')}</ul>`
          return c.revoked ? `<details><summary>withdrawn</summary>${list}</details>` : list
        })
        .join('')
      return `<section><h4>${escapeHtml(p.name)}</h4>${chains}</section>`
    })
    .join('')
  return `<!DOCTYPE html><html><head>${csp(cspSource, nonce)}
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
  ul { list-style: none; padding-left: 0; } li { margin: .35em 0; }
  li.confirmed .glyph { color: var(--vscode-charts-green); }
  li.outdated .glyph { color: var(--vscode-charts-orange); }
  li.ambiguous .glyph { color: var(--vscode-charts-yellow); }
  li.replaced { opacity: .7; }
  blockquote { opacity: .85; margin: .2em 0 .4em 1.5em; }
  button { margin-left: .4em; color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground); border: none; padding: 1px 8px; }
</style></head><body>
<h3>${escapeHtml(input.sourcePath)}</h3>${sections || '<p>No confirmations.</p>'}
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  document.querySelectorAll('button[data-cmd]').forEach((b) =>
    b.addEventListener('click', () => vscode.postMessage({ cmd: b.dataset.cmd, recordId: b.dataset.id })))
</script></body></html>`
}

/** Static markup of the Filters view; values arrive by message and go in via textContent/value. */
export function filtersHtml(cspSource: string, nonce: string): string {
  return `<!DOCTYPE html><html><head>${csp(cspSource, nonce)}
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 4px 8px; }
  label { display: block; margin: 6px 0 2px; }
  label.row { display: flex; align-items: center; gap: 6px; }
  select, input[type=text] { width: 100%; box-sizing: border-box; padding: 3px 4px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); }
  input.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
  #error { color: var(--vscode-errorForeground); min-height: 1.2em; word-break: break-word; }
  button { margin-top: 6px; padding: 2px 10px; border: none;
    color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
</style></head><body>
<label class="row"><input type="checkbox" id="hide"> Hide files without confirmations</label>
<label for="reviewer">Reviewer</label>
<select id="reviewer"></select>
<label for="path">Path regex</label>
<input type="text" id="path" placeholder="e.g. ^src/  or  \\.go$" spellcheck="false">
<div id="error"></div>
<button id="reset">Reset</button>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  const hide = document.getElementById('hide')
  const reviewer = document.getElementById('reviewer')
  const path = document.getElementById('path')
  const error = document.getElementById('error')
  const send = () => vscode.postMessage({ type: 'set',
    filter: { hideUnconfirmed: hide.checked, reviewer: reviewer.value, pathRegex: path.value } })
  let timer
  hide.addEventListener('change', send)
  reviewer.addEventListener('change', send)
  path.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(send, 250) })
  document.getElementById('reset').addEventListener('click', () => vscode.postMessage({ type: 'reset' }))
  const option = (value, text) => {
    const o = document.createElement('option')
    o.value = value
    o.textContent = text
    reviewer.appendChild(o)
  }
  window.addEventListener('message', (e) => {
    const m = e.data
    if (!m || m.type !== 'state') return
    hide.checked = !!m.filter.hideUnconfirmed
    reviewer.replaceChildren()
    option('', 'Everyone')
    for (const r of m.reviewers) option(r.email, r.name + ' <' + r.email + '>')
    const want = m.filter.reviewer || ''
    if (want && !m.reviewers.some((r) => r.email === want)) option(want, want + ' (no current confirmations)')
    reviewer.value = want
    if (document.activeElement !== path) path.value = m.filter.pathRegex
    error.textContent = m.error || ''
    path.classList.toggle('invalid', !!m.error)
  })
  vscode.postMessage({ type: 'ready' })
</script></body></html>`
}
