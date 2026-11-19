import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkCapture, captureKey } from '../lib/pm/pageCapture.js'

test('a capture needs a real ASIN, a known store and a known reason', () => {
  assert.doesNotThrow(() => checkCapture({ asin: 'B0H6XSBMSD', marketplace: 'UK', reason: 'daily' }))
  assert.throws(() => checkCapture({ asin: 'B0H6', marketplace: 'UK' }), /ASIN/)
  assert.throws(() => checkCapture({ asin: 'B0H6XSBMSD', marketplace: 'XX' }), /marketplace/)
  assert.throws(() => checkCapture({ asin: 'B0H6XSBMSD', marketplace: 'UK', reason: 'whenever' }), /reason/)
})

test('screenshot key is store / ASIN / date_reason_time', () => {
  const k = captureKey({ asin: 'B0H6XSBMSD', marketplace: 'UK', reason: 'before' }, new Date('2026-11-19T11:02:03Z'))
  assert.equal(k, 'UK/B0H6XSBMSD/2026-11-19_before_110203.jpg')
})
