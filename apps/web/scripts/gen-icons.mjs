import sharp from 'sharp'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const svgPath = join(__dirname, '../public/icon-base.svg')
const svg = readFileSync(svgPath)

async function generate(size, outName) {
  const outPath = join(__dirname, '../public', outName)
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(outPath)
  console.log(`Generated ${outPath} (${size}x${size})`)
}

await generate(192, 'icon-192.png')
await generate(512, 'icon-512.png')
console.log('Done.')
