import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { supabase, apiFetch } from '../lib/supabase'
import { getMsal } from '../lib/msal'
import { getDisplayName } from '../lib/team'
import { useIsMobile } from '../lib/useIsMobile'
import LoginScreen from '../components/LoginScreen'
import GlobalStyles from '../components/GlobalStyles'
import AppShell from '../components/AppShell'
import TaskDetailPanel, { TASK_PANEL } from '../components/TaskDetailPanel'
import AddTaskModal from '../components/AddTaskModal'
import AddProjectModal from '../components/AddProjectModal'
import MyWorkView from '../components/MyWorkView'
import MyProjectsView from '../components/MyProjectsView'
import InboxView from '../components/InboxView'
import TriageView from '../components/TriageView'
import ApprovalsView from '../components/ApprovalsView'
import ProjectGallery from '../components/ProjectGallery'
import ProjectSection from '../components/ProjectSection'

// PostgREST returns at most 1000 rows per request; page until a short page.
async function selectAll(build) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) return rows
  }
}

export default function Home() {
  const [user, setUser]                         = useState(null)
  const [authLoading, setAuthLoading]           = useState(true)
  const [loginLoading, setLoginLoading]         = useState(false)
  const [view, setView]                         = useState('board')
  const [tasks, setTasks]                       = useState([])
  const [projects, setProjects]                 = useState([])
  const [programmes, setProgrammes]             = useState([])
  const [taskGroups, setTaskGroups]             = useState([])
  const [notifications, setNotifications]       = useState([])
  const [triageCount, setTriageCount]           = useState(0)
  const [loading, setLoading]                   = useState(true)
  const [activeProject, setActiveProject]       = useState(null)
  const [showAddTask, setShowAddTask]           = useState(false)
  const [showAddProject, setShowAddProject]     = useState(false)
  const [addTaskProjectId, setAddTaskProjectId] = useState(null)
  const [addTaskParentId, setAddTaskParentId]   = useState(null)
  const [search, setSearch]                     = useState('')
  const [selectedTask, setSelectedTask]         = useState(null)
  const [taskPanelW, setTaskPanelW]             = useState(TASK_PANEL.DEFAULT)
  const isMobile = useIsMobile()
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const n = Number(window.sessionStorage.getItem(TASK_PANEL.STORAGE_KEY))
      if (Number.isFinite(n) && n >= TASK_PANEL.MIN && n <= TASK_PANEL.MAX) setTaskPanelW(n)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    (async () => {
      try {
        const msal = await getMsal()
        await msal.handleRedirectPromise()
        const accounts = msal.getAllAccounts()
        if (accounts.length > 0) setUser(accounts[0])
      } catch (e) { console.error('MSAL init', e) }
      finally { setAuthLoading(false) }
    })()
  }, [])

  const handleLogin  = async () => { setLoginLoading(true); try { const m = await getMsal(); await m.loginRedirect({ scopes: ['User.Read'] }) } catch (e) { console.error('Login error', e); setLoginLoading(false) } }
  const handleLogout = async () => { const m = await getMsal(); m.logoutRedirect() }
  const userName = getDisplayName(user?.username) || user?.name?.split(' ')[0] || ''

  const load = useCallback(async () => {
    const [t, p, g, pr] = await Promise.all([
      selectAll(() => supabase.from('tasks').select('*').is('archived_at', null).order('created_at', { ascending: true })),
      selectAll(() => supabase.from('projects').select('*').is('archived_at', null).order('created_at', { ascending: false })),
      selectAll(() => supabase.from('task_groups').select('*').is('archived_at', null).order('position', { ascending: true })),
      selectAll(() => supabase.from('programmes').select('id, name, position').is('archived_at', null).order('position', { ascending: true }).order('name', { ascending: true })),
    ])
    setTasks(t); setProjects(p); setTaskGroups(g); setProgrammes(pr)
  }, [])
  const loadTriageCount = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/triage?status=new,partial&limit=1')
      if (resp.ok) setTriageCount((await resp.json()).total || 0)
    } catch { /* badge only */ }
  }, [])
  useEffect(() => { if (user) loadTriageCount() }, [user, loadTriageCount])
  useEffect(() => {
    if (!user) return
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [user, load])

  const loadNotifications = useCallback(async () => {
    if (!userName) return
    const { data } = await supabase.from('notifications').select('*').eq('user_name', userName).order('created_at', { ascending: false }).limit(50)
    setNotifications(data || [])
  }, [userName])
  useEffect(() => { if (userName) loadNotifications() }, [userName, loadNotifications])

  // Close the task detail sidebar whenever the user navigates. Without this the
  // panel stays pinned across view/project switches and leaks stale task state
  // into the next screen (e.g. an AI OS task still visible over My Work).
  // Browser Back lands here too because setActiveProject/setView drive the UI.
  useEffect(() => { setSelectedTask(null) }, [view, activeProject])

  // Optimistic single-task patch — used by row-level and sidebar edits so the
  // project-header progress bar (and any other derived count) updates in the
  // same React tick, before the DB round-trip completes. load() still runs
  // afterwards via onUpdate so any server-side changes are reconciled.
  const patchTask = useCallback((id, patch) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  const markRead    = async id => { await supabase.from('notifications').update({ read: true }).eq('id', id); loadNotifications() }
  const markAllRead = async () => { await supabase.from('notifications').update({ read: true }).eq('user_name', userName).eq('read', false); loadNotifications() }
  const deleteTask  = async id => { await supabase.from('tasks').delete().eq('id', id); load() }
  // Delete a task_group row. tasks.group_id has ON DELETE SET NULL, so member
  // tasks survive and fall into the project's "ungrouped" bucket.
  const deleteGroup = async id => { await supabase.from('task_groups').delete().eq('id', id); load() }
  const handleAddTask    = projectId => { setAddTaskProjectId(projectId); setAddTaskParentId(null); setShowAddTask(true) }
  const handleAddSubtask = parentId  => {
    const parent = tasks.find(t => t.id === parentId)
    setAddTaskProjectId(parent?.project_id || null); setAddTaskParentId(parentId); setShowAddTask(true)
  }
  const onHeaderAddTask = () => { setView('board'); setAddTaskProjectId(null); setAddTaskParentId(null); setShowAddTask(true) }
  // Opening a project (or All projects) from the sidebar always shows the project board,
  // whichever view was open (before, it did nothing visible from My Work, Triage etc.).
  const openProject = (id) => { setView('board'); setActiveProject(id) }
  // Phone tabs: Projects always lands on the project list.
  const navigate = (key) => { if (key === 'board') setActiveProject(null); setView(key) }

  // Visibility: flow tasks only show to the assigned user unless linked to a project
  const visibleTasks = tasks.filter(t => (t.source === 'manual' || !t.source || t.project_id || !t.assigned_to) || t.assigned_to.toLowerCase() === userName.toLowerCase())
  const filteredTasks = search ? visibleTasks.filter(t => t.title?.toLowerCase().includes(search.toLowerCase())) : visibleTasks
  // Count of every open task (not done, not a group) assigned to the current user,
  // used as the sidebar badge next to My Work.
  const myOpenTasksCount = visibleTasks.filter(t => !t.is_group && t.status !== 'done' && t.assigned_to?.toLowerCase() === userName.toLowerCase()).length
  const unreadCount   = notifications.filter(n => !n.read).length
  const approvalsCount = tasks.filter(t => t.task_type === 'approval' && !t.decision).length

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #3D157D 0%, #1a0a3a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Nunito, sans-serif', color: '#fff', fontSize: 16, fontWeight: 600 }}>
      <Head><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet" /></Head>
      Loading...
    </div>
  )
  if (!user) return <LoginScreen onLogin={handleLogin} loading={loginLoading} />

  const activeProjectData = activeProject ? projects.find(p => p.id === activeProject) : null
  const activeProjectIdx  = activeProject ? projects.findIndex(p => p.id === activeProject) : -1

  return (
    <>
      <GlobalStyles />
      <AppShell isMobile={isMobile} scrollKey={`${view}|${activeProject || ''}`} onNavigate={navigate}
        mainRightPad={selectedTask && !isMobile ? taskPanelW : 0}
        header={{ search, setSearch, userName, handleLogout, onAddTaskClick: onHeaderAddTask, onAddProjectClick: () => setShowAddProject(true) }}
        sidebar={{ view, setView, projects, programmes, activeProject, setActiveProject: openProject,
          myFlowCount: myOpenTasksCount, unreadCount, approvalsCount, triageCount }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: '#6b778c', fontWeight: 600 }}>Loading...</div>
          ) : view === 'mywork' ? (
            <MyWorkView visibleTasks={visibleTasks} userName={userName}
              projects={projects} setSelectedTask={setSelectedTask} load={load} />
          ) : view === 'myprojects' ? (
            <MyProjectsView projects={projects} visibleTasks={visibleTasks} userName={userName}
              setActiveProject={(id) => { setView('board'); setActiveProject(id) }} />
          ) : view === 'inbox' ? (
            <InboxView notifications={notifications} tasks={tasks} unreadCount={unreadCount}
              markRead={markRead} markAllRead={markAllRead} setSelectedTask={setSelectedTask} />
          ) : view === 'triage' ? (
            <TriageView projects={projects} tasks={tasks} onChanged={load} setTriageCount={setTriageCount} />
          ) : view === 'approvals' ? (
            <ApprovalsView tasks={tasks} projects={projects} setSelectedTask={setSelectedTask} />
          ) : activeProjectData ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <button onClick={() => setActiveProject(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#6b778c', fontFamily: 'Nunito, sans-serif', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}>
                  ← All Projects
                </button>
              </div>
              <ProjectSection key={activeProjectData.id} project={activeProjectData} colorIndex={activeProjectIdx} userName={userName}
                tasks={(search ? filteredTasks : visibleTasks).filter(t => t.project_id === activeProjectData.id)}
                allTasks={visibleTasks} taskGroups={taskGroups} onUpdate={load} onPatch={patchTask}
                onDelete={deleteTask} onDeleteGroup={deleteGroup}
                onAddTask={handleAddTask} onAddSubtask={handleAddSubtask} onSelect={setSelectedTask} />
            </>
          ) : (
            <ProjectGallery projects={projects} visibleTasks={visibleTasks} allTasks={tasks}
              setActiveProject={setActiveProject} setShowAddProject={setShowAddProject} onUpdate={load} />
          )}
      </AppShell>

      {selectedTask && <TaskDetailPanel task={selectedTask} user={user} allTasks={tasks} onClose={() => setSelectedTask(null)} onUpdate={load} onPatch={patchTask} panelW={taskPanelW} setPanelW={setTaskPanelW} />}
      {showAddTask && <AddTaskModal projects={projects} parentId={addTaskParentId} projectId={addTaskProjectId} allTasks={tasks} onClose={() => setShowAddTask(false)} onSaved={load} currentUser={user} />}
      {showAddProject && <AddProjectModal onClose={() => setShowAddProject(false)} onSaved={load} colorIndex={projects.length} userName={userName} />}
      <div id="timeline-portal" />
    </>
  )
}
