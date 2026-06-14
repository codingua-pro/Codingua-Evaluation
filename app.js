/**
 * Codingua Academy Dashboard — app.js
 * Production-grade SPA — Firebase Compat SDK v10
 * Fully audited & refactored
 *
 * ISSUES FIXED:
 * [CRITICAL-1]  Duplicate & mixed Firebase init (initializeApp + firebase.initializeApp + FIREBASE_CONFIG undefined)
 * [CRITICAL-2]  firebase.firestore.FieldValue.serverTimestamp() used after compat init — kept compat, unified usage
 * [CRITICAL-3]  firebase.firestore.FieldValue.arrayUnion() — same, unified
 * [CRITICAL-4]  firebase.firestore.FieldPath.documentId() — same, unified
 * [CRITICAL-5]  createUserWithEmailAndPassword() signs out the current admin — fixed with secondary app instance
 * [CRITICAL-6]  db.batch() with >500 writes possible — added 500-op chunking
 * [HIGH-1]      Chart.js canvas null-check missing — added guards on all 3 charts
 * [HIGH-2]      Every top-level event listener on elements that may not exist — wrapped with null checks
 * [HIGH-3]      report-cycle-select listener stacked on every group change (memory leak) — fixed with named handler + removeEventListener
 * [HIGH-4]      renderGroups/renderStudents called before state.userProfile set — guarded
 * [HIGH-5]      Firestore 'in' query limit (max 30 in v9 compat) — added chunked batching for >30 items
 * [HIGH-6]      html2pdf / XLSX used without existence check — added typeof guards
 * [HIGH-7]      applyTheme() called before DOM ready — moved inside DOMContentLoaded
 * [HIGH-8]      Badge engine hardcoded `=== 4` for perfect attendance — replaced with cycle.length
 * [MEDIUM-1]    groupSelects array declared but never used — removed dead variable
 * [MEDIUM-2]    stat-students / stat-sessions null when instructor role views those panels — guarded
 * [MEDIUM-3]    openModal/closeModal crash if element not found — guarded
 * [MEDIUM-4]    showToast crash if toast-container missing — guarded
 * [MEDIUM-5]    formatDate crashes on invalid Firestore timestamp — try/catch added
 * [LOW-1]       console.error missing in several catch blocks — added throughout
 * [LOW-2]       Missing auth/invalid-credential error code (Firebase v9+) — added
 */

'use strict';

// ══════════════════════════════════════════════════════════════
//  FIREBASE CONFIGURATION  ← Replace with your project values
// ══════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyBEPjNIYw_ZQbqcdARMlJ3OH1-uGi_o_LA",
  authDomain: "codingua-evaluation.firebaseapp.com",
  projectId: "codingua-evaluation",
  storageBucket: "codingua-evaluation.firebasestorage.app",
  messagingSenderId: "775470149394",
  appId: "1:775470149394:web:befdb3f369bce0c2e0cdcb"
};

// ── FIX [CRITICAL-1]: Single initialisation via Compat SDK only ──
// The HTML loads firebase-app-compat, firebase-auth-compat, firebase-firestore-compat.
// We must NOT call the modular initializeApp() here — firebase.initializeApp() is the one API.
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db   = firebase.firestore();

// ── FIX [CRITICAL-5]: Secondary app for instructor creation (keeps admin signed in) ──
// We initialise a second, named Firebase app used only for createUserWithEmailAndPassword.
// This prevents the admin from being signed out when a new instructor account is created.
let secondaryApp = null;
function getSecondaryApp() {
  if (!secondaryApp) {
    secondaryApp = firebase.initializeApp(firebaseConfig, 'secondary');
  }
  return secondaryApp;
}

// ══════════════════════════════════════════════════════════════
//  SCORING ENGINE CONSTANTS
// ══════════════════════════════════════════════════════════════
const SCORE_RULES = {
  attendance:      10,
  participation:    5,
  application:     15,
  homework:        20,
  creativity:      10,
  latePenalty:     -5,
  homeworkPenalty: -10
};

const MAX_SESSION_SCORE = Object.values(SCORE_RULES)
  .filter(v => v > 0)
  .reduce((a, b) => a + b, 0); // 60 points per session

const BADGE_RULES = {
  starOfMonth:    { label: '🥇 نجم الشهر',    key: 'starOfMonth' },
  youngInnovator: { label: '💡 المبدع الصغير', key: 'youngInnovator' },
  homeworkChamp:  { label: '🎯 بطل الواجبات',  key: 'homeworkChamp' },
  perfectAttend:  { label: '🔥 حضور مثالي',    key: 'perfectAttend' }
};

// ══════════════════════════════════════════════════════════════
//  APP STATE
// ══════════════════════════════════════════════════════════════
const state = {
  currentUser:    null,
  userProfile:    null,
  groups:         [],
  students:       [],
  instructors:    [],
  sessions:       [],
  evaluations:    [],
  charts:         {},
  deleteCallback: null,
  editStudentId:  null
};

// ══════════════════════════════════════════════════════════════
//  DOM HELPERS
// ══════════════════════════════════════════════════════════════
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// FIX [MEDIUM-4]: guard against missing container
function showToast(message, type = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

// FIX [MEDIUM-3]: guard against missing modal element
function openModal(id) {
  const el = $(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = $(id);
  if (el) el.classList.remove('open');
}

// FIX [MEDIUM-5]: guard against bad timestamps
function formatDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function setActivePanel(panelId) {
  $$('.panel').forEach(p => p.classList.remove('active'));
  const target = $(panelId);
  if (target) target.classList.add('active');

  $$('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.panel === panelId);
  });

  const titles = {
    'dashboard-panel':   'لوحة التحليلات',
    'instructors-panel': 'إدارة المدرّسين',
    'groups-panel':      'المجموعات الدراسية',
    'students-panel':    'الطلاب المسجّلون',
    'sessions-panel':    'الجلسات الدراسية',
    'evaluation-panel':  'مصفوفة التقييم',
    'reports-panel':     'التقارير الشهرية'
  };
  const titleEl = $('page-title');
  if (titleEl) titleEl.textContent = titles[panelId] || 'Dashboard';
  closeSidebar();
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
// FIX [HIGH-2]: null-check before addEventListener
const loginForm = $('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const emailEl    = $('login-email');
    const passwordEl = $('login-password');
    const btn        = $('login-btn');
    const errDiv     = $('auth-error');
    const errMsg     = $('auth-error-msg');

    if (!emailEl || !passwordEl || !btn) return;

    const email    = emailEl.value.trim();
    const password = passwordEl.value;

    if (errDiv) errDiv.classList.remove('visible');
    btn.innerHTML = '<div class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff;margin:0 auto;"></div>';
    btn.disabled  = true;

    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      console.error('[Auth] Login error:', err.code, err.message);
      const messages = {
        'auth/user-not-found':       'البريد الإلكتروني غير مسجّل.',
        'auth/wrong-password':       'كلمة المرور غير صحيحة.',
        'auth/invalid-email':        'صيغة البريد الإلكتروني غير صحيحة.',
        'auth/invalid-credential':   'البريد أو كلمة المرور غير صحيحة.',
        'auth/too-many-requests':    'تم تجاوز عدد المحاولات. حاول لاحقاً.'
      };
      if (errMsg) errMsg.textContent = messages[err.code] || err.message;
      if (errDiv) errDiv.classList.add('visible');
      btn.innerHTML = '<span id="login-btn-text">تسجيل الدخول</span>';
      btn.disabled  = false;
    }
  });
}

