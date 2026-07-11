// ═══════════════════════════════════════════════
// PASTE YOUR SUPABASE KEYS HERE
// ═══════════════════════════════════════════════
const SUPABASE_URL      = 'https://atfivtjagvavbzfabpez.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_uI2JCH8xM35sd18ZhLpCig_XO_MPTNG'
// ═══════════════════════════════════════════════

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── State ─────────────────────────────────────
let currentUser = null
let currentUserName = ''
let isRecording = false
let allExpenses = []
let allGroups = []
let currentGroupId = null
let currentFriendName = null
let selfPersonId = null
let editingGroupId = null

// ══════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════

window.addEventListener('load', async () => {
  const { data } = await db.auth.getSession()
  if (data.session) showApp(data.session.user)
  else showLanding()
})

db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) { closeModal(); showApp(session.user) }
  if (event === 'SIGNED_OUT') { currentUser = null; showLanding() }
})

function showLanding() {
  document.getElementById('landing-page').classList.remove('hidden')
  document.getElementById('app-page').classList.add('hidden')
}

async function showApp(user) {
  currentUser = user
  currentUserName = user.user_metadata?.name || user.email.split('@')[0]
  document.getElementById('landing-page').classList.add('hidden')
  document.getElementById('app-page').classList.remove('hidden')
  document.getElementById('user-greeting').textContent = 'Hi, ' + currentUserName + ' 👋'
  selfPersonId = await ensureSelfPerson()
  await Promise.all([loadExpenses(), loadGroups()])
}

// ══════════════════════════════════════════════
// PEOPLE — resolving names/emails to real "people" rows
// ══════════════════════════════════════════════

async function ensureSelfPerson() {
  const { data, error } = await db.rpc('get_or_create_self')
  if (error) { console.error('get_or_create_self error:', error); return null }
  return data
}

async function resolvePerson(name, email = '') {
  const trimmedName = (name || '').trim()
  if (!trimmedName) return null

  const lower = trimmedName.toLowerCase()

  if (
    lower === 'you' ||
    lower === 'i' ||
    lower === 'me' ||
    lower === 'myself' ||
    lower === currentUserName.toLowerCase()
  ) {
    return selfPersonId
  }

  const { data, error } = await db.rpc('upsert_person', {
    p_name: trimmedName,
    p_email: email || null
  })

  if (error) {
    console.error('resolvePerson error:', error)
    return null
  }

  return data
}

function showModal(type) {
  document.getElementById('auth-modal').classList.remove('hidden')
  document.getElementById('form-login').classList.toggle('hidden', type !== 'login')
  document.getElementById('form-signup').classList.toggle('hidden', type !== 'signup')
}

function closeModal() {
  document.getElementById('auth-modal').classList.add('hidden')
  clearErrors()
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById('auth-modal')) closeModal()
}

function clearErrors() {
  ['login-error','signup-error'].forEach(id => {
    const el = document.getElementById(id)
    el.classList.add('hidden'); el.textContent = ''
    el.style.background = ''; el.style.color = ''
  })
}

function showError(id, msg, isSuccess = false) {
  const el = document.getElementById(id)
  el.textContent = msg; el.classList.remove('hidden')
  if (isSuccess) { el.style.background = '#EAF3DE'; el.style.color = '#27500A' }
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { showError('login-error', 'Please fill in both fields.'); return }
  const btn = document.querySelector('#form-login .btn-full')
  btn.textContent = 'Logging in...'; btn.disabled = true
  const { error } = await db.auth.signInWithPassword({ email, password })
  btn.textContent = 'Log in'; btn.disabled = false
  if (error) showError('login-error', 'Wrong email or password.')
}

async function handleSignup() {
  const name = document.getElementById('signup-name').value.trim()
  const email = document.getElementById('signup-email').value.trim()
  const password = document.getElementById('signup-password').value
  if (!name || !email || !password) { showError('signup-error', 'Please fill in all fields.'); return }
  if (password.length < 6) { showError('signup-error', 'Password must be at least 6 characters.'); return }
  const btn = document.querySelector('#form-signup .btn-full')
  btn.textContent = 'Creating account...'; btn.disabled = true
  const { error } = await db.auth.signUp({ email, password, options: { data: { name } } })
  btn.textContent = 'Create account'; btn.disabled = false
  if (error) showError('signup-error', error.message || 'Something went wrong.')
  else showError('signup-error', '✅ Account created! You can now log in.', true)
}

async function handleLogout() {
  await db.auth.signOut()
}

// ══════════════════════════════════════════════
// TAB NAVIGATION
// ══════════════════════════════════════════════

function showTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'))
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tab-' + name).classList.remove('hidden')
  btn.classList.add('active')
  if (name === 'groups') renderGroups()
  if (name === 'friends') renderFriends()
  if (name === 'insights') renderInsights()
}

function showSubTab(id, btn) {
  btn.closest('.section-container').querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  const panels = ['group-expenses','group-balances','friend-expenses']
  panels.forEach(p => { const el = document.getElementById(p); if (el) el.classList.add('hidden') })
  const el = document.getElementById(id)
  if (el) el.classList.remove('hidden')
}

// ══════════════════════════════════════════════
// VOICE RECORDING
// ══════════════════════════════════════════════

