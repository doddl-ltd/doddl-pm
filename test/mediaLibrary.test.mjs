import test from 'node:test'
import assert from 'node:assert/strict'
import { parseIndex } from '../lib/pm/mediaLibrary.js'

const CSV = '﻿image_id,master_sku,type,file_path,original_file_name,usage_rights,rights_expiry,markets,channels_allowed,child_in_shot,model_release_on_file,agent_use,notes\r\n'
  + '"media-1","DOD004","02 Product images","14 Media/02 Product images/Toddler 2-piece cutlery (12-24 months)/DOD004 green, front.jpg","x.jpg","owned","none","ALL","amazon;website","No","Yes","Yes","group: packshots; a ""quoted"" note"\r\n'
  + '"media-2","","04 Video","14 Media/04 Video/clip.mp4","clip.mp4","owned","none","ALL","all","TO CONFIRM","Yes","Yes",""\r\n'
  + '"media-3","","03 Lifestyle images","Somewhere else/escape.jpg","e.jpg","owned","none","ALL","all","No","Yes","Yes",""\r\n'

test('reads imagery-index.csv: quoted cells, commas and quotes inside, BOM, CRLF', () => {
  const rows = parseIndex(CSV)
  assert.equal(rows.length, 2, 'a row outside 14 Media is ignored')
  const [a, b] = rows
  assert.equal(a.image_id, 'media-1')
  assert.equal(a.master_sku, 'DOD004')
  assert.equal(a.name, 'DOD004 green, front.jpg')
  assert.equal(a.kind, 'image')
  assert.equal(a.channels_allowed, 'amazon;website')
  assert.equal(a.notes, 'group: packshots; a "quoted" note')
  assert.equal(b.kind, 'video')
  assert.equal(b.master_sku, null)
})