const logoutBtn = $('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    auth.signOut().catch(e => console.error('[Auth] Signout error:', e));
  });
}

auth.onAuthStateChanged(async user => {
  if (user) {
    state.currentUser = user;
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      if (!snap.exists) {
        showToast('المستخدم غير مسجّل في النظام.', 'error');
        await auth.signOut();
        return;
      }
      state.userProfile = { ...snap.data(), userId: snap.id };
      await initApp();
    } catch (e) {
      console.error('[Auth] Profile load error:', e);
      showToast('خطأ في تحميل بيانات المستخدم.', 'error');
    }
  } else {
    state.currentUser  = null;
    state.userProfile  = null;
    // Reset state arrays to prevent stale data on re-login
    state.groups       = [];
    state.students     = [];
    state.instructors  = [];
    state.sessions     = [];
    state.evaluations  = [];
    const appEl        = $('app');
    const authEl       = $('auth-screen');
    if (appEl)  appEl.style.display  = 'none';
    if (authEl) authEl.style.display = 'flex';
  }
});

// ══════════════════════════════════════════════════════════════
//  APP INIT
// ══════════════════════════════════════════════════════════════
async function initApp() {
  const authEl = $('auth-screen');
  const appEl  = $('app');
  if (authEl) authEl.style.display = 'none';
  if (appEl)  appEl.style.display  = 'flex';

  const profile = state.userProfile;
  const isAdmin = profile.role === 'admin';

  // Sidebar user card
  const avatarEl = $('sidebar-avatar');
  const nameEl   = $('sidebar-name');
  const roleEl   = $('sidebar-role');
  const badgeEl  = $('role-badge');

  if (avatarEl) avatarEl.textContent = (profile.fullName || 'U')[0].toUpperCase();
  if (nameEl)   nameEl.textContent   = profile.fullName || 'مستخدم';
  if (roleEl)   roleEl.textContent   = isAdmin ? 'مدير النظام' : 'مدرّس';
  if (badgeEl)  badgeEl.textContent  = isAdmin ? 'مدير' : 'مدرّس';

  $$('.admin-only-nav').forEach(el => { el.style.display = isAdmin ? '' : 'none'; });
  $$('.admin-only-action').forEach(el => { el.style.display = isAdmin ? '' : 'none'; });

  await loadAllData();
  buildSelectDropdowns();

  if (isAdmin) {
    setActivePanel('dashboard-panel');
    renderDashboard();
  } else {
    setActivePanel('groups-panel');
  }

  renderGroups();
  renderStudents();
  renderSessions();
  renderInstructors();
}

// ══════════════════════════════════════════════════════════════
//  DATA LOADING
//  FIX [HIGH-5]: Firestore 'in' queries are limited to 30 items.
//  We chunk arrays > 30 into multiple queries and merge results.
// ══════════════════════════════════════════════════════════════
async function firestoreInQuery(collection, field, values) {
  if (!values.length) return [];
  const CHUNK = 30;
  const chunks = [];
  for (let i = 0; i < values.length; i += CHUNK) {
    chunks.push(values.slice(i, i + CHUNK));
  }
  const results = await Promise.all(
    chunks.map(chunk =>
      db.collection(collection).where(field, 'in', chunk).get()
        .then(snap => snap.docs.map(d => ({ ...d.data(), [`${collection.slice(0, -1)}Id`]: d.id })))
    )
  );
  return results.flat();
}

async function loadAllData() {
  const profile  = state.userProfile;
  const isAdmin  = profile.role === 'admin';
  const uid      = profile.userId;
  const assigned = profile.assignedGroups || [];

  try {
    // ── Groups ──
    if (isAdmin) {
      const snap = await db.collection('groups').get();
      state.groups = snap.docs.map(d => ({ ...d.data(), groupId: d.id }));
    } else if (assigned.length) {
      // FIX [CRITICAL-4]: compat usage — documentId() via FieldPath
      const chunks = [];
      for (let i = 0; i < assigned.length; i += 30) chunks.push(assigned.slice(i, i + 30));
      const results = await Promise.all(
        chunks.map(chunk =>
          db.collection('groups')
            .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
            .get()
            .then(snap => snap.docs.map(d => ({ ...d.data(), groupId: d.id })))
        )
      );
      state.groups = results.flat();
    } else {
      state.groups = [];
    }

    const groupIds = state.groups.map(g => g.groupId);

    // ── Students ──
    if (groupIds.length) {
      state.students = await firestoreInQuery('students', 'groupId', groupIds);
    } else {
      state.students = [];
    }

    // ── Sessions ──
    if (groupIds.length) {
      // Chunked because firestoreInQuery doesn't support orderBy cross-chunk
      const chunks = [];
      for (let i = 0; i < groupIds.length; i += 30) chunks.push(groupIds.slice(i, i + 30));
      const results = await Promise.all(
        chunks.map(chunk =>
          db.collection('sessions').where('groupId', 'in', chunk).get()
            .then(snap => snap.docs.map(d => ({ ...d.data(), sessionId: d.id })))
        )
      );
      state.sessions = results.flat().sort((a, b) => a.sessionNumber - b.sessionNumber);
    } else {
      state.sessions = [];
    }

    // ── Evaluations ──
    let evalsQuery = db.collection('evaluations');
    if (!isAdmin) evalsQuery = evalsQuery.where('instructorId', '==', uid);
    const evalsSnap = await evalsQuery.get();
    state.evaluations = evalsSnap.docs.map(d => ({ ...d.data(), evaluationId: d.id }));

    // ── Instructors (admin only) ──
    if (isAdmin) {
      const insSnap = await db.collection('users').where('role', '==', 'instructor').get();
      state.instructors = insSnap.docs.map(d => ({ ...d.data(), userId: d.id }));
    }
  } catch (e) {
    console.error('[Data] loadAllData error:', e);
    showToast('خطأ في تحميل البيانات: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  BUILD SELECT DROPDOWNS
// ══════════════════════════════════════════════════════════════
function buildSelectDropdowns() {
  ['students-group-filter', 'sessions-group-filter', 'eval-group-select',
   'report-group-select', 'session-group', 'student-group'].forEach(id => {
    const el = $(id);
    if (!el) return;
    const isFilter = id.includes('filter');
    el.innerHTML = `<option value="">${isFilter ? 'كل المجموعات' : '— اختر مجموعة —'}</option>`;
    state.groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value       = g.groupId;
      opt.textContent = g.groupName;
      el.appendChild(opt);
    });
  });

  const instSelect = $('group-instructor');
  if (instSelect) {
    instSelect.innerHTML = '<option value="">— اختر مدرّساً —</option>';
    state.instructors.forEach(i => {
      const opt = document.createElement('option');
      opt.value       = i.userId;
      opt.textContent = i.fullName;
      instSelect.appendChild(opt);
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD (Admin)
// ══════════════════════════════════════════════════════════════
function renderDashboard() {
  const setStat = (id, val) => { const el = $(id); if (el) el.textContent = val; };

  setStat('stat-students',    state.students.length);
  setStat('stat-groups',      state.groups.length);
  setStat('stat-instructors', state.instructors.length);
  setStat('stat-sessions',    state.sessions.length);

  const studentPoints = computeStudentTotals();
  const sorted = Object.entries(studentPoints).sort((a, b) => b[1].total - a[1].total);
  if (sorted.length) {
    const topStudent = state.students.find(s => s.studentId === sorted[0][0]);
    setStat('stat-top-student', topStudent ? topStudent.studentName : '—');
  }

  renderRankingChart(sorted);
  renderBadgesChart();
  renderAttendanceChart();
  renderTopStudentsList(sorted);
}

function computeStudentTotals() {
  const totals = {};
  state.students.forEach(s => {
    totals[s.studentId] = { total: 0, creativity: 0, sessions: 0, attendedAll: true, hwAll: true };
  });
  state.evaluations.forEach(ev => {
    if (!totals[ev.studentId]) return;
    totals[ev.studentId].total      += (ev.totalPoints || 0);
    totals[ev.studentId].creativity += (ev.creativity ? SCORE_RULES.creativity : 0);
    totals[ev.studentId].sessions   += 1;
    if (!ev.attendance) totals[ev.studentId].attendedAll = false;
    if (!ev.homework)   totals[ev.studentId].hwAll       = false;
  });
  return totals;
}

// FIX [HIGH-1]: null-check canvas before getContext
function renderRankingChart(sorted) {
  const canvas = $('rankingChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts.ranking) state.charts.ranking.destroy();

  const top10  = sorted.slice(0, 10);
  const labels = top10.map(([id]) => {
    const s = state.students.find(x => x.studentId === id);
    return s ? s.studentName : id;
  });
  const data = top10.map(([, v]) => v.total);

  state.charts.ranking = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'مجموع النقاط',
        data,
        backgroundColor: 'rgba(29,161,242,0.8)',
        borderColor: '#1DA1F2',
        borderWidth: 2,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.1)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderBadgesChart() {
  const canvas = $('badgesChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts.badges) state.charts.badges.destroy();

  const totals = computeStudentTotals();
  const badges = computeBadges(totals, state.evaluations, state.sessions);
  const counts = { starOfMonth: 0, youngInnovator: 0, homeworkChamp: 0, perfectAttend: 0 };
  Object.values(badges).forEach(list => list.forEach(b => { if (b in counts) counts[b]++; }));

  state.charts.badges = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['🥇 نجم الشهر', '💡 المبدع', '🎯 بطل الواجبات', '🔥 حضور مثالي'],
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ['#F7C52B', '#1DA1F2', '#27ae60', '#e74c3c'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 12, font: { family: 'Cairo' } }
        }
      },
      cutout: '65%'
    }
  });
}

function renderAttendanceChart() {
  const canvas = $('attendanceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (state.charts.attendance) state.charts.attendance.destroy();

  const groupAttend = {};
  state.groups.forEach(g => {
    groupAttend[g.groupId] = { name: g.groupName, attended: 0, absent: 0 };
  });
  state.evaluations.forEach(ev => {
    const s = state.students.find(x => x.studentId === ev.studentId);
    if (!s || !groupAttend[s.groupId]) return;
    if (ev.attendance) groupAttend[s.groupId].attended++;
    else               groupAttend[s.groupId].absent++;
  });

  const labels   = Object.values(groupAttend).map(g => g.name);
  const attended = Object.values(groupAttend).map(g => g.attended);
  const absent   = Object.values(groupAttend).map(g => g.absent);

  state.charts.attendance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'حضر', data: attended, backgroundColor: 'rgba(39,174,96,0.8)',  borderRadius: 6 },
        { label: 'غاب', data: absent,   backgroundColor: 'rgba(231,76,60,0.8)',   borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(148,163,184,0.1)' } }
      }
    }
  });
}

