export const MSAL_CONFIG = {
  clientId: 'bddcde1a-b104-4c96-8f67-9b40a1dfea3c',
  tenantId: '927d1e2c-7c8d-406f-8640-678dfce86b7d',
}

let _msal = null

export async function getMsal() {
  if (_msal) return _msal
  const { PublicClientApplication } = await import('@azure/msal-browser')
  _msal = new PublicClientApplication({
    auth: {
      clientId: MSAL_CONFIG.clientId,
      authority: `https://login.microsoftonline.com/${MSAL_CONFIG.tenantId}`,
      redirectUri: typeof window !== 'undefined' ? window.location.origin : '',
    },
    cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
  })
  await _msal.initialize()
  return _msal
}

// ID token for the signed-in user, sent as the bearer token on calls to our
// own API routes (/api/db, /api/triage, /api/oauth/approve). The server checks
// it in lib/server/msalVerify.js. Refreshed when it has under 5 minutes left.
// Returns null when nobody is signed in.
const ID_TOKEN_REQUEST = { scopes: ['openid', 'profile', 'email'] }

export async function getIdToken() {
  const msal = await getMsal()
  const account = msal.getActiveAccount() || msal.getAllAccounts()[0]
  if (!account) return null
  const request = { ...ID_TOKEN_REQUEST, account }
  try {
    let result = await msal.acquireTokenSilent(request)
    const exp = result.idTokenClaims && result.idTokenClaims.exp
    if (!exp || exp * 1000 - Date.now() < 5 * 60_000) {
      result = await msal.acquireTokenSilent({ ...request, forceRefresh: true })
    }
    return result.idToken
  } catch (e) {
    if (e && e.name === 'InteractionRequiredAuthError') {
      await msal.acquireTokenRedirect(request)
      return null
    }
    throw e
  }
}