function toggleRecording() {
  if (!isRecording) startRecording()
  else stopRecording()
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    window._mediaRecorder = mediaRecorder
    window._audioChunks = []
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) window._audioChunks.push(e.data) }
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const audioBlob = new Blob(window._audioChunks, { type: 'audio/webm' })
      await sendVoiceToServer(audioBlob)
    }
    mediaRecorder.start()
    isRecording = true
    document.getElementById('mic-button').classList.add('recording')
    document.getElementById('mic-icon').textContent = '⏹️'
    document.getElementById('recording-status').classList.remove('hidden')
  } catch (err) {
    alert('Microphone access denied. Please allow microphone access in your browser settings.')
  }
}

function stopRecording() {
  if (window._mediaRecorder && isRecording) {
    window._mediaRecorder.stop()
    isRecording = false
    document.getElementById('mic-button').classList.remove('recording')
    document.getElementById('mic-icon').textContent = '🎙️'
    document.getElementById('recording-status').classList.add('hidden')
  }
}

async function sendVoiceToServer(audioBlob) {
  showThinking(true)
  try {
    const base64Audio = await blobToBase64(audioBlob)
    const audioBase64 = base64Audio.split(',')[1]
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'voice', audioBase64 })
    })
    const data = await response.json()
    showThinking(false)
    if (data.success && data.expense) showConfirmCard(data.expense)
    else alert('Could not understand audio. Please type the expense instead.')
  } catch (err) {
    showThinking(false)
    alert('Something went wrong. Please type your expense instead.')
  }
}

// ══════════════════════════════════════════════
// TEXT PARSING
// ══════════════════════════════════════════════

async function parseExpenseFromText() {
  const input = document.getElementById('expense-input').value.trim()
  if (!input) return
  showThinking(true)
  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text', text: input })
    })
    const data = await response.json()
    showThinking(false)
    if (data.success && data.expense) {
      showConfirmCard(data.expense)
      document.getElementById('expense-input').value = ''
    } else {
      alert('Could not parse that. Try: "Paid 500 for dinner with Rahul"')
    }
  } catch (err) {
    showThinking(false)
    alert('Something went wrong. Please try again.')
  }
}

// ══════════════════════════════════════════════
// CONFIRM CARD
// ══════════════════════════════════════════════

function showConfirmCard(parsed) {
  document.getElementById('confirm-original').textContent = '"' + (parsed.transcript || '') + '"'
  document.getElementById('edit-transcript').value = parsed.transcript || ''
  document.getElementById('edit-amount').value = parsed.amount || ''
  document.getElementById('edit-description').value = parsed.description || ''
  const detectedCategory = detectCategory(parsed.description || '')
  document.getElementById('edit-category').value =
  detectedCategory || parsed.category || '🧾 General'
  document.getElementById('edit-paidby').value = parsed.paidBy || 'You'
  document.getElementById('edit-people').value = (parsed.people || []).join(', ')
  document.getElementById('edit-type').value = parsed.type || 'personal'

  // Populate group dropdown
  const groupSelect = document.getElementById('edit-group-id')
  groupSelect.innerHTML = '<option value="">-- select a group --</option>'
  allGroups.forEach(g => {
    const opt = document.createElement('option')
    opt.value = g.id
    opt.textContent = g.emoji + ' ' + g.name
    groupSelect.appendChild(opt)
  })

 // --------------------
// Smart group detection
// --------------------

let detectedGroup = null

// First try the group returned by AI
if (parsed.groupName) {
  detectedGroup = allGroups.find(g =>
    g.name.toLowerCase() === parsed.groupName.toLowerCase()
  )
}

// Otherwise search the transcript + description
if (!detectedGroup) {

  const text = (
    (parsed.transcript || "") +
    " " +
    (parsed.description || "")
  ).toLowerCase()

  detectedGroup = allGroups.find(g =>
    text.includes(g.name.toLowerCase())
  )
}

if (detectedGroup) {

  document.getElementById('edit-type').value = 'group'
  groupSelect.value = detectedGroup.id

  // ONLY auto-fill everyone if nobody was explicitly mentioned
  if ((parsed.people || []).length === 0) {

    parsed.people = detectedGroup.group_members
      .map(m => m.name)
      .filter(name =>
        name.toLowerCase() !== (parsed.paidBy || '').toLowerCase()
      )

    document.getElementById('edit-people').value =
      parsed.people.join(', ')
  }

}

toggleGroupField()
  
  // Split chips
  const people = parsed.people || []
  const total = people.length + 1
  const perPerson = total > 0 ? Math.round((parsed.amount || 0) / total) : 0
  document.getElementById('confirm-split').innerHTML = `
    <span class="split-chip payer">${parsed.paidBy || 'You'} paid ₹${(parsed.amount || 0).toLocaleString('en-IN')}</span>
    ${people.map(p => `<span class="split-chip">${p} owes ₹${perPerson.toLocaleString('en-IN')}</span>`).join('')}
  `
  document.getElementById('confirm-card').classList.remove('hidden')
}

function toggleGroupField() {
  const type = document.getElementById('edit-type').value
  document.getElementById('group-select-field').style.display = type === 'group' ? 'block' : 'none'
}

function cancelConfirm() {
  document.getElementById('confirm-card').classList.add('hidden')
}

// ══════════════════════════════════════════════
// SAVE EXPENSE TO SUPABASE
// ══════════════════════════════════════════════

