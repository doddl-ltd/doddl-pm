import Head from 'next/head'

export default function LoginScreen({ onLogin, loading }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #3D157D 0%, #1a0a3a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', padding: '24px 16px' }}>
      <Head>
        <title>doddl PM</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet" />
      </Head>
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <span style={{ fontWeight: 800, fontSize: 40, letterSpacing: '-1px' }}>doddl</span>
            <span style={{ color: '#30BEAA', fontWeight: 800, fontSize: 40 }}>.</span>
          </div>
          <p style={{ fontWeight: 600, fontSize: 15, opacity: 0.65, marginTop: 4 }}>Project Management</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: '40px clamp(20px, 6vw, 48px)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)', minWidth: 'min(340px, 100%)' }}>
          <p style={{ fontSize: 14, opacity: 0.65, marginBottom: 28, fontWeight: 600 }}>Sign in with your doddl account</p>
          <button onClick={onLogin} disabled={loading} style={{ background: '#fff', color: '#3D157D', border: 'none', borderRadius: 8, padding: '13px 32px', fontWeight: 800, fontSize: 15, cursor: loading ? 'wait' : 'pointer', fontFamily: 'Nunito, sans-serif', display: 'flex', alignItems: 'center', gap: 10, margin: '0 auto', opacity: loading ? 0.7 : 1 }}>
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
            {loading ? 'Signing in...' : 'Sign in with Microsoft'}
          </button>
        </div>
        <p style={{ fontSize: 11, opacity: 0.35, marginTop: 24 }}>Restricted to @doddl.com accounts</p>
      </div>
    </div>
  )
}