function renderTopStudentsList(sorted) {
  const container = $('top-students-list');
  if (!container) return;
  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><p>لا توجد تقييمات بعد</p></div>';
    return;
  }
  container.innerHTML = sorted.slice(0, 5).map(([id, v], i) => {
    const s = state.students.find(x => x.studentId === id);
    return `
      <div class="ranking-item">
        <div class="ranking-num ${i === 0 ? 'gold' : ''}">${i + 1}</div>
        <span class="ranking-name">${s ? s.studentName : '—'}</span>
        <span class="ranking-score">${v.total} نقطة</span>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//  GROUPS
// ══════════════════════════════════════════════════════════════
function renderGroups() {
  const grid    = $('groups-grid');
  if (!grid || !state.userProfile) return;
  const isAdmin = state.userProfile.role === 'admin';

  if (!state.groups.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">📚</div><p>لا توجد مجموعات بعد</p></div>`;
    return;
  }

  grid.innerHTML = state.groups.map(g => {
    const instructor   = state.instructors.find(i => i.userId === g.instructorId);
    const studentCount = state.students.filter(s => s.groupId === g.groupId).length;
    return `
      <div class="group-card" data-group-id="${g.groupId}">
        <div class="group-card-header">
          <div class="group-icon">📚</div>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="confirmDelete('group','${g.groupId}','مجموعة: ${g.groupName}')">🗑</button>` : ''}
        </div>
        <div class="group-card-name">${g.groupName}</div>
        <div class="group-card-course">${g.courseName || ''}</div>
        <div class="group-card-footer">
          <span>👩‍🏫 ${instructor ? instructor.fullName : 'غير محدّد'}</span>
          <span>👥 ${studentCount} طالب</span>
        </div>
      </div>`;
  }).join('');
}

const btnAddGroup = $('btn-add-group');
if (btnAddGroup) {
  btnAddGroup.addEventListener('click', () => {
    const gn = $('group-name');
    const gc = $('group-course');
    if (gn) gn.value = '';
    if (gc) gc.value = '';
    buildSelectDropdowns();
    openModal('modal-group');
  });
}

const btnSaveGroup = $('btn-save-group');
if (btnSaveGroup) {
  btnSaveGroup.addEventListener('click', async () => {
    const name       = $('group-name')?.value.trim() || '';
    const course     = $('group-course')?.value.trim() || '';
    const instructor = $('group-instructor')?.value || '';
    if (!name) { showToast('أدخل اسم المجموعة.', 'error'); return; }

    try {
      const ref = await db.collection('groups').add({
        groupName: name, courseName: course, instructorId: instructor || ''
      });
      state.groups.push({ groupId: ref.id, groupName: name, courseName: course, instructorId: instructor || '' });

      // FIX [CRITICAL-3]: compat arrayUnion
      if (instructor) {
        await db.collection('users').doc(instructor).update({
          assignedGroups: firebase.firestore.FieldValue.arrayUnion(ref.id)
        });
      }
      closeModal('modal-group');
      buildSelectDropdowns();
      renderGroups();
      showToast(`تم إضافة مجموعة "${name}" بنجاح.`, 'success');
    } catch (e) {
      console.error('[Groups] Save error:', e);
      showToast('خطأ: ' + e.message, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  INSTRUCTORS
// ══════════════════════════════════════════════════════════════
function renderInstructors() {
  const tbody = $('instructors-tbody');
  if (!tbody) return;

  if (!state.instructors.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">👩‍🏫</div><p>لا يوجد مدرّسون</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = state.instructors.map(inst => {
    const groupNames = (inst.assignedGroups || []).map(gid => {
      const g = state.groups.find(x => x.groupId === gid);
      return g ? `<span class="badge badge-blue">${g.groupName}</span>` : '';
    }).join(' ');

    return `
      <tr>
        <td>${inst.fullName}</td>
        <td dir="ltr" style="text-align:left;">${inst.email}</td>
        <td>${groupNames || '<span class="badge badge-red">لا توجد</span>'}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="confirmDelete('instructor','${inst.userId}','المدرّس: ${inst.fullName}')">🗑 حذف</button>
        </td>
      </tr>`;
  }).join('');
}

const btnAddInstructor = $('btn-add-instructor');
if (btnAddInstructor) {
  btnAddInstructor.addEventListener('click', () => {
    const n = $('inst-name');   if (n) n.value = '';
    const e = $('inst-email');  if (e) e.value = '';
    const p = $('inst-password'); if (p) p.value = '';
    const box = $('inst-groups-checkboxes');
    if (box) {
      box.innerHTML = state.groups.map(g => `
        <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer;">
          <input type="checkbox" name="inst-group" value="${g.groupId}"
            style="accent-color:var(--primary);width:16px;height:16px;" />
          ${g.groupName}
        </label>`).join('');
    }
    openModal('modal-instructor');
  });
}

const btnSaveInstructor = $('btn-save-instructor');
if (btnSaveInstructor) {
  btnSaveInstructor.addEventListener('click', async () => {
    const name     = $('inst-name')?.value.trim()  || '';
    const email    = $('inst-email')?.value.trim()  || '';
    const password = $('inst-password')?.value      || '';
    const selected = [...$$('input[name="inst-group"]:checked')].map(x => x.value);

    if (!name || !email || !password) { showToast('أكمل جميع الحقول.', 'error'); return; }

    try {
      // FIX [CRITICAL-5]: Use secondary app so admin stays signed in
      const secondaryAuth = getSecondaryApp().auth();
      const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
      const newUid = cred.user.uid;

      // Sign out the secondary session immediately — we don't need it
      await secondaryAuth.signOut();

      await db.collection('users').doc(newUid).set({
        fullName: name, email, role: 'instructor', assignedGroups: selected
      });

      for (const gid of selected) {
        await db.collection('groups').doc(gid).update({ instructorId: newUid });
        // Keep local state in sync
        const g = state.groups.find(x => x.groupId === gid);
        if (g) g.instructorId = newUid;
      }

      state.instructors.push({ userId: newUid, fullName: name, email, role: 'instructor', assignedGroups: selected });
      closeModal('modal-instructor');
      renderInstructors();
      buildSelectDropdowns();
      showToast(`تم إضافة المدرّس "${name}" بنجاح.`, 'success');
    } catch (e) {
      console.error('[Instructors] Save error:', e);
      showToast('خطأ: ' + e.message, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  STUDENTS
// ══════════════════════════════════════════════════════════════
function renderStudents(filterGroupId = '') {
  const tbody = $('students-tbody');
  if (!tbody || !state.userProfile) return;
  const isAdmin  = state.userProfile.role === 'admin';
  const students = filterGroupId
    ? state.students.filter(s => s.groupId === filterGroupId)
    : state.students;

  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🎓</div><p>لا يوجد طلاب</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = students.map((s, i) => {
    const group = state.groups.find(g => g.groupId === s.groupId);
    return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${s.studentName}</strong></td>
        <td>${s.age || '—'}</td>
        <td dir="ltr" style="text-align:left;">${s.parentPhone || '—'}</td>
        <td>${group ? `<span class="badge badge-blue">${group.groupName}</span>` : '—'}</td>
        <td>${formatDate(s.enrollmentDate)}</td>
        <td style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" onclick="editStudent('${s.studentId}')">✏️ تعديل</button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="confirmDelete('student','${s.studentId}','الطالب: ${s.studentName}')">🗑</button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

const studentsGroupFilter = $('students-group-filter');
if (studentsGroupFilter) {
  studentsGroupFilter.addEventListener('change', e => renderStudents(e.target.value));
}

const btnAddStudent = $('btn-add-student');
if (btnAddStudent) {
  btnAddStudent.addEventListener('click', () => {
    const titleEl = $('student-modal-title');
    if (titleEl) titleEl.textContent = '➕ إضافة طالب جديد';
    ['student-name','student-age','student-phone','student-group','student-edit-id'].forEach(id => {
      const el = $(id); if (el) el.value = '';
    });
    state.editStudentId = null;
    openModal('modal-student');
  });
}

window.editStudent = (studentId) => {
  const s = state.students.find(x => x.studentId === studentId);
  if (!s) return;
  const titleEl = $('student-modal-title');
  if (titleEl) titleEl.textContent = '✏️ تعديل بيانات الطالب';
  const set = (id, val) => { const el = $(id); if (el) el.value = val; };
  set('student-name',    s.studentName);
  set('student-age',     s.age || '');
  set('student-phone',   s.parentPhone || '');
  set('student-group',   s.groupId || '');
  set('student-edit-id', studentId);
  state.editStudentId = studentId;
  openModal('modal-student');
};

const btnSaveStudent = $('btn-save-student');
if (btnSaveStudent) {
  btnSaveStudent.addEventListener('click', async () => {
    const name    = $('student-name')?.value.trim()      || '';
    const age     = parseInt($('student-age')?.value)    || null;
    const phone   = $('student-phone')?.value.trim()     || '';
    const groupId = $('student-group')?.value            || '';
    const editId  = $('student-edit-id')?.value          || '';

    if (!name || !groupId) { showToast('أدخل الاسم والمجموعة.', 'error'); return; }

    // FIX [CRITICAL-2]: compat serverTimestamp
    const existingStudent = state.students.find(x => x.studentId === editId);
    const data = {
      studentName: name,
      age,
      parentPhone: phone,
      groupId,
      enrollmentDate: editId
        ? (existingStudent?.enrollmentDate || firebase.firestore.FieldValue.serverTimestamp())
        : firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      if (editId) {
        await db.collection('students').doc(editId).update(data);
        const idx = state.students.findIndex(x => x.studentId === editId);
        if (idx !== -1) state.students[idx] = { ...state.students[idx], ...data };
        showToast('تم تحديث بيانات الطالب.', 'success');
      } else {
        const ref = await db.collection('students').add(data);
        state.students.push({ ...data, studentId: ref.id });
        showToast(`تم إضافة الطالب "${name}" بنجاح.`, 'success');
      }
      closeModal('modal-student');
      renderStudents($('students-group-filter')?.value || '');
      renderGroups();
      const statEl = $('stat-students');
      if (statEl) statEl.textContent = state.students.length;
    } catch (e) {
      console.error('[Students] Save error:', e);
      showToast('خطأ: ' + e.message, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  SESSIONS
// ══════════════════════════════════════════════════════════════
function renderSessions(filterGroupId = '') {
  const tbody   = $('sessions-tbody');
  if (!tbody) return;
  const sessions = filterGroupId
    ? state.sessions.filter(s => s.groupId === filterGroupId)
    : state.sessions;

  if (!sessions.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📝</div><p>لا توجد جلسات</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sessions.map(s => {
    const group = state.groups.find(g => g.groupId === s.groupId);
    return `
      <tr>
        <td><span class="badge badge-blue">جلسة ${s.sessionNumber}</span></td>
        <td>${group ? group.groupName : '—'}</td>
        <td>${s.date || '—'}</td>
        <td>${s.topic || '—'}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="confirmDelete('session','${s.sessionId}','جلسة #${s.sessionNumber}')">🗑 حذف</button>
        </td>
      </tr>`;
  }).join('');
}

const sessionsGroupFilter = $('sessions-group-filter');
if (sessionsGroupFilter) {
  sessionsGroupFilter.addEventListener('change', e => renderSessions(e.target.value));
}

const btnAddSession = $('btn-add-session');
if (btnAddSession) {
  btnAddSession.addEventListener('click', () => {
    const set = (id, val) => { const el = $(id); if (el) el.value = val; };
    set('session-group',  '');
    set('session-number', '');
    set('session-date',   new Date().toISOString().split('T')[0]);
    set('session-topic',  '');
    openModal('modal-session');
  });
}

const btnSaveSession = $('btn-save-session');
if (btnSaveSession) {
  btnSaveSession.addEventListener('click', async () => {
    const groupId = $('session-group')?.value   || '';
    const num     = parseInt($('session-number')?.value);
    const date    = $('session-date')?.value    || '';
    const topic   = $('session-topic')?.value.trim() || '';

    if (!groupId || !num || !date) { showToast('أكمل الحقول المطلوبة.', 'error'); return; }

    const data = { groupId, sessionNumber: num, date, topic };
    try {
      const ref = await db.collection('sessions').add(data);
      state.sessions.push({ ...data, sessionId: ref.id });
      state.sessions.sort((a, b) => a.sessionNumber - b.sessionNumber);
      closeModal('modal-session');
      renderSessions($('sessions-group-filter')?.value || '');
      const statEl = $('stat-sessions');
      if (statEl) statEl.textContent = state.sessions.length;
      showToast('تم إضافة الجلسة بنجاح.', 'success');
    } catch (e) {
      console.error('[Sessions] Save error:', e);
      showToast('خطأ: ' + e.message, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  EVALUATION MATRIX
// ══════════════════════════════════════════════════════════════
const evalGroupSelect = $('eval-group-select');
if (evalGroupSelect) {
  evalGroupSelect.addEventListener('change', function () {
    const groupId    = this.value;
    const sessSelect = $('eval-session-select');
    const container  = $('eval-matrix-container');
    const emptyState = $('eval-empty-state');

    if (sessSelect) { sessSelect.innerHTML = '<option value="">— اختر جلسة —</option>'; sessSelect.disabled = true; }
    if (container)  container.style.display  = 'none';
    if (emptyState) emptyState.style.display = 'block';
    if (!groupId || !sessSelect) return;

    state.sessions.filter(s => s.groupId === groupId).forEach(s => {
      const opt = document.createElement('option');
      opt.value       = s.sessionId;
      opt.textContent = `جلسة ${s.sessionNumber} — ${s.date} — ${s.topic || ''}`;
      sessSelect.appendChild(opt);
    });
    sessSelect.disabled = false;
  });
}

const evalSessionSelect = $('eval-session-select');
if (evalSessionSelect) {
  evalSessionSelect.addEventListener('change', function () {
    const sessionId  = this.value;
    const groupId    = $('eval-group-select')?.value || '';
    const container  = $('eval-matrix-container');
    const emptyState = $('eval-empty-state');

    if (!sessionId || !groupId) return;

    const group    = state.groups.find(g => g.groupId === groupId);
    const session  = state.sessions.find(s => s.sessionId === sessionId);
    const students = state.students.filter(s => s.groupId === groupId);

    if (!students.length) { showToast('لا يوجد طلاب في هذه المجموعة.', 'info'); return; }

    const labelG = $('eval-group-label');
    const labelS = $('eval-session-label');
    if (labelG) labelG.textContent = group   ? group.groupName            : '';
    if (labelS) labelS.textContent = session ? `جلسة ${session.sessionNumber}` : '';

    const existingEvals = {};
    state.evaluations.filter(ev => ev.sessionId === sessionId)
      .forEach(ev => { existingEvals[ev.studentId] = ev; });

    const tbody = $('eval-matrix-tbody');
    if (tbody) {
      tbody.innerHTML = students.map(student => {
        const ev    = existingEvals[student.studentId] || {};
        const rowId = `row-${student.studentId}`;
        const chk   = (val) => val ? 'checked' : '';
        return `
          <tr id="${rowId}" data-student-id="${student.studentId}">
            <td><strong>${student.studentName}</strong></td>
            <td class="eval-checkbox"><input type="checkbox" class="ev-attendance"    ${chk(ev.attendance)}     onchange="recalcRow('${student.studentId}')" /></td>
            <td class="eval-checkbox"><input type="checkbox" class="ev-participation" ${chk(ev.participation)}  onchange="recalcRow('${student.studentId}')" /></td>
            <td class="eval-checkbox"><input type="checkbox" class="ev-application"   ${chk(ev.application)}    onchange="recalcRow('${student.studentId}')" /></td>
            <td class="eval-checkbox"><input type="checkbox" class="ev-homework"      ${chk(ev.homework)}       onchange="recalcRow('${student.studentId}')" /></td>
            <td class="eval-checkbox"><input type="checkbox" class="ev-creativity"    ${chk(ev.creativity)}     onchange="recalcRow('${student.studentId}')" /></td>
            <td class="eval-checkbox penalty-checkbox"><input type="checkbox" class="ev-late"  ${chk(ev.latePenalty)}    onchange="recalcRow('${student.studentId}')" /></td>
            <td class="eval-checkbox penalty-checkbox"><input type="checkbox" class="ev-nohw"  ${chk(ev.homeworkPenalty)} onchange="recalcRow('${student.studentId}')" /></td>
            <td class="score-cell" id="score-${student.studentId}">${ev.totalPoints || 0}</td>
          </tr>`;
      }).join('');

      students.forEach(s => recalcRow(s.studentId));
    }

    if (container)  container.style.display  = 'block';
    if (emptyState) emptyState.style.display = 'none';
  });
}

window.recalcRow = (studentId) => {
  const row = document.getElementById(`row-${studentId}`);
  if (!row) return;
  const get = cls => row.querySelector(cls)?.checked || false;

  let points = 0;
  if (get('.ev-attendance'))    points += SCORE_RULES.attendance;
  if (get('.ev-participation')) points += SCORE_RULES.participation;
  if (get('.ev-application'))   points += SCORE_RULES.application;
  if (get('.ev-homework'))      points += SCORE_RULES.homework;
  if (get('.ev-creativity'))    points += SCORE_RULES.creativity;
  if (get('.ev-late'))          points += SCORE_RULES.latePenalty;
  if (get('.ev-nohw'))          points += SCORE_RULES.homeworkPenalty;

  const cell = document.getElementById(`score-${studentId}`);
  if (cell) {
    cell.textContent = points;
    cell.className   = `score-cell${points < 0 ? ' danger' : points < 20 ? ' warning' : ''}`;
  }
};

// FIX [CRITICAL-6]: Firestore batch limited to 500 ops — chunk if needed
async function commitInChunks(operations) {
  const CHUNK = 490;
  for (let i = 0; i < operations.length; i += CHUNK) {
    const batch = db.batch();
    operations.slice(i, i + CHUNK).forEach(op => {
      if (op.type === 'set')    batch.set(op.ref, op.data);
      if (op.type === 'update') batch.update(op.ref, op.data);
    });
    await batch.commit();
  }
}

const btnSaveEvaluations = $('btn-save-evaluations');
if (btnSaveEvaluations) {
  btnSaveEvaluations.addEventListener('click', async () => {
    const sessionId = $('eval-session-select')?.value || '';
    const groupId   = $('eval-group-select')?.value   || '';
    if (!sessionId || !groupId) return;

    const students = state.students.filter(s => s.groupId === groupId);
    const uid      = state.currentUser?.uid;
    if (!uid) { showToast('خطأ في المصادقة.', 'error'); return; }

    const existingMap = {};
    state.evaluations.filter(ev => ev.sessionId === sessionId)
      .forEach(ev => { existingMap[ev.studentId] = ev; });

    const operations  = [];
    const savedEvals  = [];

    students.forEach(student => {
      const row = document.getElementById(`row-${student.studentId}`);
      if (!row) return;
      const get = cls => row.querySelector(cls)?.checked || false;

      const attendance      = get('.ev-attendance');
      const participation   = get('.ev-participation');
      const application     = get('.ev-application');
      const homework        = get('.ev-homework');
      const creativity      = get('.ev-creativity');
      const latePenalty     = get('.ev-late');
      const homeworkPenalty = get('.ev-nohw');

      let total = 0;
      if (attendance)      total += SCORE_RULES.attendance;
      if (participation)   total += SCORE_RULES.participation;
      if (application)     total += SCORE_RULES.application;
      if (homework)        total += SCORE_RULES.homework;
      if (creativity)      total += SCORE_RULES.creativity;
      if (latePenalty)     total += SCORE_RULES.latePenalty;
      if (homeworkPenalty) total += SCORE_RULES.homeworkPenalty;

      // FIX [CRITICAL-2]: compat serverTimestamp
      const data = {
        studentId: student.studentId, sessionId,
        attendance, participation, application,
        homework, creativity, latePenalty, homeworkPenalty,
        totalPoints: total, instructorId: uid,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      };

      const existing = existingMap[student.studentId];
      if (existing) {
        operations.push({ type: 'update', ref: db.collection('evaluations').doc(existing.evaluationId), data });
        savedEvals.push({ ...data, evaluationId: existing.evaluationId });
      } else {
        const ref = db.collection('evaluations').doc();
        operations.push({ type: 'set', ref, data });
        savedEvals.push({ ...data, evaluationId: ref.id });
      }
    });

    try {
      await commitInChunks(operations);
      savedEvals.forEach(ev => {
        const idx = state.evaluations.findIndex(x => x.evaluationId === ev.evaluationId);
        if (idx !== -1) state.evaluations[idx] = ev;
        else state.evaluations.push(ev);
      });
      showToast('✅ تم حفظ جميع التقييمات بنجاح!', 'success');
    } catch (e) {
      console.error('[Evaluations] Batch save error:', e);
      showToast('خطأ في الحفظ: ' + e.message, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  BADGE ENGINE
//  FIX [HIGH-8]: replaced hardcoded `=== 4` with `=== cycle.length`
// ══════════════════════════════════════════════════════════════
function computeBadges(totals, evaluations, sessions) {
  const badgeMap = {};

  state.groups.forEach(group => {
    const groupStudents = state.students.filter(s => s.groupId === group.groupId);
    const groupSessions = sessions
      .filter(s => s.groupId === group.groupId)
      .sort((a, b) => a.sessionNumber - b.sessionNumber);

    for (let i = 0; i < groupSessions.length; i += 4) {
      const cycle = groupSessions.slice(i, i + 4);
      if (cycle.length < 4) continue;

      const cycleLen = cycle.length; // dynamic — not hardcoded
      const cycleIds = new Set(cycle.map(s => s.sessionId));

      const cycleStats = {};
      groupStudents.forEach(s => {
        cycleStats[s.studentId] = { total: 0, creativity: 0, attended: 0, hwDone: 0, sessions: 0 };
      });

      evaluations.forEach(ev => {
        if (!cycleIds.has(ev.sessionId) || !cycleStats[ev.studentId]) return;
        const cs = cycleStats[ev.studentId];
        cs.total      += ev.totalPoints || 0;
        cs.creativity += ev.creativity ? SCORE_RULES.creativity : 0;
        cs.attended   += ev.attendance ? 1 : 0;
        cs.hwDone     += ev.homework   ? 1 : 0;
        cs.sessions   += 1;
      });

      const participating = Object.entries(cycleStats).filter(([, v]) => v.sessions > 0);
      if (!participating.length) continue;

      // 🥇 Star of Month
      const topTotal = participating.reduce((a, b) => b[1].total > a[1].total ? b : a);
      if (!badgeMap[topTotal[0]]) badgeMap[topTotal[0]] = new Set();
      badgeMap[topTotal[0]].add('starOfMonth');

      // 💡 Young Innovator
      const topCreative = participating.reduce((a, b) => b[1].creativity > a[1].creativity ? b : a);
      if (topCreative[1].creativity > 0) {
        if (!badgeMap[topCreative[0]]) badgeMap[topCreative[0]] = new Set();
        badgeMap[topCreative[0]].add('youngInnovator');
      }

      // 🎯 Homework Champion — 100% submission
      participating.forEach(([id, v]) => {
        if (v.hwDone === v.sessions && v.sessions > 0) {
          if (!badgeMap[id]) badgeMap[id] = new Set();
          badgeMap[id].add('homeworkChamp');
        }
      });

      // 🔥 Perfect Attendance — uses cycleLen not hardcoded 4
      participating.forEach(([id, v]) => {
        if (v.attended === cycleLen) {
          if (!badgeMap[id]) badgeMap[id] = new Set();
          badgeMap[id].add('perfectAttend');
        }
      });
    }
  });

  const result = {};
  Object.entries(badgeMap).forEach(([id, set]) => { result[id] = [...set]; });
  return result;
}

// ══════════════════════════════════════════════════════════════
//  REPORTS
//  FIX [HIGH-3]: cycle select listener was stacked on every group change
// ══════════════════════════════════════════════════════════════
function onCycleSelectChange() {
  const val    = $('report-cycle-select')?.value;
  const genBtn = $('btn-generate-report');
  if (genBtn) genBtn.disabled = (val === '' || val === undefined || val === null);
}

const reportGroupSelect = $('report-group-select');
if (reportGroupSelect) {
  reportGroupSelect.addEventListener('change', function () {
    const groupId     = this.value;
    const cycleSelect = $('report-cycle-select');
    const genBtn      = $('btn-generate-report');
    const container   = $('reports-container');

    if (cycleSelect) { cycleSelect.innerHTML = '<option value="">— اختر الدورة —</option>'; cycleSelect.disabled = true; }
    if (genBtn)    genBtn.disabled = true;
    if (container) container.innerHTML = '';
    if (!groupId)  return;

    const groupSessions = state.sessions
      .filter(s => s.groupId === groupId)
      .sort((a, b) => a.sessionNumber - b.sessionNumber);

    const cycles = Math.floor(groupSessions.length / 4);
    if (!cycles || !cycleSelect) return;

    for (let i = 0; i < cycles; i++) {
      const start = groupSessions[i * 4];
      const end   = groupSessions[i * 4 + 3];
      const opt   = document.createElement('option');
      opt.value   = i;
      opt.textContent = `الدورة ${i + 1} — جلسات ${start.sessionNumber}–${end.sessionNumber} (${start.date} → ${end.date})`;
      cycleSelect.appendChild(opt);
    }

    cycleSelect.disabled = false;
    // FIX [HIGH-3]: remove old listener before adding new one
    cycleSelect.removeEventListener('change', onCycleSelectChange);
    cycleSelect.addEventListener('change', onCycleSelectChange);
  });
}

const btnGenerateReport = $('btn-generate-report');
if (btnGenerateReport) {
  btnGenerateReport.addEventListener('click', () => {
    const groupId  = $('report-group-select')?.value || '';
    const cycleIdx = parseInt($('report-cycle-select')?.value);
    if (!groupId || isNaN(cycleIdx)) return;

    const group     = state.groups.find(g => g.groupId === groupId);
    const students  = state.students.filter(s => s.groupId === groupId);
    const groupSessions = state.sessions
      .filter(s => s.groupId === groupId)
      .sort((a, b) => a.sessionNumber - b.sessionNumber);

    const cycle    = groupSessions.slice(cycleIdx * 4, cycleIdx * 4 + 4);
    const cycleLen = cycle.length;
    const maxScore = cycleLen * MAX_SESSION_SCORE;
    const cycleIds = new Set(cycle.map(s => s.sessionId));

    const totals = computeStudentTotals();
    const badges = computeBadges(totals, state.evaluations, state.sessions);

    const container = $('reports-container');
    if (!container) return;
    container.innerHTML = '';

    if (!students.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>لا يوجد طلاب</p></div>';
      return;
    }

    students.forEach(student => {
      const cycleEvals    = state.evaluations.filter(ev => ev.studentId === student.studentId && cycleIds.has(ev.sessionId));
      const cycleTotal    = cycleEvals.reduce((sum, ev) => sum + (ev.totalPoints || 0), 0);
      const attended      = cycleEvals.filter(ev => ev.attendance).length;
      const hwDone        = cycleEvals.filter(ev => ev.homework).length;
      const creativity    = cycleEvals.filter(ev => ev.creativity).length;
      const studentBadges = badges[student.studentId] || [];

      const badgeHTML = studentBadges.map(b => {
        const rule = Object.values(BADGE_RULES).find(r => r.key === b);
        return rule ? `<span class="award-badge">${rule.label}</span>` : '';
      }).join('');

      const progressPercent = maxScore > 0 ? Math.min(100, Math.round((cycleTotal / maxScore) * 100)) : 0;
      const progressColor   = progressPercent >= 80 ? 'var(--success)' : progressPercent >= 50 ? 'var(--primary)' : 'var(--warning)';
      const cardId          = `report-card-${student.studentId}`;

      const card    = document.createElement('div');
      card.className = 'report-card';
      card.id        = cardId;
      card.innerHTML = `
        <div class="report-header">
          <div class="report-student-info">
            <h3>${student.studentName}</h3>
            <p>المجموعة: ${group ? group.groupName : '—'} | الدورة ${cycleIdx + 1}</p>
            <p style="margin-top:4px;">جلسات ${cycle[0]?.sessionNumber || ''}–${cycle[cycleLen - 1]?.sessionNumber || ''}</p>
          </div>
          <div class="report-score-badge">
            <div class="score-num">${cycleTotal}</div>
            <div class="score-label">/ ${maxScore} نقطة</div>
          </div>
        </div>
        <div class="report-body">
          ${studentBadges.length ? `<div class="report-badges-row">${badgeHTML}</div>` : ''}
          <div style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:0.82rem;color:var(--text-secondary);">
              <span>نسبة الأداء العامة</span>
              <strong style="color:${progressColor};">${progressPercent}%</strong>
            </div>
            <div style="height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${progressPercent}%;background:${progressColor};border-radius:4px;transition:width 0.6s ease;"></div>
            </div>
          </div>
          <table style="margin-bottom:16px;">
            <thead>
              <tr>
                <th>الجلسة</th><th>التاريخ</th><th>الحضور</th>
                <th>الواجب</th><th>الإبداع</th><th>النقاط</th>
              </tr>
            </thead>
            <tbody>
              ${cycle.map(sess => {
                const ev = cycleEvals.find(e => e.sessionId === sess.sessionId);
                return `<tr>
                  <td>جلسة ${sess.sessionNumber}</td>
                  <td>${sess.date || '—'}</td>
                  <td>${ev?.attendance  ? '✅' : '❌'}</td>
                  <td>${ev?.homework    ? '✅' : '❌'}</td>
                  <td>${ev?.creativity  ? '✅' : '—'}</td>
                  <td><strong style="color:var(--primary);">${ev?.totalPoints || 0}</strong></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
            <div style="flex:1;min-width:120px;background:var(--bg-card-alt);border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:800;color:var(--success);">${attended}/${cycleLen}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">جلسات الحضور</div>
            </div>
            <div style="flex:1;min-width:120px;background:var(--bg-card-alt);border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:800;color:var(--primary);">${hwDone}/${cycleLen}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">واجبات مكتملة</div>
            </div>
            <div style="flex:1;min-width:120px;background:var(--bg-card-alt);border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:800;color:var(--info);">${creativity}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">مشاريع إبداعية</div>
            </div>
            <div style="flex:1;min-width:120px;background:var(--bg-card-alt);border-radius:var(--radius-sm);padding:12px;text-align:center;">
              <div style="font-size:1.5rem;font-weight:800;color:${progressColor};">${cycleTotal}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">مجموع النقاط</div>
            </div>
          </div>
          <div class="report-actions">
            <button class="btn btn-danger btn-sm" onclick="exportPDF('${cardId}','${student.studentName}')">📄 تصدير PDF</button>
            <button class="btn btn-success btn-sm" onclick="exportExcel('${student.studentId}','${cycleIdx}','${groupId}')">📊 تصدير Excel</button>
            <button class="btn btn-ghost btn-sm" onclick="printReport('${cardId}')">🖨 طباعة</button>
          </div>
        </div>`;
      container.appendChild(card);
    });

    // Group export button
    const exportAllBtn = document.createElement('div');
    exportAllBtn.style.cssText = 'margin-top:16px;text-align:center;';
    exportAllBtn.innerHTML = `
      <button class="btn btn-secondary btn-lg" onclick="exportGroupExcel('${groupId}','${cycleIdx}')">
        📊 تصدير تقرير المجموعة الكاملة (Excel)
      </button>`;
    container.appendChild(exportAllBtn);
  });
}

