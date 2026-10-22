import { TEAM } from '../lib/team'

// Private project switch + who else can see it (migration 23). The owner always can, so they are not
// offered as a member. `onDark` = shown on a coloured project header.
const PEOPLE = TEAM.filter(m => m.name !== 'Claude').map(m => m.name)
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

export default function AccessPicker({ isPrivate, members = [], owner, onChange, onDark = false }) {
  const text = onDark ? '#fff' : '#172b4d'
  const muted = onDark ? 'rgba(255,255,255,0.8)' : '#6b778c'
  const toggle = (name) => {
    const has = members.some(m => same(m, name))
    onChange({ is_private: isPrivate, members: has ? members.filter(m => !same(m, name)) : [...members, name] })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: text, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!isPrivate} onChange={e => onChange({ is_private: e.target.checked, members })}
          style={{ width: 16, height: 16, cursor: 'pointer' }} />
        🔒 Private project
      </label>
      {isPrivate && (
        <>
          <span style={{ fontSize: 12, color: muted }}>
            Only {owner ? <b>{owner}</b> : 'the owner'} and the people ticked can see it and its tasks (anyone a task is assigned to sees that task).
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PEOPLE.filter(n => !same(n, owner)).map(n => {
              const on = members.some(m => same(m, n))
              return (
                <button key={n} type="button" onClick={() => toggle(n)} aria-pressed={on}
                  style={{ border: `1px solid ${on ? (onDark ? '#fff' : 'var(--indigo)') : (onDark ? 'rgba(255,255,255,0.5)' : '#dfe1e6')}`,
                    background: on ? (onDark ? '#fff' : 'var(--indigo)') : 'transparent',
                    color: on ? (onDark ? 'var(--indigo)' : '#fff') : text,
                    borderRadius: 14, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Nunito, sans-serif' }}>
                  {on ? '✓ ' : ''}{n}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
