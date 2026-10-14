// OAuth consent page for Claude connectors (lib/server/oauth.js).
// Validates the request server-side first, so a bad client or redirect URI
// shows an error here and is never redirected anywhere.

import { useEffect, useState } from 'react'
import Head from 'next/head'
import { getMsal, getIdToken } from '../../lib/msal'
import { getDisplayName } from '../../lib/team'

export async function getServerSideProps({ query }) {
  const { adminClient } = await import('../../lib/server/admin')
  const { getClient, validateAuthorizeParams, OAuthError } = await import('../../lib/server/oauth')
  const params = {
    response_type: query.response_type || '',
    client_id: query.client_id || '',
    redirect_uri: query.redirect_uri || '',
    code_challenge: query.code_challenge || '',
    code_challenge_method: query.code_challenge_method || '',
    state: query.state || '',
    scope: query.scope || '',
    resource: query.resource || '',
  }
  try {
    const client = await getClient(adminClient('oauth-authorize'), params.client_id)
    validateAuthorizeParams(params, client)
    return { props: { params, clientName: client.client_name, redirectHost: new URL(params.redirect_uri).host, error: null } }
  } catch (e) {
    if (e instanceof OAuthError) return { props: { params: null, clientName: null, redirectHost: null, error: e.message } }
    throw e
  }
}

const page = { minHeight: '100vh', background: 'linear-gradient(135deg, #3D157D 0%, #1a0a3a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', padding: 16 }
const card = { background: '#fff', borderRadius: 14, padding: '28px 28px 24px', maxWidth: 440, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.35)', color: '#172b4d' }
const btn  = (primary) => ({ flex: 1, padding: '11px 14px', borderRadius: 8, border: primary ? 'none' : '1px solid #dfe1e6', background: primary ? '#3D157D' : '#fff', color: primary ? '#fff' : '#42526e', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' })

export default function Authorize({ params, clientName, redirectHost, error }) {
  const [account, setAccount] = useState(null)
  const [state, setState] = useState(error ? 'error' : 'loading')
  const [message, setMessage] = useState(error)

  useEffect(() => {
    if (error) return
    (async () => {
      const msal = await getMsal()
      await msal.handleRedirectPromise()
      const acct = msal.getAllAccounts()[0]
      if (!acct) {
        // Sign in, then MSAL returns the browser to this exact URL.
        await msal.loginRedirect({ scopes: ['User.Read'], redirectStartPage: window.location.href })
        return
      }
      setAccount(acct)
      setState('ready')
    })().catch((e) => { setMessage(e.message || 'Sign-in failed'); setState('error') })
  }, [error])

  const deny = () => {
    const target = new URL(params.redirect_uri)
    target.searchParams.set('error', 'access_denied')
    if (params.state) target.searchParams.set('state', params.state)
    window.location.assign(target.toString())
  }

  const allow = async () => {
    setState('working')
    try {
      const token = await getIdToken()
      const resp = await fetch('/api/oauth/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error_description || body.error || 'Approval failed')
      window.location.assign(body.redirect)
    } catch (e) {
      setMessage(e.message); setState('error')
    }
  }

  const who = account ? (getDisplayName(account.username) || account.name) : ''

  return (
    <div style={page}>
      <Head>
        <title>Connect Claude to doddl PM</title>
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: '#3D157D', textTransform: 'uppercase' }}>doddl PM</div>
        {state === 'error' && (
          <>
            <h1 style={{ fontSize: 20, margin: '10px 0 8px' }}>Can't connect</h1>
            <p style={{ fontSize: 14, color: '#42526e', lineHeight: 1.5 }}>{message}</p>
          </>
        )}
        {(state === 'loading' || state === 'working') && (
          <p style={{ fontSize: 14, color: '#42526e', margin: '16px 0 4px' }}>{state === 'loading' ? 'Checking your sign-in…' : 'Connecting…'}</p>
        )}
        {state === 'ready' && (
          <>
            <h1 style={{ fontSize: 20, margin: '10px 0 8px' }}>Allow {clientName} to use doddl PM as {who}?</h1>
            <p style={{ fontSize: 14, color: '#42526e', lineHeight: 1.5, margin: '0 0 10px' }}>
              It will be able to read projects and tasks, create and update tasks, add notes and evidence links, and capture and triage inbox items. Every change is recorded under your name. It cannot approve or reject anything.
            </p>
            <p style={{ fontSize: 13, color: '#6b778c', margin: '0 0 18px' }}>
              You'll be returned to <strong style={{ color: '#172b4d' }}>{redirectHost}</strong>. Only continue if you started this from Claude.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={btn(false)} onClick={deny}>Deny</button>
              <button style={btn(true)} onClick={allow}>Allow</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
