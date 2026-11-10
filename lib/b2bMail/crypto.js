// B2B outreach mail: secrets at rest and tracking tokens (docs/b2b-campaigns/OUTREACH-MAIL.md).
//
//   encryptSecret / decryptSecret  AES-256-GCM with B2B_MAIL_TOKEN_KEY (32 bytes, base64 or hex). Used for the
//                                  mailboxes' refresh tokens and the short-lived connect cookie. Never logged.
//   newTrackToken / hashToken      random 128-bit tokens for links; only sha256(token) is stored.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const VERSION = 'v1'

export function mailError(status, message) {
  const e = new Error(message)
  e.status = status
  e.expose = true
  return e
}

/** The 32-byte key from B2B_MAIL_TOKEN_KEY (base64, base64url or 64 hex characters). Throws a clear error when missing. */
export function tokenKey(raw = process.env.B2B_MAIL_TOKEN_KEY) {
  if (!raw) throw mailError(503, 'B2B_MAIL_TOKEN_KEY is not set: mailboxes cannot be connected or used until it is (32 random bytes, base64)')
  const s = String(raw).trim()
  let key = null
  if (/^[0-9a-f]{64}$/i.test(s)) key = Buffer.from(s, 'hex')
  else {
    try { key = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64') } catch { key = null }
  }
  if (!key || key.length !== 32) throw mailError(503, 'B2B_MAIL_TOKEN_KEY must be 32 bytes (base64 or 64 hex characters)')
  return key
}

/** "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain, key = tokenKey()) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()])
  return [VERSION, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decryptSecret(blob, key = tokenKey()) {
  const parts = String(blob || '').split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) throw mailError(500, 'Stored secret is not in the expected format')
  const [, iv, tag, ct] = parts
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

/** A random 128-bit token, URL-safe (22 characters). */
export function newTrackToken() {
  return randomBytes(16).toString('base64url')
}

/** What is stored for a token: sha256 hex. */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

/** Only well-formed tokens are looked up (22 base64url characters). */
export function validToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{22}$/.test(token)
}

export function sameHash(a, b) {
  const x = Buffer.from(String(a || ''), 'hex')
  const y = Buffer.from(String(b || ''), 'hex')
  return x.length === 32 && y.length === 32 && timingSafeEqual(x, y)
}

/** PKCE: a verifier and its S256 challenge. */
export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function randomState() {
  return randomBytes(16).toString('base64url')
}
