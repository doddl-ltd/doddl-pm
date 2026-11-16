import test from 'node:test'
import assert from 'node:assert/strict'
import { runsOf, layoutBlock, lineOrigin, panelColour } from '../lib/pm/imagePaint.js'
import { buildReadRequest, buildCheckRequest, cleanBlock } from '../lib/pm/imageTranslate.js'

// A fake measure: every character is 0.5 em wide, bold 0.55.
const measure = (t, size, bold) => t.length * size * (bold ? 0.55 : 0.5)

test('bold words marked with ** keep their weight', () => {
  assert.deepEqual(runsOf('Learn **easily** now'), [{ t: 'Learn ', bold: false }, { t: 'easily', bold: true }, { t: ' now', bold: false }])
  assert.deepEqual(runsOf('**Mehr** Halt', true), [{ t: 'Mehr', bold: false }, { t: ' Halt', bold: true }])
})

test('a longer translation wraps to the box and shrinks until it fits', () => {
  const block = { translated: 'Lernen Sie Besteck einfach und erfolgreich zu benutzen', x: 0.05, y: 0.05, w: 0.4, h: 0.2, line_height: 0.06, weight: 'regular', align: 'left' }
  const l = layoutBlock(block, 1000, 1000, measure)
  assert.ok(l.fits)
  assert.ok(l.lines.length >= 2)
  for (const line of l.lines) assert.ok(line.width <= 400 * 1.14)
  assert.ok(l.lines.length * l.lineGap <= 200 * 1.3 + l.lineGap * 0.2)
  const o = lineOrigin(l, block, 0)
  assert.equal(Math.round(o.x), 50)
})

test('centred lines sit in the middle of the box', () => {
  const block = { translated: 'Kurz', x: 0.2, y: 0.5, w: 0.6, h: 0.1, line_height: 0.08, weight: 'bold', align: 'center' }
  const l = layoutBlock(block, 1000, 1000, measure)
  const o = lineOrigin(l, block, 0)
  assert.ok(Math.abs(o.x + l.lines[0].width / 2 - 500) < 1)
})

test('the panel colour is the common colour around the text; a busy background falls back and is not flat', () => {
  const flat = Array.from({ length: 100 }, (_, i) => (i < 80 ? [61, 21, 125] : [255, 255, 255]))
  assert.deepEqual(panelColour(flat, '#000000'), { colour: '#3d157d', flat: true })
  const busy = Array.from({ length: 100 }, (_, i) => [i * 2, 255 - i * 2, (i * 7) % 255])
  assert.deepEqual(panelColour(busy, '#9ecfc6'), { colour: '#9ecfc6', flat: false })
})

test('the reading request sends the image and asks for local wording; the check lists the expected words', () => {
  const r = buildReadRequest({ url: 'https://m.media-amazon.com/images/I/71HlQ6AA1OL.jpg', locale: 'DE' })
  assert.equal(r.messages[0].content[0].type, 'image')
  assert.match(r.system, /German for parents shopping on Amazon DE/)
  assert.match(r.system, /over_photo/)
  assert.equal(r.output_config.format.type, 'json_schema')
  const c = buildCheckRequest({ url: 'https://x.supabase.co/storage/v1/object/public/listing-images/a.png', locale: 'DE', blocks: [{ translated: 'Besteck **leicht**' }] })
  assert.match(c.messages[0].content[1].text, /1\. Besteck leicht/)
})

test('a block outside the image or with no translation is dropped; boxes are kept inside the image', () => {
  assert.equal(cleanBlock({ x: 0.5, y: 0.5, w: 0.001, h: 0.1, translated: 'x' }), null)
  assert.equal(cleanBlock({ x: 0.1, y: 0.1, w: 0.3, h: 0.1, translated: ' ' }), null)
  const b = cleanBlock({ x: 0.9, y: 0.95, w: 0.5, h: 0.2, translated: 'Hallo', color: '#ffffff', background: '#3d157d', weight: 'bold', align: 'center', line_height: 0.05 })
  assert.ok(Math.abs(b.w - 0.1) < 1e-9 && Math.abs(b.h - 0.05) < 1e-9)
})
