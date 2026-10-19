import OwnerAvatar from './OwnerAvatar'
import CommentBody from './CommentBody'

const TYPE_COLORS = {
  mention:          { bg: '#e9f2ff', color: '#0052cc', label: '@Mention' },
  comment_on_owned: { bg: '#e3fcef', color: '#00875a', label: 'Comment' },
  auto_assigned:    { bg: '#ede9fe', color: '#6554c0', label: 'Filed by Claude' },
}

export default function InboxView({ notifications, tasks, unreadCount, markRead, markAllRead, setSelectedTask }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: 18, color: 'var(--indigo)' }}>Notifications</h2>
          <p style={{ fontSize: 13, color: '#6b778c', fontWeight: 600, marginTop: 2 }}>Comments on your tasks and @mentions</p>
        </div>
        {unreadCount > 0 && <button onClick={markAllRead} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #dfe1e6', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#6b778c', fontFamily: 'Nunito, sans-serif' }}>Mark all read</button>}
      </div>
      {notifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b778c' }}>
          <p style={{ fontSize: 32, marginBottom: 8 }}>🔔</p>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>All caught up</p>
          <p style={{ fontSize: 13 }}>You will see @mentions and comments on your tasks here</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notifications.map(n => {
            const tc = TYPE_COLORS[n.type] || TYPE_COLORS.comment_on_owned
            const notifTask = tasks.find(t => t.id === n.task_id)
            return (
              <div key={n.id} onClick={async () => { await markRead(n.id); if (notifTask) setSelectedTask(notifTask) }}
                style={{ background: n.read ? '#fff' : '#f0f4ff', borderRadius: 10, border: '1px solid ' + (n.read ? '#dfe1e6' : '#c0d4ff'), padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8f9ff'}
                onMouseLeave={e => e.currentTarget.style.background = n.read ? '#fff' : '#f0f4ff'}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: n.read ? 'transparent' : '#0052cc', flexShrink: 0, marginTop: 6 }} />
                <OwnerAvatar name={n.from_user} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#172b4d' }}>{n.from_user}</span>
                    <span style={{ background: tc.bg, color: tc.color, borderRadius: 3, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{tc.label}</span>
                    <span style={{ fontSize: 11, color: '#a0aec0', marginLeft: 'auto' }}>{new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#6b778c', marginBottom: 4 }}>on <span style={{ fontWeight: 700, color: '#42526e' }}>{n.task_title}</span></p>
                  <div style={{ background: '#f8f9fc', borderRadius: 6, padding: '6px 10px' }}>
                    <CommentBody body={n.body.substring(0, 120) + (n.body.length > 120 ? '...' : '')} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
