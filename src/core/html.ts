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

// 16px line icons drawn with the theme's foreground color.
const ICONS: Record<string, string> = {
  chevron: '<path d="m6 4 4 4-4 4"/>',
  repo: '<path d="M4 2.5h8.5v11H4.5a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4.5 2.5z"/><path d="M3 11.5A1.5 1.5 0 0 1 4.5 10h8"/>',
  folder: '<path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z"/>',
  file: '<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>',
  person: '<circle cx="8" cy="5" r="2.5"/><path d="M3 14c0-3 2.2-5 5-5s5 2 5 5"/>',
  warning: '<path d="M8 1.8 15 14H1z"/><path d="M8 6v4M8 11.8v.4"/>',
  shield:
    '<path d="M8 1.5 2.5 3.5v4c0 3.3 2.3 5.8 5.5 7 3.2-1.2 5.5-3.7 5.5-7v-4z"/><path d="m5.5 8 2 2 3-3.5"/>',
  add: '<path d="M8 3v10M3 8h10"/>',
  filter: '<path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6z"/>',
}

const iconSvg = (name: string): string =>
  `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] ?? ''}</svg>`

/**
 * The Coverage view: filters on top and the filtered tree below, in one
 * panel like the Search view. The markup is static; the state arrives by
 * message and every value from it goes into the page as text.
 */
