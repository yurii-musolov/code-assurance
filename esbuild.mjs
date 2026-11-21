import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const production = process.argv.includes('--production')

const ctx = await esbuild.context({
  entryPoints: ['src/vscode/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
