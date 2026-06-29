// ═══════════════════════════════════════════════
// PASTE YOUR KEYS HERE — all 3 required
// ═══════════════════════════════════════════════
const SUPABASE_URL     = 'https://atfivtjagvavbzfabpez.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Zml2dGphZ3ZhdmJ6ZmFicGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDA4NjksImV4cCI6MjA5ODIxNjg2OX0.xtC_PTi13XL4fJoeDKRcX2nBQj_xh3HldVFvGrovqs8'
const GEMINI_API_KEY   = 'AQ.Ab8RN6KiT3G7XrZvo4zNJ7d-7o6ilMmOAipIScKwatK4RGryGw'
// ═══════════════════════════════════════════════

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── State ─────────────────────────────────────
let currentUser = null
let isRecording = false
let mediaRecorder = null
let audioChunks = []
let expenses = [] // local list for the feed

// ── Page routing ──────────────────────────────

function showLanding() {
  document.getElementById('landing-page').classList.remove('hidden')
  document.getElementById('app-page').classList.add('hidden')
}

function showApp(user) {
  currentUser = user
  document.getElementById('landing-page').classList.add('hidden')
  document.getElementById('app-page').classList.remove('hidden')
  const name = user.user_metadata?.name || user.email.split('@')[0]
  document.getElementById('user-greeting').textContent = 'Hi, ' + name + ' 👋'
  loadExpenses()
}

// ── Auth check on load ────────────────────────

window.addEventListener('load', async () => {
  const { data } = await db.auth.getSession()
  if (data.session) {
    showApp(data.session.user)
  } else {
    showLanding()
  }
})

db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    closeModal()
    showApp(session.user)
  }
  if (event === 'SIGNED_OUT') {
    currentUser = null
    showLanding()
  }
})

// ── Modal controls ────────────────────────────

function showModal(type) {
  document.getElementById('auth-modal').classList.remove('hidden')
  if (type === 'login') {
    document.getElementById('form-login').classList.remove('hidden')
    document.getElementById('form-signup').classList.add('hidden')
  } else {
    document.getElementById('form-signup').classList.remove('hidden')
    document.getElementById('form-login').classList.add('hidden')
  }
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
    el.classList.add('hidden')
    el.textContent = ''
    el.style.background = ''
    el.style.color = ''
  })
}

function showError(id, msg, isSuccess = false) {
  const el = document.getElementById(id)
  el.textContent = msg
  el.classList.remove('hidden')
  if (isSuccess) { el.style.background = '#EAF3DE'; el.style.color = '#27500A' }
}

// ── Login ─────────────────────────────────────

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { showError('login-error', 'Please fill in both fields.'); return }

  const btn = document.querySelector('#form-login .btn-full')
  btn.textContent = 'Logging in...'; btn.disabled = true

  const { error } = await db.auth.signInWithPassword({ email, password })
  btn.textContent = 'Log in'; btn.disabled = false

  if (error) showError('login-error', 'Wrong email or password. Try again.')
}

// ── Signup ────────────────────────────────────

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

// ── Logout ────────────────────────────────────

async function handleLogout() {
  await db.auth.signOut()
}

// ── Tab switching ─────────────────────────────

function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'))
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('tab-' + name).classList.remove('hidden')
  event.target.classList.add('active')
}

// ── Voice recording ───────────────────────────

async function toggleRecording() {
  if (!isRecording) {
    startRecording()
  } else {
    stopRecording()
  }
}

async function startRecording() {
  // Ask for microphone permission
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunks = []
    mediaRecorder = new MediaRecorder(stream)

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
      stream.getTracks().forEach(t => t.stop()) // stop mic
      await transcribeAndParse(audioBlob)
    }

    mediaRecorder.start()
    isRecording = true

    // Update UI
    document.getElementById('mic-button').classList.add('recording')
    document.getElementById('mic-icon').textContent = '⏹️'
    document.getElementById('recording-status').classList.remove('hidden')

  } catch (err) {
    alert('Microphone access denied. Please allow microphone access in your browser and try again.')
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop()
    isRecording = false

    // Update UI
    document.getElementById('mic-button').classList.remove('recording')
    document.getElementById('mic-icon').textContent = '🎙️'
    document.getElementById('recording-status').classList.add('hidden')
  }
}

// ── Transcribe audio with Gemini ──────────────