async function confirmExpense() {
  const amount = parseFloat(document.getElementById('edit-amount').value)
const description = document.getElementById('edit-description').value.trim()
const category = document.getElementById('edit-category').value

let paidByName = document.getElementById('edit-paidby').value.trim()

if (
  !paidByName ||
  ['i', 'me', 'myself', 'you'].includes(paidByName.toLowerCase())
) {
  paidByName = currentUserName
}
  const peopleRaw = document.getElementById('edit-people').value.trim()
let peopleNames = peopleRaw
  ? peopleRaw.split(',').map(p => p.trim()).filter(Boolean)
  : []

const type = document.getElementById('edit-type').value
const groupId = document.getElementById('edit-group-id').value || null

// If this is a group expense and no names were entered,
// automatically split with everyone else in the group.
if (type === 'group' && groupId && peopleNames.length === 0) {
  const group = allGroups.find(g => g.id === groupId)

  if (group) {
    peopleNames = group.group_members
      .map(m => m.name)
      .filter(name => name.toLowerCase() !== currentUserName.toLowerCase())
  }
}
  const transcript = document.getElementById('edit-transcript').value || description
  const perPerson = peopleNames.length > 0 ? Math.round(amount / (peopleNames.length + 1)) : amount

  if (!amount || !description) { alert('Please fill in at least the amount and description.'); return }

const paidByPersonId = await resolvePerson(paidByName)

// Never split the bill with the payer.
peopleNames = peopleNames.filter(
  name => name.toLowerCase() !== paidByName.toLowerCase()
)
  if (!paidByPersonId) { alert('Could not resolve who paid. Please try again.'); return }

  const splitPeople = []
  for (const name of peopleNames) {
    const pid = await resolvePerson(name)
    if (pid) splitPeople.push({ name, id: pid })
  }

  const { data, error } = await db.from('expenses').insert([{
    created_by: currentUser.id,
    amount,
    description,
    category,
    paid_by_person_id: paidByPersonId,
    group_id: type === 'group' ? groupId : null,
    transcript
  }]).select()

  if (error) { alert('Error saving expense: ' + error.message); return }

  const expenseId = data[0].id

  if (splitPeople.length > 0) {
    const splitRows = splitPeople.map(p => ({ expense_id: expenseId, person_id: p.id, amount_owed: perPerson }))
    const { error: splitError } = await db.from('expense_splits').insert(splitRows)
    if (splitError) console.error('Split insert error:', splitError)
    await setupReminders(expenseId, splitPeople.map(p => p.name), amount, perPerson)
  }

  await loadExpenses()
  document.getElementById('confirm-card').classList.add('hidden')
  showSuccessToast(description, amount)
}

async function setupReminders(expenseId, people, amount, perPerson) {
  const reminders = people.map(name => ({
    from_user_id: currentUser.id,
    to_name: name,
    amount: perPerson,
    expense_id: expenseId,
    remind_after: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  }))
  await db.from('reminders').insert(reminders)
}

// ══════════════════════════════════════════════
// LOAD EXPENSES
// ══════════════════════════════════════════════

async function loadExpenses() {
  const { data, error } = await db.from('expenses')
    .select(`
      *,
      payer:people!paid_by_person_id(id, name),
      group:groups(id, name, emoji),
      expense_splits(person_id, amount_owed, people(id, name))
    `)
    .order('created_at', { ascending: false })
  if (error) { console.error('Load expenses error:', error); return }

  // Reconstruct the flat shape the rest of the app expects
  // (paid_by, people, per_person, type, group_name) from the joined data.
  allExpenses = (data || []).map(e => {
    const splits = e.expense_splits || []
    return {
      ...e,
      paid_by: e.payer?.name || currentUserName,
      paid_by_person_id_resolved: e.payer?.id || null,
      people: splits.map(s => s.people?.name).filter(Boolean),

splits: splits.map(s => ({
    person_id: s.person_id,
    name: s.people?.name,
    amount_owed: Number(s.amount_owed)
})),

per_person: splits.length > 0 ? Number(splits[0].amount_owed) : Number(e.amount),
      type: e.group_id ? 'group' : 'personal',
      group_name: e.group?.name || ''
    }
  })
  renderFeed()
}

function renderFeed() {
  const feed = document.getElementById('expense-feed')
  if (allExpenses.length === 0) {
    feed.innerHTML = '<div class="feed-empty">No expenses yet. Tap the mic to log your first one!</div>'
    return
  }
  feed.innerHTML = allExpenses.slice(0, 15).map(e => expenseCard(e)).join('')
}

function expenseCard(e) {
  const people = e.people || []
  const peopleText = people.length > 0 ? `with ${people.join(', ')}` : ''
  const typeTag = e.type === 'group'
    ? `<span class="tag tag-group">👥 ${e.group_name || 'Group'}</span>`
    : `<span class="tag tag-personal">👤 Personal</span>`
  return `
    <div class="expense-item">
      <div class="expense-item-top">
        <div class="expense-item-desc">${e.description}</div>
        <div class="expense-item-amount">₹${Number(e.amount).toLocaleString('en-IN')}</div>
      </div>
      <div class="expense-item-sub">${e.paid_by} paid ${peopleText} · ${getTimeAgo(e.created_at)}</div>
      <div class="expense-item-tags">
        <span class="tag tag-cat">${e.category}</span>
        ${typeTag}
      </div>
    </div>
  `
}