export function coverageHtml(cspSource: string, nonce: string): string {
  const icons = JSON.stringify(Object.fromEntries(Object.keys(ICONS).map((k) => [k, iconSvg(k)])))
  return `<!DOCTYPE html><html><head>${csp(cspSource, nonce)}
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-sideBar-background, transparent); }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.2;
    stroke-linecap: round; stroke-linejoin: round; flex: none; }
  header { position: sticky; top: 0; z-index: 1; padding: 4px 12px 6px 8px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
  header[hidden] { display: none; }
  .input-box { position: relative; display: flex; align-items: center;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }
  .input-box:focus-within { border-color: var(--vscode-focusBorder); }
  .input-box.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
  .input-box input { flex: 1; min-width: 0; padding: 3px 4px; border: none; outline: none;
    background: transparent; color: inherit; font: inherit; }
  .input-box input::placeholder { color: var(--vscode-input-placeholderForeground); }
  .toggle { display: flex; margin: 1px 2px; padding: 2px; border: 1px solid transparent; border-radius: 3px;
    background: transparent; color: inherit; cursor: pointer; }
  .toggle:hover { background: var(--vscode-inputOption-hoverBackground); }
  .toggle[aria-pressed="true"] { color: var(--vscode-inputOption-activeForeground);
    background: var(--vscode-inputOption-activeBackground); border-color: var(--vscode-inputOption-activeBorder); }
  .toggle:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
  #error { color: var(--vscode-errorForeground); font-size: .9em; word-break: break-word; }
  #error:empty { display: none; }
  select { width: 100%; margin-top: 4px; padding: 2px 4px; box-sizing: border-box; font: inherit;
    color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 2px; }
  #tree { outline: none; padding-bottom: 8px; }
  .row { display: flex; align-items: center; gap: 4px; height: 22px; padding-right: 12px;
    white-space: nowrap; cursor: pointer; user-select: none; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.focused { background: var(--vscode-list-inactiveSelectionBackground); }
  #tree:focus .row.focused { background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground); outline: 1px solid var(--vscode-list-focusOutline, transparent);
    outline-offset: -1px; }
  .twistie { width: 16px; display: flex; justify-content: center; flex: none; }
  .twistie svg { transition: transform .1s; }
  .icon { display: flex; flex: none; opacity: .85; }
  .row[aria-expanded="true"] .twistie svg { transform: rotate(90deg); }
  .label { overflow: hidden; text-overflow: ellipsis; }
  .desc { opacity: .7; font-size: .92em; overflow: hidden; text-overflow: ellipsis; margin-left: .3em; }
  .row.full .desc { color: var(--vscode-charts-green); opacity: 1; }
  .row.summary { cursor: default; font-weight: 600; }
  #message { padding: 4px 20px; opacity: .8; }
  #message:empty { display: none; }
</style></head><body>
<header id="filters" hidden>
  <div class="input-box" id="path-box">
    <input type="text" id="path" placeholder="Filter by path (regular expression)" spellcheck="false" aria-label="Filter by path">
    <button class="toggle" id="hide" title="Only files with confirmations" aria-pressed="false">${iconSvg('filter')}</button>
  </div>
  <div id="error"></div>
  <select id="reviewer" aria-label="Files of"></select>
</header>
<div id="tree" role="tree" tabindex="0" aria-label="Coverage"></div>
<div id="message"></div>
<script nonce="${nonce}">
  const ICONS = ${icons}
  const vscode = acquireVsCodeApi()
  const saved = vscode.getState() || {}
  // User choices override the default (closed, or open while searching).
  const open = new Map(saved.open || [])
  let focusedId = saved.focused || null
  let state = null
  let rows = []
  const $ = (id) => document.getElementById(id)
  const filters = $('filters'), path = $('path'), pathBox = $('path-box'), hide = $('hide')
  const reviewer = $('reviewer'), error = $('error'), tree = $('tree'), message = $('message')
  const persist = () => vscode.setState({ open: [...open], focused: focusedId })
  const icon = (name) => {
    const span = document.createElement('span')
    span.className = 'twistie'
    span.innerHTML = name ? ICONS[name] : ''
    return span
  }
  // Value of the "a tree per reviewer" entry; emails never start with ':'.
  const GROUP = ':group'
  const isOpen = (n) =>
    open.has(n.id) ? open.get(n.id) : n.open !== undefined ? n.open : !!(state && state.autoExpand)
  const send = () => vscode.postMessage({ type: 'filter', filter: {
    hideUnconfirmed: hide.getAttribute('aria-pressed') === 'true',
    reviewer: reviewer.value === GROUP ? '' : reviewer.value,
    groupByReviewer: reviewer.value === GROUP,
    pathRegex: path.value } })

  function row(n, depth, parent) {
    const el = document.createElement('div')
    el.className = 'row' + (n.coverage ? ' ' + n.coverage : '') + (n.id === 'summary' ? ' summary' : '')
    el.setAttribute('role', 'treeitem')
    el.setAttribute('aria-level', String(depth + 1))
    el.style.paddingLeft = (4 + depth * 8) + 'px'
    const hasChildren = !!(n.children && n.children.length)
    if (hasChildren) el.setAttribute('aria-expanded', String(isOpen(n)))
    el.appendChild(icon(hasChildren ? 'chevron' : ''))
    el.appendChild(icon(n.icon)).className = 'icon'
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = n.label
    el.appendChild(label)
    if (n.description) {
      const desc = document.createElement('span')
      desc.className = 'desc'
      desc.textContent = n.description
      el.appendChild(desc)
    }
    if (n.tooltip) el.title = n.tooltip
    el.addEventListener('click', () => { focus(rows.findIndex((r) => r.node === n)); activate(n) })
    rows.push({ node: n, el, depth, parent })
    tree.appendChild(el)
    if (hasChildren && isOpen(n)) for (const c of n.children) row(c, depth + 1, n)
  }

  function render() {
    tree.replaceChildren()
    rows = []
    if (!state) return
    if (state.summary) row(state.summary, 0, null)
    for (const n of state.nodes) row(n, 0, null)
    message.textContent = state.message
    let i = rows.findIndex((r) => r.node.id === focusedId)
    if (i < 0 && rows.length) i = 0
    markFocus(i)
  }

  function markFocus(i) {
    rows.forEach((r, j) => r.el.classList.toggle('focused', j === i))
    focusedId = i >= 0 && rows[i] ? rows[i].node.id : null
  }
  function focus(i) {
    if (i < 0 || i >= rows.length) return
    markFocus(i)
    rows[i].el.scrollIntoView({ block: 'nearest' })
    persist()
  }
  function toggle(n, value) {
    open.set(n.id, value === undefined ? !isOpen(n) : value)
    persist()
    render()
  }
  function activate(n) {
    if (n.children && n.children.length) toggle(n)
    else if (n.action) vscode.postMessage({ type: 'action', action: n.action })
  }

  tree.addEventListener('keydown', (e) => {
    const i = rows.findIndex((r) => r.node.id === focusedId)
    const cur = rows[i]
    if (e.key === 'ArrowDown') focus(i + 1)
    else if (e.key === 'ArrowUp') focus(Math.max(0, i - 1))
    else if (e.key === 'Home') focus(0)
    else if (e.key === 'End') focus(rows.length - 1)
    else if (!cur) return
    else if (e.key === 'ArrowRight') {
      if (cur.node.children && cur.node.children.length) {
        if (!isOpen(cur.node)) toggle(cur.node, true)
        else focus(i + 1)
      }
    } else if (e.key === 'ArrowLeft') {
      if (cur.node.children && cur.node.children.length && isOpen(cur.node)) toggle(cur.node, false)
      else if (cur.parent) focus(rows.findIndex((r) => r.node === cur.parent))
    } else if (e.key === 'Enter' || e.key === ' ') activate(cur.node)
    else return
    e.preventDefault()
  })

  let timer
  path.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(send, 250) })
  path.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); tree.focus() }
  })
  hide.addEventListener('click', () => {
    hide.setAttribute('aria-pressed', String(hide.getAttribute('aria-pressed') !== 'true'))
    send()
  })
  reviewer.addEventListener('change', send)
  const option = (value, text, disabled) => {
    const o = document.createElement('option')
    o.value = value
    o.textContent = text
    o.disabled = !!disabled
    reviewer.appendChild(o)
  }

  window.addEventListener('message', (e) => {
    const m = e.data
    if (!m) return
    if (m.type === 'collapseAll') {
      open.clear()
      const close = (nodes) => { for (const n of nodes) if (n.children) { open.set(n.id, false); close(n.children) } }
      if (state) close(state.nodes)
      persist()
      render()
      return
    }
    if (m.type === 'focusFilter') { path.focus(); path.select(); return }
    if (m.type !== 'state') return
    state = m.state
    filters.hidden = !state.active
    hide.setAttribute('aria-pressed', String(!!state.filter.hideUnconfirmed))
    reviewer.replaceChildren()
    option('', 'All reviewers in one tree')
    option(GROUP, 'A tree per reviewer')
    if (state.reviewers.length) option(':sep', '──────────', true)
    for (const r of state.reviewers) option(r.email, r.name + ' <' + r.email + '>')
    const want = state.filter.reviewer || ''
    if (want && !state.reviewers.some((r) => r.email === want)) option(want, want + ' (no current confirmations)')
    reviewer.value = want || (state.filter.groupByReviewer ? GROUP : '')
    if (document.activeElement !== path) path.value = state.filter.pathRegex
    error.textContent = state.filterError
    pathBox.classList.toggle('invalid', !!state.filterError)
    render()
  })
  vscode.postMessage({ type: 'ready' })
</script></body></html>`
}