async function transcribeAndParse(audioBlob) {
  showThinking(true)

  try {
    // Convert audio blob to base64
    const base64Audio = await blobToBase64(audioBlob)
    const base64Data = base64Audio.split(',')[1]

    // Send to Gemini for transcription + parsing in one shot
    const prompt = `You are an expense parsing AI for an app called Spliq.
The user has recorded a voice note logging an expense.
Listen to the audio and extract the expense details.
Also note: "I paid" and "paid" mean the same thing — the current user paid.

Return ONLY a JSON object with these exact fields (no other text):
{
  "transcript": "what the user said",
  "amount": 500,
  "description": "dinner",
  "category": "🍽️ Food",
  "paidBy": "You",
  "people": ["Rahul", "Ananya"],
  "type": "personal",
  "groupName": ""
}

Category must be one of: 🍽️ Food, 🚗 Travel, 🏨 Accommodation, 🎉 Entertainment, 🛒 Groceries, 💡 Utilities, 🧾 General
Type must be "personal" if just 1-2 people, "group" if a named group or 3+ people
paidBy should be "You" if the user said "I paid" or "paid"
people should list everyone EXCEPT the payer`

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'audio/webm', data: base64Data } }
            ]
          }]
        })
      }
    )

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const parsed = extractJSON(text)

    showThinking(false)
    if (parsed) showConfirmCard(parsed)
    else alert('Could not understand the audio. Please try again or type it instead.')

  } catch (err) {
    showThinking(false)
    console.error(err)
    alert('Something went wrong. Please try typing the expense instead.')
  }
}

// ── Parse text input with Gemini ──────────────

async function parseExpenseFromText() {
  const input = document.getElementById('expense-input').value.trim()
  if (!input) return

  showThinking(true)

  try {
    const prompt = `You are an expense parsing AI for an app called Spliq.
The user typed: "${input}"
Note: "I paid" and "paid" mean exactly the same thing — the current user paid.

Return ONLY a JSON object with these exact fields (no other text, no markdown):
{
  "transcript": "${input}",
  "amount": 500,
  "description": "dinner",
  "category": "🍽️ Food",
  "paidBy": "You",
  "people": ["Rahul", "Ananya"],
  "type": "personal",
  "groupName": ""
}

Category must be one of: 🍽️ Food, 🚗 Travel, 🏨 Accommodation, 🎉 Entertainment, 🛒 Groceries, 💡 Utilities, 🧾 General
Type is "personal" if 1-2 people involved, "group" if 3+ people or a group name is mentioned
paidBy is "You" if user said "I paid" or just "paid"
people lists everyone who owes money (not the payer)
groupName is the group name if mentioned, otherwise empty string`

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    )

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const parsed = extractJSON(text)

    showThinking(false)
    if (parsed) {
      showConfirmCard(parsed)
      document.getElementById('expense-input').value = ''
    } else {
      alert('Could not parse that. Try being more specific, e.g. "Paid ₹500 for dinner with Rahul"')
    }

  } catch (err) {
    showThinking(false)
    console.error(err)
    alert('Something went wrong. Check your Gemini API key.')
  }
}

// ── Show / hide confirm card ──────────────────

function showConfirmCard(parsed) {
  // Fill in all the editable fields
  document.getElementById('confirm-original').textContent = '"' + parsed.transcript + '"'
  document.getElementById('edit-amount').value = parsed.amount || ''
  document.getElementById('edit-description').value = parsed.description || ''
  document.getElementById('edit-paidby').value = parsed.paidBy || 'You'
  document.getElementById('edit-people').value = (parsed.people || []).join(', ')
  document.getElementById('edit-type').value = parsed.type || 'personal'
  document.getElementById('edit-group').value = parsed.groupName || ''

  // Set category dropdown
  const catSelect = document.getElementById('edit-category')
  for (let opt of catSelect.options) {
    if (opt.value === parsed.category) { opt.selected = true; break }
  }

  // Show/hide group name field
  toggleGroupField()

  // Show split chips
  const splitDiv = document.getElementById('confirm-split')
  const people = parsed.people || []
  const total = people.length + 1
  const perPerson = total > 0 ? Math.round((parsed.amount || 0) / total) : 0

  splitDiv.innerHTML = `
    <span class="split-chip payer">${parsed.paidBy || 'You'} paid ₹${(parsed.amount || 0).toLocaleString('en-IN')}</span>
    ${people.map(p => `<span class="split-chip">${p} owes ₹${perPerson.toLocaleString('en-IN')}</span>`).join('')}
  `

  document.getElementById('confirm-card').classList.remove('hidden')
}

