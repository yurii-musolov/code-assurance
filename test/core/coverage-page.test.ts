import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'
import { coverageHtml } from '../../src/core/html'
import { DEFAULT_FILTER } from '../../src/core/tree'
import type { ViewNode, ViewState } from '../../src/core/view'

// Runs the script of the Coverage view in a DOM, the way the webview does.

interface Page {
  window: JSDOM['window']
  posted: unknown[]
  saved: { value: unknown }
  rows: () => string[]
  row: (label: string) => HTMLElement
  send: (state: Partial<ViewState>) => void
  key: (key: string) => void
}

function load(savedState?: unknown): Page {
  const posted: unknown[] = []
  const saved = { value: savedState }
  const dom = new JSDOM(coverageHtml('csp', 'n'), {
    runScripts: 'dangerously',
    beforeParse(win) {
      Object.assign(win, {
        acquireVsCodeApi: () => ({
          postMessage: (m: unknown) => posted.push(m),
          getState: () => saved.value,
          setState: (v: unknown) => {
            saved.value = v
          },
        }),
      })
      win.HTMLElement.prototype.scrollIntoView = () => {}
    },
  })
  const { window } = dom
  const tree = window.document.getElementById('tree')!
  const rows = (): string[] =>
    [...tree.querySelectorAll('.row')].map((r) => {
      const label = r.querySelector('.label')!.textContent
      const level = Number(r.getAttribute('aria-level')) - 1
      return '  '.repeat(level) + label + (r.classList.contains('focused') ? ' *' : '')
    })
  return {
    window,
    posted,
    saved,
    rows,
    row: (label) =>
      [...tree.querySelectorAll<HTMLElement>('.row')].find(
        (r) => r.querySelector('.label')!.textContent === label,
      )!,
    send: (state) =>
      window.dispatchEvent(
        new window.MessageEvent('message', {
          data: { type: 'state', state: { ...BASE, ...state } },
        }),
      ),
    key: (key) => tree.dispatchEvent(new window.KeyboardEvent('keydown', { key })),
  }
}

const file = (path: string): ViewNode => ({
  id: `0:f:${path}`,
  label: path.split('/').pop()!,
  icon: 'file',
  description: '50% (1/2)',
  action: { type: 'open', root: 0, path },
})

const NODES: ViewNode[] = [
  {
    id: '0:d:src',
    label: 'src',
    icon: 'folder',
    children: [
      { id: '0:d:src/core', label: 'core', icon: 'folder', children: [file('src/core/x.ts')] },
      file('src/a.ts'),
    ],
  },
  file('README.md'),
]

const BASE: ViewState = {
  active: true,
  filter: DEFAULT_FILTER,
  reviewers: [{ name: 'Ann', email: 'ann@x' }],
  filterError: '',
  summary: { id: 'summary', label: '50% of code lines confirmed', icon: 'shield' },
  nodes: NODES,
  autoExpand: false,
  message: '',
}

let page: Page
beforeEach(() => {
  page = load()
})

describe('coverage page', () => {
  it('asks for the state, then shows filters, summary and closed folders', () => {
    expect(page.posted).toEqual([{ type: 'ready' }])
    expect(page.window.document.getElementById('filters')!.hidden).toBe(true)
    page.send({})
    expect(page.window.document.getElementById('filters')!.hidden).toBe(false)
    expect(page.rows()).toEqual(['50% of code lines confirmed *', 'src', 'README.md'])
  })

  it('opens folders on click and files through the extension', () => {
    page.send({})
    page.row('src').click()
    expect(page.rows()).toEqual([
      '50% of code lines confirmed',
      'src *',
      '  core',
      '  a.ts',
      'README.md',
    ])
    page.row('a.ts').click()
    expect(page.posted.at(-1)).toEqual({
      type: 'action',
      action: { type: 'open', root: 0, path: 'src/a.ts' },
    })
  })

  it('keeps expanded folders across updates and reloads', () => {
    page.send({})
    page.row('src').click()
    page.send({})
    expect(page.rows()).toContain('  core')
    const reloaded = load(page.saved.value)
    reloaded.send({})
    expect(reloaded.rows()).toContain('  core')
  })

  it('moves with the keyboard like a tree', () => {
    page.send({})
    page.key('ArrowDown') // src
    page.key('ArrowRight') // open src
    page.key('ArrowRight') // to core
    page.key('ArrowRight') // open core
    page.key('ArrowDown') // x.ts
    expect(page.rows()).toContain('    x.ts *')
    page.key('Enter')
    expect(page.posted.at(-1)).toMatchObject({ action: { path: 'src/core/x.ts' } })
    page.key('ArrowLeft') // to core
    page.key('ArrowLeft') // close core
    expect(page.rows()).toEqual([
      '50% of code lines confirmed',
      'src',
      '  core *',
      '  a.ts',
      'README.md',
    ])
  })

  it('opens folders while searching and collapses all on request', () => {
    page.send({ autoExpand: true })
    expect(page.rows()).toHaveLength(6)
    page.window.dispatchEvent(
      new page.window.MessageEvent('message', { data: { type: 'collapseAll' } }),
    )
    expect(page.rows()).toEqual(['50% of code lines confirmed *', 'src', 'README.md'])
  })

  it('sends filter changes', async () => {
    page.send({})
    const doc = page.window.document
    doc.getElementById('hide')!.click()
    expect(page.posted.at(-1)).toEqual({
      type: 'filter',
      filter: { hideUnconfirmed: false, reviewer: '', pathRegex: '' },
    })
    const reviewer = doc.getElementById('reviewer') as HTMLSelectElement
    expect([...reviewer.options].map((o) => o.textContent)).toEqual([
      'All reviewers',
      'Ann <ann@x>',
    ])
    reviewer.value = 'ann@x'
    reviewer.dispatchEvent(new page.window.Event('change'))
    expect(page.posted.at(-1)).toMatchObject({ filter: { reviewer: 'ann@x' } })
    const input = doc.getElementById('path') as HTMLInputElement
    input.value = '^src/'
    input.dispatchEvent(new page.window.Event('input'))
    await new Promise((r) => setTimeout(r, 300))
    expect(page.posted.at(-1)).toMatchObject({ filter: { pathRegex: '^src/' } })
  })

  it('shows a filter error and the empty message', () => {
    page.send({
      filterError: 'Invalid regular expression: x',
      nodes: [],
      message: 'No files match the filter.',
    })
    const doc = page.window.document
    expect(doc.getElementById('error')!.textContent).toBe('Invalid regular expression: x')
    expect(doc.getElementById('path-box')!.classList.contains('invalid')).toBe(true)
    expect(doc.getElementById('message')!.textContent).toBe('No files match the filter.')
  })

  it('renders names from the repository as text', () => {
    page.send({ nodes: [file('<img src=x onerror=alert(1)>.ts')] })
    expect(page.window.document.querySelector('#tree img')).toBeNull()
    expect(page.rows()).toContain('<img src=x onerror=alert(1)>.ts')
  })
})
