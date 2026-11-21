// Renders the PNG icon from its SVG source in media/.
// The PNG is committed: run `just icons` after changing an SVG.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const media = join(dirname(fileURLToPath(import.meta.url)), '..', 'media')

const icons = [
  // Marketplace and extension list icon (at least 128x128, PNG only).
  // The activity bar uses media/activity.svg directly.
  { svg: 'icon.svg', png: 'icon.png', width: 256 },
]

for (const { svg, png, width } of icons) {
  const source = readFileSync(join(media, svg), 'utf8')
  const image = new Resvg(source, { fitTo: { mode: 'width', value: width } }).render()
  writeFileSync(join(media, png), image.asPng())
  console.log(`media/${png} ${image.width}x${image.height}`)
}