// ══════════════════════════════════════════════
// GROUPS
// ══════════════════════════════════════════════

async function loadGroups() {
  const { data, error } = await db.from('groups')
    .select('*, group_members(person_id, people(id, name, email, linked_user_id))')
    .order('created_at', { ascending: false })
  if (error) { console.error('Load groups error:', error); return }
  allGroups = (data || []).map(g => ({
    ...g,
    group_members: (g.group_members || []).map(gm => ({
      id: gm.person_id,
      name: gm.people?.name || 'Unknown',
      email: gm.people?.email || '',
      linked: !!gm.people?.linked_user_id
    }))
  }))
}

function renderGroups() {
  document.getElementById('group-detail').classList.add('hidden')
  document.getElementById('groups-list').classList.remove('hidden')
  const header = document.querySelector('#tab-groups .section-header')
  if (header) header.style.display = 'flex'

  const list = document.getElementById('groups-list')
  if (allGroups.length === 0) {
    list.innerHTML = '<div class="feed-empty">No groups yet. Create one to split expenses with friends!</div>'
    return
  }

  list.innerHTML = allGroups.map(g => {
    const members = g.group_members || []
    const groupExpenses = allExpenses.filter(e => e.group_id === g.id)
    const totalSpent = groupExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
    return `
      <div class="group-card" onclick="openGroupDetail('${g.id}')">
        <div class="group-card-top">
          <div>
            <div class="group-name">${g.emoji} ${g.name}</div>
            <div class="group-meta">${members.length} members · ₹${totalSpent.toLocaleString('en-IN')} total</div>
          </div>
          <div style="display:flex;align-items:center;gap:2px">
            ${g.created_by === currentUser.id ? `
              <div class="group-card-actions">
                <button class="icon-btn" onclick="event.stopPropagation(); showCreateGroup('${g.id}')" title="Edit group">✏️</button>
                <button class="icon-btn" onclick="event.stopPropagation(); deleteGroup('${g.id}')" title="Delete group">🗑️</button>
              </div>
            ` : ''}
            <div class="group-arrow">›</div>
          </div>
        </div>
        <div class="member-chips">
          ${members.slice(0, 5).map(m => `<span class="member-chip" title="${m.name}">${m.name[0].toUpperCase()}</span>`).join('')}
          ${members.length > 5 ? `<span class="member-chip">+${members.length - 5}</span>` : ''}
        </div>
      </div>
    `
  }).join('')
}

// ── Create group ──────────────────────────────

function showCreateGroup(groupId = null) {
  editingGroupId = groupId
  document.getElementById('create-group-modal').classList.remove('hidden')
  document.getElementById('member-tags').innerHTML = ''
  document.getElementById('member-input').value = ''
  const emailInput = document.getElementById('member-email-input')
  if (emailInput) emailInput.value = ''

  const modalTitle = document.querySelector('#create-group-modal h2')
  const modalSub = document.querySelector('#create-group-modal .modal-sub')
  const saveBtn = document.querySelector('#create-group-modal .btn-full')

  if (groupId) {
    const g = allGroups.find(x => x.id === groupId)
    if (!g) return
    modalTitle.textContent = 'Edit group'
    modalSub.textContent = 'Update the name, emoji, or members'
    saveBtn.textContent = 'Save changes'
    document.getElementById('group-name').value = g.name
    document.getElementById('group-emoji').value = g.emoji
    ;(g.group_members || []).forEach(m => {
      if (m.id === selfPersonId) return // don't show yourself as a removable tag
      addMemberTagFromData(m.name, m.email)
    })
  } else {
    modalTitle.textContent = 'Create a group'
    modalSub.textContent = 'Give it a name and add your friends'
    saveBtn.textContent = 'Create group'
    document.getElementById('group-name').value = ''
    document.getElementById('group-emoji').value = '👥'
  }
}

function closeCreateGroup() {
  document.getElementById('create-group-modal').classList.add('hidden')
  editingGroupId = null
}

function addMemberTagFromData(name, email = '') {
  const tagsDiv = document.getElementById('member-tags')
  const tag = document.createElement('div')
  tag.className = 'member-tag'
  tag.dataset.name = name
  tag.dataset.email = email
  tag.innerHTML = `
    <span class="member-tag-avatar">${name[0].toUpperCase()}</span>
    <span>${name}${email ? ' <span class="member-tag-email">✉️</span>' : ''}</span>
    <span class="member-tag-remove" onclick="this.parentElement.remove()">✕</span>
  `
  tagsDiv.appendChild(tag)
}

function addMemberTag() {
  const input = document.getElementById('member-input')
  const emailInput = document.getElementById('member-email-input')
  const name = input.value.trim()
  const email = emailInput ? emailInput.value.trim() : ''
  if (!name) return

  // Don't add duplicates
  const existing = document.querySelectorAll('.member-tag')
  for (const tag of existing) {
    if (tag.dataset.name.toLowerCase() === name.toLowerCase()) {
      input.value = ''
      if (emailInput) emailInput.value = ''
      return
    }
  }

  addMemberTagFromData(name, email)
  input.value = ''
  if (emailInput) emailInput.value = ''
  input.focus()
}