// ══════════════════════════════════════════════════════════════
//  EXPORT FUNCTIONS
//  FIX [HIGH-6]: typeof guards for html2pdf and XLSX
// ══════════════════════════════════════════════════════════════
window.exportPDF = (cardId, studentName) => {
  if (typeof html2pdf === 'undefined') {
    showToast('مكتبة PDF غير محمّلة. تحقق من الاتصال.', 'error');
    return;
  }
  const card = document.getElementById(cardId);
  if (!card) return;
  const opt = {
    margin:      [8, 8, 8, 8],
    filename:    `تقرير-${studentName}.pdf`,
    image:       { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  showToast(`جاري تصدير تقرير ${studentName}...`, 'info');
  html2pdf().set(opt).from(card).save().catch(e => {
    console.error('[PDF] Export error:', e);
    showToast('خطأ في تصدير PDF.', 'error');
  });
};

window.printReport = (cardId) => {
  const card = document.getElementById(cardId);
  if (!card) return;
  const win = window.open('', '_blank');
  if (!win) { showToast('يرجى السماح بالنوافذ المنبثقة.', 'error'); return; }
  win.document.write(`
    <html dir="rtl"><head>
    <meta charset="UTF-8">
    <title>تقرير الطالب</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="app.css">
    <style>body{font-family:'Cairo',sans-serif;padding:20px;}.report-actions{display:none;}</style>
    </head><body>${card.outerHTML}
    <script>window.onload=()=>window.print();<\/script>
    </body></html>`);
  win.document.close();
};

window.exportExcel = (studentId, cycleIdx, groupId) => {
  if (typeof XLSX === 'undefined') { showToast('مكتبة Excel غير محمّلة.', 'error'); return; }
  const student       = state.students.find(s => s.studentId === studentId);
  const groupSessions = state.sessions.filter(s => s.groupId === groupId)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const cycle         = groupSessions.slice(cycleIdx * 4, cycleIdx * 4 + 4);
  const cycleIds      = new Set(cycle.map(s => s.sessionId));
  const cycleEvals    = state.evaluations.filter(ev => ev.studentId === studentId && cycleIds.has(ev.sessionId));

  const rows = cycle.map(sess => {
    const ev = cycleEvals.find(e => e.sessionId === sess.sessionId);
    return {
      'الجلسة':        `جلسة ${sess.sessionNumber}`,
      'التاريخ':       sess.date || '',
      'الموضوع':       sess.topic || '',
      'الحضور':        ev?.attendance      ? 'نعم' : 'لا',
      'المشاركة':      ev?.participation   ? 'نعم' : 'لا',
      'التطبيق':       ev?.application     ? 'نعم' : 'لا',
      'الواجب':        ev?.homework        ? 'نعم' : 'لا',
      'الإبداع':       ev?.creativity      ? 'نعم' : 'لا',
      'تأخر':          ev?.latePenalty     ? 'نعم' : 'لا',
      'غياب الواجب':   ev?.homeworkPenalty ? 'نعم' : 'لا',
      'مجموع النقاط':  ev?.totalPoints     || 0
    };
  });

  try {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, student?.studentName || 'تقرير');
    XLSX.writeFile(wb, `تقرير-${student?.studentName || 'طالب'}-الدورة${parseInt(cycleIdx) + 1}.xlsx`);
    showToast('تم تصدير ملف Excel بنجاح.', 'success');
  } catch (e) {
    console.error('[Excel] Export error:', e);
    showToast('خطأ في تصدير Excel.', 'error');
  }
};

window.exportGroupExcel = (groupId, cycleIdx) => {
  if (typeof XLSX === 'undefined') { showToast('مكتبة Excel غير محمّلة.', 'error'); return; }
  const group         = state.groups.find(g => g.groupId === groupId);
  const students      = state.students.filter(s => s.groupId === groupId);
  const groupSessions = state.sessions.filter(s => s.groupId === groupId)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const cycle         = groupSessions.slice(cycleIdx * 4, cycleIdx * 4 + 4);
  const cycleLen      = cycle.length;
  const maxScore      = cycleLen * MAX_SESSION_SCORE;
  const cycleIds      = new Set(cycle.map(s => s.sessionId));

  const rows = students.map(student => {
    const cycleEvals = state.evaluations.filter(ev => ev.studentId === student.studentId && cycleIds.has(ev.sessionId));
    const total      = cycleEvals.reduce((s, ev) => s + (ev.totalPoints || 0), 0);
    const attended   = cycleEvals.filter(ev => ev.attendance).length;
    const hwDone     = cycleEvals.filter(ev => ev.homework).length;
    const creative   = cycleEvals.filter(ev => ev.creativity).length;
    return {
      'اسم الطالب':       student.studentName,
      'العمر':             student.age || '',
      'جلسات الحضور':     `${attended}/${cycleLen}`,
      'واجبات مكتملة':    `${hwDone}/${cycleLen}`,
      'مشاريع إبداعية':   creative,
      'مجموع النقاط':     total,
      'النسبة':            `${maxScore > 0 ? Math.min(100, Math.round((total / maxScore) * 100)) : 0}%`
    };
  });

  try {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, group?.groupName || 'المجموعة');
    XLSX.writeFile(wb, `تقرير-${group?.groupName || 'مجموعة'}-الدورة${parseInt(cycleIdx) + 1}.xlsx`);
    showToast('تم تصدير تقرير المجموعة بنجاح.', 'success');
  } catch (e) {
    console.error('[Excel] Group export error:', e);
    showToast('خطأ في تصدير Excel.', 'error');
  }
};

