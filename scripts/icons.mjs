// Renders the PNG icons from their SVG sources in media/.
// The PNGs are committed: run `just icons` after changing an SVG.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const media = join(dirname(fileURLToPath(import.meta.url)), '..', 'media')

const icons = [
  // Marketplace and extension list icon (at least 128x128, PNG only).
  { svg: 'icon.svg', png: 'icon.png', width: 256 },
  // Activity bar: VS Code draws it as a 24px mask in the theme's
  // foreground color; 96px keeps it sharp on high-density screens.
  { svg: 'activity.svg', png: 'activity.png', width: 96, color: '#000000' },
]

for (const { svg, png, width, color } of icons) {
  let source = readFileSync(join(media, svg), 'utf8')
  if (color) source = source.replaceAll('currentColor', color)
  const image = new Resvg(source, { fitTo: { mode: 'width', value: width } }).render()
  writeFileSync(join(media, png), image.asPng())
  console.log(`media/${png} ${image.width}x${image.height}`)
}