async function createGroup() {
  const name = document.getElementById('group-name').value.trim()
  const emoji = document.getElementById('group-emoji').value.trim() || '👥'

  if (!name) { showError('group-error', 'Please enter a group name.'); return }

  const btn = document.querySelector('#create-group-modal .btn-full')
  const isEditing = !!editingGroupId
  btn.disabled = true
  btn.textContent = isEditing ? 'Saving...' : 'Creating...'

  let groupId = editingGroupId

  if (isEditing) {
    const { error } = await db.from('groups').update({ name, emoji }).eq('id', editingGroupId)
    if (error) {
      showError('group-error', 'Error: ' + error.message)
      btn.disabled = false; btn.textContent = 'Save changes'
      return
    }
  } else {
    const { data: groupData, error: groupError } = await db.from('groups').insert([{
      name, emoji, created_by: currentUser.id
    }]).select()
    if (groupError) {
      showError('group-error', 'Error: ' + groupError.message)
      btn.disabled = false; btn.textContent = 'Create group'
      return
    }
    groupId = groupData[0].id
  }

  // Resolve every tagged member (and yourself) to a real person_id,
  // linking to an existing account by email where possible.
  const desiredPersonIds = new Set([selfPersonId])
  const tagEls = document.querySelectorAll('.member-tag')
  for (const tag of tagEls) {
    const pid = await resolvePerson(tag.dataset.name, tag.dataset.email || '')
    if (pid) desiredPersonIds.add(pid)
  }

  if (isEditing) {
    const { data: existing } = await db.from('group_members').select('person_id').eq('group_id', groupId)
    const existingIds = new Set((existing || []).map(r => r.person_id))
    const toAdd = [...desiredPersonIds].filter(id => !existingIds.has(id)).map(id => ({ group_id: groupId, person_id: id }))
    const toRemove = [...existingIds].filter(id => !desiredPersonIds.has(id))
    if (toAdd.length) await db.from('group_members').insert(toAdd)
    if (toRemove.length) await db.from('group_members').delete().eq('group_id', groupId).in('person_id', toRemove)
  } else {
    const memberRows = [...desiredPersonIds].map(id => ({ group_id: groupId, person_id: id }))
    const { error: memberError } = await db.from('group_members').insert(memberRows)
    if (memberError) {
      console.error('Member insert error:', memberError)
      showError('group-error', 'Group created but members failed to save: ' + memberError.message)
    }
  }

  btn.disabled = false; btn.textContent = isEditing ? 'Save changes' : 'Create group'
  editingGroupId = null
  closeCreateGroup()
  await loadGroups()
  renderGroups()
  showSuccessToast(isEditing ? name + ' updated' : name, 0, true)
}

async function deleteGroup(groupId) {
  const g = allGroups.find(x => x.id === groupId)
  if (!g) return false
  const ok = confirm(`Delete "${g.emoji} ${g.name}"? Its expenses stay in your history but won't be grouped anymore.`)
  if (!ok) return false
  const { error } = await db.from('groups').delete().eq('id', groupId)
  if (error) { alert('Error deleting group: ' + error.message); return false }
  await Promise.all([loadGroups(), loadExpenses()])
  renderGroups()
  return true
}

// ── Group detail ──────────────────────────────

async function openGroupDetail(groupId) {
  currentGroupId = groupId
  const group = allGroups.find(g => g.id === groupId)
  if (!group) return

  document.getElementById('groups-list').classList.add('hidden')
  const header = document.querySelector('#tab-groups .section-header')
  if (header) header.style.display = 'none'
  document.getElementById('group-detail').classList.remove('hidden')
  document.getElementById('group-detail-name').textContent = group.emoji + ' ' + group.name

  const actionsDiv = document.getElementById('group-detail-actions')
  if (actionsDiv) {
    actionsDiv.innerHTML = group.created_by === currentUser.id
      ? `<button class="icon-btn" onclick="showCreateGroup('${group.id}')" title="Edit group">✏️</button>
         <button class="icon-btn" onclick="deleteGroup('${group.id}').then(ok => { if (ok) closeGroupDetail() })" title="Delete group">🗑️</button>`
      : ''
  }

  const groupExpenses = allExpenses.filter(e => e.group_id === groupId)
  const expensesDiv = document.getElementById('group-expenses')

  if (groupExpenses.length === 0) {
    expensesDiv.innerHTML = '<div class="feed-empty">No expenses in this group yet. Log one from the Log tab!</div>'
  } else {
    expensesDiv.innerHTML = groupExpenses.map(e => expenseCard(e)).join('')
  }

  renderGroupBalances(group, groupExpenses)
}