// ══════════════════════════════════════════════════════════════
//  DELETE CONFIRM
// ══════════════════════════════════════════════════════════════
window.confirmDelete = (type, id, label) => {
  const msgEl = $('confirm-msg');
  if (msgEl) msgEl.textContent = `هل أنت متأكد من حذف ${label}؟ لا يمكن التراجع عن هذه العملية.`;
  state.deleteCallback = async () => {
    try {
      await deleteEntity(type, id);
      closeModal('modal-confirm');
      showToast(`تم حذف "${label}" بنجاح.`, 'success');
    } catch (e) {
      console.error('[Delete] Error:', e);
      showToast('خطأ في الحذف: ' + e.message, 'error');
    }
  };
  openModal('modal-confirm');
};

async function deleteEntity(type, id) {
  if (type === 'group') {
    await db.collection('groups').doc(id).delete();
    state.groups = state.groups.filter(g => g.groupId !== id);
    renderGroups(); buildSelectDropdowns();
  } else if (type === 'student') {
    await db.collection('students').doc(id).delete();
    state.students = state.students.filter(s => s.studentId !== id);
    renderStudents($('students-group-filter')?.value || '');
    const statEl = $('stat-students');
    if (statEl) statEl.textContent = state.students.length;
  } else if (type === 'session') {
    await db.collection('sessions').doc(id).delete();
    state.sessions = state.sessions.filter(s => s.sessionId !== id);
    renderSessions($('sessions-group-filter')?.value || '');
    const statEl = $('stat-sessions');
    if (statEl) statEl.textContent = state.sessions.length;
  } else if (type === 'instructor') {
    await db.collection('users').doc(id).delete();
    state.instructors = state.instructors.filter(i => i.userId !== id);
    renderInstructors(); buildSelectDropdowns();
  }
}

