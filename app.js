// ─────────────────────────────────────────────
// STEP 1: PASTE YOUR SUPABASE DETAILS BELOW
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://atfivtjagvavbzfabpez.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0Zml2dGphZ3ZhdmJ6ZmFicGV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDA4NjksImV4cCI6MjA5ODIxNjg2OX0.xtC_PTi13XL4fJoeDKRcX2nBQj_xh3HldVFvGrovqs8'
// ─────────────────────────────────────────────

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Page routing ──────────────────────────────

function showLanding() {
  document.getElementById('landing-page').classList.remove('hidden')
  document.getElementById('dashboard-page').classList.add('hidden')
}

function showDashboard(userName) {
  document.getElementById('landing-page').classList.add('hidden')
  document.getElementById('dashboard-page').classList.remove('hidden')
  document.getElementById('user-greeting').textContent = 'Hi, ' + (userName || 'there') + ' 👋'
}

// ── Check if user is already logged in on page load ──

window.addEventListener('load', async () => {
  const { data } = await db.auth.getSession()
  if (data.session) {
    const name = data.session.user.user_metadata?.name || ''
    showDashboard(name)
  } else {
    showLanding()
  }
})

// Listen for auth changes (login/logout events)
db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    const name = session.user.user_metadata?.name || ''
    closeModal()
    showDashboard(name)
  }
  if (event === 'SIGNED_OUT') {
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

function closeModalOnOverlay(event) {
  if (event.target === document.getElementById('auth-modal')) {
    closeModal()
  }
}

function clearErrors() {
  const loginErr = document.getElementById('login-error')
  const signupErr = document.getElementById('signup-error')
  loginErr.classList.add('hidden')
  loginErr.textContent = ''
  signupErr.classList.add('hidden')
  signupErr.textContent = ''
}

function showError(id, message) {
  const el = document.getElementById(id)
  el.textContent = message
  el.classList.remove('hidden')
}

// ── Login ─────────────────────────────────────

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value

  if (!email || !password) {
    showError('login-error', 'Please fill in both fields.')
    return
  }

  const loginBtn = document.querySelector('#form-login .btn-full')
  loginBtn.textContent = 'Logging in...'
  loginBtn.disabled = true

  const { error } = await db.auth.signInWithPassword({ email, password })

  loginBtn.textContent = 'Log in'
  loginBtn.disabled = false

  if (error) {
    showError('login-error', 'Wrong email or password. Try again.')
  }
  // on success, onAuthStateChange handles the redirect
}

// ── Signup ────────────────────────────────────

async function handleSignup() {
  const name = document.getElementById('signup-name').value.trim()
  const email = document.getElementById('signup-email').value.trim()
  const password = document.getElementById('signup-password').value

  if (!name || !email || !password) {
    showError('signup-error', 'Please fill in all fields.')
    return
  }

  if (password.length < 6) {
    showError('signup-error', 'Password must be at least 6 characters.')
    return
  }

  const signupBtn = document.querySelector('#form-signup .btn-full')
  signupBtn.textContent = 'Creating account...'
  signupBtn.disabled = true

  const { error } = await db.auth.signUp({
    email,
    password,
    options: { data: { name } }
  })

  signupBtn.textContent = 'Create account'
  signupBtn.disabled = false

  if (error) {
    showError('signup-error', error.message || 'Something went wrong. Try again.')
  } else {
    showError('signup-error', '✅ Check your email to confirm your account, then log in.')
    document.getElementById('signup-error').style.background = '#EAF3DE'
    document.getElementById('signup-error').style.color = '#27500A'
  }
}

// ── Logout ────────────────────────────────────

async function handleLogout() {
  await db.auth.signOut()
}

// ── Demo parser (landing page, no AI needed) ──
// This is a simple local parser just for the demo.
// In Phase 2 we replace this with real Gemini AI.

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

  // Extract amount — looks for ₹ or Rs or a plain number
  let amount = 0
  const amountMatch = text.match(/[₹Rs\s]*(\d[\d,]*)/i)
  if (amountMatch) {
    amount = parseInt(amountMatch[1].replace(/,/g, ''))
  }
  if (amount === 0) amount = 500 // fallback

  // Extract names — simple: capitalised words that aren't "I", "Paid", "For", "With", "And", "Split"
  const skipWords = new Set(['i', 'paid', 'for', 'with', 'and', 'split', 'me', 'my', 'the', 'a', 'an', 'rs', 'equally', 'among'])
  const words = text.split(/[\s,]+/)
  const names = words.filter(w => {
    if (!w) return false
    const lower = w.toLowerCase().replace(/[^a-z]/g, '')
    return w[0] === w[0].toUpperCase() && w[0].match(/[A-Z]/) && !skipWords.has(lower) && isNaN(w)
  })

  // Detect who paid
  let paidBy = 'You'
  if (lower.includes('i paid') || lower.includes('i have paid') || lower.startsWith('paid')) {
    paidBy = 'You'
  } else {
    const paidMatch = text.match(/(\w+)\s+paid/i)
    if (paidMatch && !skipWords.has(paidMatch[1].toLowerCase())) {
      paidBy = paidMatch[1]
    }
  }

  // Detect category
  let category = '🧾 General'
  if (lower.match(/dinner|lunch|breakfast|food|restaurant|eat|snack|pizza|biryani/)) category = '🍽️ Food'
  else if (lower.match(/cab|uber|ola|taxi|auto|bus|train|flight|travel|petrol/)) category = '🚗 Travel'
  else if (lower.match(/hotel|stay|room|accommodation|airbnb|hostel/)) category = '🏨 Accommodation'
  else if (lower.match(/movie|concert|party|club|drink|bar|netflix|ticket/)) category = '🎉 Entertainment'
  else if (lower.match(/grocery|milk|vegetables|mart|supermarket/)) category = '🛒 Groceries'

  // Build people list (exclude the payer)
  const people = names.filter(n => n !== paidBy)
  const totalPeople = people.length + (paidBy === 'You' ? 1 : 0)
  const perPerson = totalPeople > 0 ? Math.round(amount / totalPeople) : amount

  // Detect description
  const forMatch = text.match(/for\s+(.+?)(?:\s+with|\s+split|\s+among|$)/i)
  const description = forMatch ? forMatch[1] : 'Expense'

  return { amount, description, category, paidBy, people: people.length > 0 ? people : ['Friend'], perPerson }
}