function renderGroupBalances(group, groupExpenses) {
  const members = group.group_members || []
  const balances = {}
  members.forEach(m => { balances[m.name] = 0 })

  groupExpenses.forEach(e => {
    const people = e.people || []
    const total = people.length + 1
    const perPerson = Math.round(Number(e.amount) / total)
    const payer = e.paid_by
    if (balances[payer] !== undefined) balances[payer] += Number(e.amount) - perPerson
    else balances[payer] = Number(e.amount) - perPerson
    people.forEach(p => {
      if (balances[p] !== undefined) balances[p] -= perPerson
      else balances[p] = -perPerson
    })
  })

  const balDiv = document.getElementById('group-balances')
  const entries = Object.entries(balances)
  if (entries.length === 0) {
    balDiv.innerHTML = '<div class="feed-empty">No balances yet.</div>'
    return
  }

  balDiv.innerHTML = entries.map(([name, bal]) => `
    <div class="balance-row">
      <div class="bal-person">
        <div class="avatar-circle">${name[0].toUpperCase()}</div>
        <div class="bal-name">${name}</div>
      </div>
      <div class="bal-amount ${bal >= 0 ? 'owed' : 'owe'}">
        ${bal >= 0 ? `Gets back ₹${Math.abs(Math.round(bal)).toLocaleString('en-IN')}` : `Owes ₹${Math.abs(Math.round(bal)).toLocaleString('en-IN')}`}
      </div>
    </div>
  `).join('')
}

function closeGroupDetail() {
  document.getElementById('group-detail').classList.add('hidden')
  document.getElementById('groups-list').classList.remove('hidden')
  const header = document.querySelector('#tab-groups .section-header')
  if (header) header.style.display = 'flex'
  currentGroupId = null
}

// ══════════════════════════════════════════════
// FRIENDS
// ══════════════════════════════════════════════

function renderFriends() {
  document.getElementById('friend-detail').classList.add('hidden')
  document.getElementById('friends-list').classList.remove('hidden')
  const header = document.querySelector('#tab-friends .section-header')
  if (header) header.style.display = 'flex'

  const friendMap = {}
  allExpenses.forEach(e => {
    const people = e.people || []
    people.forEach(name => {
      if (!friendMap[name]) friendMap[name] = { name, expenses: [], totalOwed: 0 }
      friendMap[name].expenses.push(e)
      const perPerson = Number(e.per_person) || Math.round(Number(e.amount) / (people.length + 1))
      if (e.paid_by === 'You' || e.paid_by === currentUserName) {
        friendMap[name].totalOwed += perPerson
      } else {
        friendMap[name].totalOwed -= perPerson
      }
    })
  })

  const friends = Object.values(friendMap)
  const list = document.getElementById('friends-list')

  if (friends.length === 0) {
    list.innerHTML = '<div class="feed-empty">No friends yet. Log an expense with someone to see them here!</div>'
    return
  }

  list.innerHTML = friends.map(f => {
    const owed = f.totalOwed
    const balText = owed > 0
      ? `<span class="bal-amount owed">Owes you ₹${Math.round(owed).toLocaleString('en-IN')}</span>`
      : owed < 0
      ? `<span class="bal-amount owe">You owe ₹${Math.abs(Math.round(owed)).toLocaleString('en-IN')}</span>`
      : `<span class="bal-amount settled">Settled ✓</span>`

    return `
      <div class="friend-card" onclick="openFriendDetail('${f.name}')">
        <div class="friend-card-left">
          <div class="avatar-circle">${f.name[0].toUpperCase()}</div>
          <div>
            <div class="friend-name">${f.name}</div>
            <div class="friend-meta">${f.expenses.length} transactions</div>
          </div>
        </div>
        ${balText}
      </div>
    `
  }).join('')
}

function openFriendDetail(friendName) {
  currentFriendName = friendName
  document.getElementById('friends-list').classList.add('hidden')
  const header = document.querySelector('#tab-friends .section-header')
  if (header) header.style.display = 'none'
  document.getElementById('friend-detail').classList.remove('hidden')
  document.getElementById('friend-detail-name').textContent = friendName

  const friendExpenses = allExpenses.filter(e => (e.people || []).includes(friendName))

  let totalOwed = 0
  friendExpenses.forEach(e => {
    const people = e.people || []
    const perPerson = Number(e.per_person) || Math.round(Number(e.amount) / (people.length + 1))
    if (e.paid_by === 'You' || e.paid_by === currentUserName) totalOwed += perPerson
    else totalOwed -= perPerson
  })

  const summaryDiv = document.getElementById('friend-balance-summary')
  summaryDiv.innerHTML = `
    <div class="balance-hero ${totalOwed >= 0 ? 'green' : 'red'}">
      <div class="balance-hero-label">${totalOwed >= 0 ? friendName + ' owes you' : 'You owe ' + friendName}</div>
      <div class="balance-hero-amount">₹${Math.abs(Math.round(totalOwed)).toLocaleString('en-IN')}</div>
      <div class="balance-hero-sub">across ${friendExpenses.length} transactions</div>
    </div>
  `

  const remindBtn = document.getElementById('remind-btn')
  if (totalOwed > 0) {
    remindBtn.classList.remove('hidden')
    remindBtn.dataset.amount = totalOwed
  } else {
    remindBtn.classList.add('hidden')
  }

  const expDiv = document.getElementById('friend-expenses')
  if (friendExpenses.length === 0) {
    expDiv.innerHTML = '<div class="feed-empty">No transactions yet.</div>'
  } else {
    expDiv.innerHTML = friendExpenses.map(e => {
      const typeTag = e.type === 'group'
        ? `<span class="tag tag-group">👥 ${e.group_name || 'Group'}</span>`
        : `<span class="tag tag-personal">👤 Personal</span>`
      return `
        <div class="expense-item">
          <div class="expense-item-top">
            <div class="expense-item-desc">${e.description}</div>
            <div class="expense-item-amount">₹${Number(e.amount).toLocaleString('en-IN')}</div>
          </div>
          <div class="expense-item-sub">${e.paid_by} paid · ₹${Number(e.per_person).toLocaleString('en-IN')} each · ${getTimeAgo(e.created_at)}</div>
          <div class="expense-item-tags">
            <span class="tag tag-cat">${e.category}</span>
            ${typeTag}
          </div>
        </div>
      `
    }).join('')
  }
}

