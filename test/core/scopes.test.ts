import { describe, expect, it } from 'vitest'
import {
  classify,
  enclosingSymbol,
  isFunctionValued,
  Kind,
  nestSymbols,
  rustItem,
  supportsSymbols,
  symbolsAtPath,
  type SymbolNode,
} from '../../src/core/scopes'

describe('supportsSymbols', () => {
  it('covers JS, TS, Python, Go and Rust only', () => {
    for (const id of ['javascript', 'typescriptreact', 'python', 'go', 'rust']) {
      expect(supportsSymbols(id)).toBe(true)
    }
    expect(supportsSymbols('java')).toBe(false)
    expect(supportsSymbols('plaintext')).toBe(false)
  })
})

describe('classify', () => {
  it('maps common kinds', () => {
    expect(classify(Kind.Function, 'go', 'func F() {')).toBe('function')
    expect(classify(Kind.Method, 'python', 'def m(self):')).toBe('function')
    expect(classify(Kind.Struct, 'go', 'type S struct {')).toBe('type')
    expect(classify(Kind.Class, 'python', 'class A:')).toBe('type')
    expect(classify(Kind.Namespace, 'typescript', 'namespace N {')).toBe('module')
    expect(classify(Kind.Variable, 'go', 'var x = 1')).toBeNull()
  })

  it('recognizes function-valued variables in JS/TS', () => {
    expect(classify(Kind.Constant, 'typescript', 'const f = (a: number) => a')).toBe('function')
    expect(classify(Kind.Constant, 'javascript', 'const f = async x => x')).toBe('function')
    expect(classify(Kind.Constant, 'javascript', 'const o = { m: () => 1 }')).toBeNull()
  })

  it('recognizes Python lambdas', () => {
    expect(classify(Kind.Variable, 'python', 'f = lambda x: x')).toBe('function')
  })

  it('reads Rust items from the declaration', () => {
    expect(classify(Kind.Object, 'rust', 'impl Foo for Bar {')).toBe('impl')
    expect(classify(Kind.Module, 'rust', 'pub(crate) mod inner {')).toBe('module')
    expect(classify(Kind.Interface, 'rust', 'pub trait T {')).toBe('type')
    expect(classify(Kind.Function, 'rust', 'macro_rules! m {')).toBe('function')
  })
})

describe('rustItem', () => {
  it('skips comments, attributes, visibility and qualifiers', () => {
    expect(rustItem('/// doc\n#[derive(Debug)]\npub struct S;')).toBe('type')
    expect(rustItem('pub(super) unsafe impl Send for X {}')).toBe('impl')
    expect(rustItem('pub async fn f() {}')).toBe('function')
    expect(rustItem('pub union U {}')).toBe('type')
    expect(rustItem('let x = 1;')).toBeNull()
  })
})

describe('isFunctionValued', () => {
  it('ignores comparisons', () => {
    expect(isFunctionValued('a == b => c')).toBe(false)
    expect(isFunctionValued('x = function () {}')).toBe(true)
  })
})

const tree: SymbolNode[] = [
  {
    name: 'A',
    scope: 'type',
    range: [1, 20],
    children: [
      { name: 'm', scope: 'function', range: [2, 5], children: [] },
      { name: 'm', scope: 'function', range: [6, 9], children: [] },
      { name: 'field', scope: null, range: [10, 10], children: [] },
    ],
  },
  { name: 'f', scope: 'function', range: [22, 30], children: [] },
]

describe('symbol lookup', () => {
  it('finds the innermost enclosing symbol', () => {
    expect(enclosingSymbol(tree, [3, 4])?.path).toBe('A/m')
    expect(enclosingSymbol(tree, [10, 10])?.path).toBe('A')
    expect(enclosingSymbol(tree, [3, 7])?.path).toBe('A')
    expect(enclosingSymbol(tree, [21, 21])).toBeNull()
    expect(enclosingSymbol(tree, [3, 3], (n) => n.scope === 'type')?.path).toBe('A')
  })

  it('returns every symbol at a path', () => {
    expect(symbolsAtPath(tree, 'A/m')).toHaveLength(2)
    expect(symbolsAtPath(tree, 'f')).toHaveLength(1)
    expect(symbolsAtPath(tree, 'A/x')).toEqual([])
  })
})

describe('nestSymbols', () => {
  const flat = (name: string, range: [number, number]) => ({
    name,
    scope: 'function' as const,
    range,
  })
  const shape = (nodes: SymbolNode[]): unknown[] =>
    nodes.map((n) => (n.children.length ? [n.name, shape(n.children)] : n.name))

  it('nests by range containment regardless of list order', () => {
    const tree = nestSymbols([
      flat('get', [9, 11]),
      flat('Box', [7, 12]),
      flat('add', [3, 5]),
      flat('field', [8, 8]),
      flat('main', [14, 14]),
    ])
    expect(shape(tree)).toEqual(['add', ['Box', ['field', 'get']], 'main'])
  })

  it('keeps siblings that only touch apart', () => {
    expect(shape(nestSymbols([flat('a', [1, 3]), flat('b', [3, 5])]))).toEqual(['a', 'b'])
  })

  it('finds the enclosing symbol in a nested flat list', () => {
    const tree = nestSymbols([flat('Box', [7, 12]), flat('get', [9, 11])])
    expect(enclosingSymbol(tree, [10, 10])?.path).toBe('Box/get')
  })
})