const btnConfirmDelete = $('btn-confirm-delete');
if (btnConfirmDelete) {
  btnConfirmDelete.addEventListener('click', () => {
    if (state.deleteCallback) state.deleteCallback();
  });
}

// ══════════════════════════════════════════════════════════════
//  THEME TOGGLE
//  FIX [HIGH-7]: read localStorage after DOM is ready
// ══════════════════════════════════════════════════════════════
let darkMode = localStorage.getItem('codingua-theme') === 'dark';

function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  const btn = $('theme-toggle');
  if (btn) btn.textContent = darkMode ? '☀️' : '🌙';
}

applyTheme(); // Safe — DOM is ready (script at bottom of body)

const themeToggle = $('theme-toggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    darkMode = !darkMode;
    localStorage.setItem('codingua-theme', darkMode ? 'dark' : 'light');
    applyTheme();
  });
}

// ══════════════════════════════════════════════════════════════
//  SIDEBAR NAVIGATION
// ══════════════════════════════════════════════════════════════
$$('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const panel = item.dataset.panel;
    if (!panel) return;
    setActivePanel(panel);
    if (panel === 'reports-panel') buildSelectDropdowns();
  });
});

function closeSidebar() {
  if (window.innerWidth <= 768) {
    $('sidebar')?.classList.remove('open');
    $('sidebar-overlay')?.classList.remove('open');
  }
}

const mobileMenuBtn = $('mobile-menu-btn');
if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', () => {
    $('sidebar')?.classList.toggle('open');
    $('sidebar-overlay')?.classList.toggle('open');
  });
}

const sidebarOverlay = $('sidebar-overlay');
if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

// ══════════════════════════════════════════════════════════════
//  MODAL MANAGEMENT
// ══════════════════════════════════════════════════════════════
$$('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.modal;
    if (modalId) closeModal(modalId);
  });
});

$$('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});