function closeFriendDetail() {
  document.getElementById('friend-detail').classList.add('hidden')
  document.getElementById('friends-list').classList.remove('hidden')
  const header = document.querySelector('#tab-friends .section-header')
  if (header) header.style.display = 'flex'
  currentFriendName = null
}

async function sendReminder() {
  const friendName = currentFriendName
  const amount = document.getElementById('remind-btn').dataset.amount

  const { data: person } = await db.from('people')
    .select('email')
    .eq('owner_id', currentUser.id)
    .ilike('name', friendName)
    .limit(1)
    .maybeSingle()

  const email = person?.email

  if (email) {
    const subject = encodeURIComponent('Friendly reminder — Spliq')
    const body = encodeURIComponent(`Hi ${friendName},\n\nJust a friendly reminder that you owe me ₹${Number(amount).toLocaleString('en-IN')} on Spliq.\n\nNo rush, just wanted to check in!\n\n${currentUserName}`)
    window.open(`mailto:${email}?subject=${subject}&body=${body}`)
  } else {
    const msg = `Hi ${friendName}! Just a reminder that you owe me ₹${Number(amount).toLocaleString('en-IN')} on Spliq 😊`
    navigator.clipboard.writeText(msg).then(() => {
      showSuccessToast('Reminder copied! Paste it in WhatsApp.', 0, true)
    })
  }

  await db.from('reminders').insert([{
    from_user_id: currentUser.id,
    to_name: friendName,
    to_email: email || '',
    amount: Number(amount)
  }])
}

// ══════════════════════════════════════════════
// INSIGHTS
// ══════════════════════════════════════════════