function toggleGroupField() {
  const type = document.getElementById('edit-type').value
  document.getElementById('group-name-field').style.display = type === 'group' ? 'block' : 'none'
}

// Add event listener for type dropdown
document.addEventListener('DOMContentLoaded', () => {
  const typeSelect = document.getElementById('edit-type')
  if (typeSelect) typeSelect.addEventListener('change', toggleGroupField)
})

function cancelConfirm() {
  document.getElementById('confirm-card').classList.add('hidden')
}

// ── Confirm and save expense ──────────────────

async function confirmExpense() {
  const amount = parseFloat(document.getElementById('edit-amount').value)
  const description = document.getElementById('edit-description').value.trim()
  const category = document.getElementById('edit-category').value
  const paidBy = document.getElementById('edit-paidby').value.trim()
  const peopleRaw = document.getElementById('edit-people').value.trim()
  const people = peopleRaw ? peopleRaw.split(',').map(p => p.trim()).filter(Boolean) : []
  const type = document.getElementById('edit-type').value
  const groupName = document.getElementById('edit-group').value.trim()

  if (!amount || !description) {
    alert('Please fill in at least the amount and description.')
    return
  }

  const expense = {
    id: Date.now(),
    amount,
    description,
    category,
    paidBy,
    people,
    type,
    groupName: type === 'group' ? groupName : '',
    timestamp: new Date().toISOString(),
    userId: currentUser?.id
  }

  // Save to local list and update feed
  expenses.unshift(expense)
  saveExpensesLocally()
  renderFeed()

  // Hide confirm card
  document.getElementById('confirm-card').classList.add('hidden')

  // Show quick success message
  showSuccessToast(description, amount)
}

// ── Local storage for expenses ────────────────
// (Phase 3 will move this to Supabase database)

function saveExpensesLocally() {
  if (!currentUser) return
  localStorage.setItem('spliq_expenses_' + currentUser.id, JSON.stringify(expenses))
}

function loadExpenses() {
  if (!currentUser) return
  const saved = localStorage.getItem('spliq_expenses_' + currentUser.id)
  expenses = saved ? JSON.parse(saved) : []
  renderFeed()
}

function renderFeed() {
  const feed = document.getElementById('expense-feed')
  if (expenses.length === 0) {
    feed.innerHTML = '<div class="feed-empty">No expenses yet. Tap the mic to log your first one!</div>'
    return
  }

  feed.innerHTML = expenses.slice(0, 10).map(e => {
    const timeAgo = getTimeAgo(e.timestamp)
    const peopleText = e.people.length > 0 ? `with ${e.people.join(', ')}` : ''
    const typeTag = e.type === 'group'
      ? `<span class="tag tag-group">👥 ${e.groupName || 'Group'}</span>`
      : `<span class="tag tag-personal">👤 Personal</span>`

    return `
      <div class="expense-item">
        <div class="expense-item-top">
          <div class="expense-item-desc">${e.description}</div>
          <div class="expense-item-amount">₹${e.amount.toLocaleString('en-IN')}</div>
        </div>
        <div class="expense-item-sub">${e.paidBy} paid ${peopleText} · ${timeAgo}</div>
        <div class="expense-item-tags">
          <span class="tag tag-cat">${e.category}</span>
          ${typeTag}
        </div>
      </div>
    `
  }).join('')
}

// ── Landing page demo (no AI, just local parse) ──

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

// ── Helpers ───────────────────────────────────

function showThinking(show) {
  document.getElementById('ai-thinking').classList.toggle('hidden', !show)
}

function showSuccessToast(description, amount) {
  const toast = document.createElement('div')
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #111; color: white; padding: 12px 24px; border-radius: 24px;
    font-size: 14px; z-index: 9999; font-weight: 500;
  `
  toast.textContent = `✅ Saved: ${description} · ₹${amount.toLocaleString('en-IN')}`
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

function extractJSON(text) {
  try {
    // Try direct parse first
    return JSON.parse(text)
  } catch {
    // Extract JSON from markdown code block if wrapped
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try { return JSON.parse(match[0]) } catch { return null }
    }
    return null
  }
}