function renderInsights() {
  const container = document.getElementById('insights-content')

  if (allExpenses.length === 0) {
    container.innerHTML = '<div class="feed-empty">Log some expenses to see your insights!</div>'
    return
  }

  const now = new Date()
  const thisMonth = allExpenses.filter(e => {
    const d = new Date(e.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const totalMonth = thisMonth.reduce((sum, e) => sum + Number(e.amount), 0)
  const totalAll = allExpenses.reduce((sum, e) => sum + Number(e.amount), 0)

  let totalOwedToYou = 0
  allExpenses.forEach(e => {
    const people = e.people || []
    if (people.length === 0) return
    const perPerson = Number(e.per_person) || Math.round(Number(e.amount) / (people.length + 1))
    if (e.paid_by === 'You' || e.paid_by === currentUserName) {
      totalOwedToYou += perPerson * people.length
    }
  })

  const catTotals = {}
  allExpenses.forEach(e => {
    catTotals[e.category] = (catTotals[e.category] || 0) + Number(e.amount)
  })
  const topCategory = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]

  const friendCounts = {}
  allExpenses.forEach(e => {
    (e.people || []).forEach(name => {
      friendCounts[name] = (friendCounts[name] || 0) + 1
    })
  })
  const topFriend = Object.entries(friendCounts).sort((a, b) => b[1] - a[1])[0]

  const groupTotals = {}
  allExpenses.filter(e => e.type === 'group').forEach(e => {
    const key = e.group_name || 'Group'
    groupTotals[key] = (groupTotals[key] || 0) + Number(e.amount)
  })
  const topGroup = Object.entries(groupTotals).sort((a, b) => b[1] - a[1])[0]

  const monthlyData = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const monthExpenses = allExpenses.filter(e => {
      const ed = new Date(e.created_at)
      return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear()
    })
    const total = monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
    monthlyData.push({ month: d.toLocaleString('default', { month: 'short' }), total })
  }
  const maxMonthly = Math.max(...monthlyData.map(m => m.total), 1)

  const payFirstCount = allExpenses.filter(e => e.paid_by === 'You' || e.paid_by === currentUserName).length
  const payFirstPct = Math.round((payFirstCount / allExpenses.length) * 100)

  container.innerHTML = `
    <div class="insight-row">
      <div class="insight-card">
        <div class="insight-label">This month</div>
        <div class="insight-value">₹${totalMonth.toLocaleString('en-IN')}</div>
      </div>
      <div class="insight-card">
        <div class="insight-label">All time</div>
        <div class="insight-value">₹${totalAll.toLocaleString('en-IN')}</div>
      </div>
    </div>
    <div class="insight-row">
      <div class="insight-card green">
        <div class="insight-label">Owed to you</div>
        <div class="insight-value">₹${totalOwedToYou.toLocaleString('en-IN')}</div>
      </div>
      <div class="insight-card">
        <div class="insight-label">Expenses logged</div>
        <div class="insight-value">${allExpenses.length}</div>
      </div>
    </div>
    <div class="insight-card-full">
      <div class="insight-label">Monthly spending trend</div>
      <div class="bar-chart">
        ${monthlyData.map(m => `
          <div class="bar-wrap">
            <div class="bar-fill" style="height:${Math.round((m.total / maxMonthly) * 80)}px"></div>
            <div class="bar-label">${m.month}</div>
            <div class="bar-value">${m.total > 0 ? '₹' + (m.total/1000).toFixed(1) + 'k' : '-'}</div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="insight-card-full">
      <div class="insight-label">Spending by category</div>
      ${Object.entries(catTotals).sort((a,b) => b[1]-a[1]).map(([cat, amt]) => `
        <div class="cat-row">
          <div class="cat-name">${cat}</div>
          <div class="cat-bar-wrap"><div class="cat-bar" style="width:${Math.round((amt/totalAll)*100)}%"></div></div>
          <div class="cat-amount">₹${amt.toLocaleString('en-IN')}</div>
        </div>
      `).join('')}
    </div>
    ${topFriend ? `<div class="insight-card-full fun-card"><div class="fun-icon">🤝</div><div class="fun-label">Most frequent co-spender</div><div class="fun-value">${topFriend[0]}</div><div class="fun-sub">${topFriend[1]} shared expenses</div></div>` : ''}
    ${topGroup ? `<div class="insight-card-full fun-card"><div class="fun-icon">👥</div><div class="fun-label">Biggest spending group</div><div class="fun-value">${topGroup[0]}</div><div class="fun-sub">₹${topGroup[1].toLocaleString('en-IN')} total</div></div>` : ''}
    ${topCategory ? `<div class="insight-card-full fun-card"><div class="fun-icon">🏆</div><div class="fun-label">Top spending category</div><div class="fun-value">${topCategory[0]}</div><div class="fun-sub">₹${topCategory[1].toLocaleString('en-IN')} spent</div></div>` : ''}
    <div class="insight-card-full fun-card"><div class="fun-icon">⚡</div><div class="fun-label">You pay first</div><div class="fun-value">${payFirstPct}% of the time</div><div class="fun-sub">across all your expenses</div></div>
  `
}

// ══════════════════════════════════════════════
// LANDING PAGE DEMO
// ══════════════════════════════════════════════

function runDemo() {
  const input = document.getElementById('demo-input').value.trim()
  if (!input) return
  const result = parseExpenseLocally(input)
  const resultBox = document.getElementById('demo-result')
  resultBox.innerHTML = `
    <div class="result-title">✨ AI parsed your expense</div>
    <div class="result-amount">₹${result.amount.toLocaleString('en-IN')}</div>
    <div class="result-detail">${result.description} · ${result.category}</div>
    <div class="split-chips">
      <span class="chip paid">${result.paidBy} paid</span>
      ${result.people.map(p => `<span class="chip">${p} owes ₹${result.perPerson.toLocaleString('en-IN')}</span>`).join('')}
    </div>
  `
  resultBox.classList.remove('hidden')
}

function parseExpenseLocally(text) {
  const lower = text.toLowerCase()
  let amount = 0
  const amountMatch = text.match(/[₹Rs\s]*(\d[\d,]*)/i)
  if (amountMatch) amount = parseInt(amountMatch[1].replace(/,/g, ''))
  if (amount === 0) amount = 500
  const skipWords = new Set(['i','paid','for','with','and','split','me','my','the','a','an','rs','equally','among'])
  const words = text.split(/[\s,]+/)
  const names = words.filter(w => {
    if (!w) return false
    const lo = w.toLowerCase().replace(/[^a-z]/g, '')
    return w[0] === w[0].toUpperCase() && w[0].match(/[A-Z]/) && !skipWords.has(lo) && isNaN(w)
  })
  let paidBy = 'You'
  const paidMatch = text.match(/(\w+)\s+paid/i)
  if (paidMatch && !skipWords.has(paidMatch[1].toLowerCase())) paidBy = paidMatch[1]
  let category = '🧾 General'
  if (lower.match(/dinner|lunch|breakfast|food|restaurant|eat|snack|pizza|biryani/)) category = '🍽️ Food'
  else if (lower.match(/cab|uber|ola|taxi|auto|bus|train|flight|travel|petrol/)) category = '🚗 Travel'
  else if (lower.match(/hotel|stay|room|accommodation|airbnb|hostel/)) category = '🏨 Accommodation'
  else if (lower.match(/movie|concert|party|club|drink|bar|netflix|ticket/)) category = '🎉 Entertainment'
  else if (lower.match(/grocery|milk|vegetables|mart|supermarket/)) category = '🛒 Groceries'
  const people = names.filter(n => n !== paidBy)
  const total = people.length + 1
  const perPerson = Math.round(amount / total)
  const forMatch = text.match(/for\s+(.+?)(?:\s+with|\s+split|\s+among|$)/i)
  const description = forMatch ? forMatch[1] : 'Expense'
  return { amount, description, category, paidBy, people: people.length > 0 ? people : ['Friend'], perPerson }
}

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

function showThinking(show) {
  document.getElementById('ai-thinking').classList.toggle('hidden', !show)
}

function showSuccessToast(description, amount, isGroup = false) {
  const toast = document.createElement('div')
  toast.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:white;padding:12px 24px;border-radius:24px;font-size:14px;z-index:9999;font-weight:500;white-space:nowrap;`
  toast.textContent = isGroup ? `✅ Group "${description}" created!` : `✅ Saved: ${description} · ₹${Number(amount).toLocaleString('en-IN')}`
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}

function getTimeAgo(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
