/**
 * Codingua Academy Dashboard — app.js
 * Full-featured, production-grade SPA logic
 * Firebase Compat SDK v10, Chart.js, SheetJS, html2pdf
 */

'use strict';
// ══════════════════════════════════════════════════════════════
//  FIREBASE CONFIGURATION
//  ⚠️  Replace these values with your actual Firebase project config
// ══════════════════════════════════════════════════════════════
// Import the functions you need from the SDKs you need

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBEPjNIYw_ZQbqcdARMlJ3OH1-uGi_o_LA",
  authDomain: "codingua-evaluation.firebaseapp.com",
  projectId: "codingua-evaluation",
  storageBucket: "codingua-evaluation.firebasestorage.app",
  messagingSenderId: "775470149394",
  appId: "1:775470149394:web:befdb3f369bce0c2e0cdcb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db   = firebase.firestore();

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

const BADGE_RULES = {
  starOfMonth:    { label: '🥇 نجم الشهر',         key: 'starOfMonth' },
  youngInnovator: { label: '💡 المبدع الصغير',      key: 'youngInnovator' },
  homeworkChamp:  { label: '🎯 بطل الواجبات',       key: 'homeworkChamp' },
  perfectAttend:  { label: '🔥 حضور مثالي',         key: 'perfectAttend' }
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
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function showToast(message, type = 'info') {
  const container = $('toast-container');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
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
  $('page-title').textContent = titles[panelId] || 'Dashboard';
  closeSidebar();
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email    = $('login-email').value.trim();
  const password = $('login-password').value;
  const btn      = $('login-btn');
  const errDiv   = $('auth-error');
  const errMsg   = $('auth-error-msg');

  errDiv.classList.remove('visible');
  btn.innerHTML = '<div class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff;margin:0 auto;"></div>';
  btn.disabled = true;

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    const messages = {
      'auth/user-not-found':  'البريد الإلكتروني غير مسجّل.',
      'auth/wrong-password':  'كلمة المرور غير صحيحة.',
      'auth/invalid-email':   'صيغة البريد الإلكتروني غير صحيحة.',
      'auth/too-many-requests': 'تم تجاوز عدد المحاولات. حاول لاحقاً.'
    };
    errMsg.textContent = messages[err.code] || err.message;
    errDiv.classList.add('visible');
    $('login-btn-text').textContent = 'تسجيل الدخول';
    btn.innerHTML = '<span id="login-btn-text">تسجيل الدخول</span>';
    btn.disabled = false;
  }
});

$('logout-btn').addEventListener('click', () => {
  auth.signOut();
});

auth.onAuthStateChanged(async user => {
  if (user) {
    state.currentUser = user;
    try {
      const snap = await db.collection('users').doc(user.uid).get();
      if (!snap.exists) {
        showToast('المستخدم غير مسجّل في النظام.', 'error');
        auth.signOut();
        return;
      }
      state.userProfile = { ...snap.data(), userId: snap.id };
      initApp();
    } catch (e) {
      showToast('خطأ في تحميل بيانات المستخدم.', 'error');
    }
  } else {
    state.currentUser = null;
    state.userProfile = null;
    $('app').style.display = 'none';
    $('auth-screen').style.display = 'flex';
  }
});

// ══════════════════════════════════════════════════════════════
//  APP INIT
// ══════════════════════════════════════════════════════════════
async function initApp() {
  $('auth-screen').style.display = 'none';
  $('app').style.display = 'flex';

  const profile = state.userProfile;
  const isAdmin = profile.role === 'admin';

  // Sidebar user card
  $('sidebar-avatar').textContent = (profile.fullName || 'U')[0].toUpperCase();
  $('sidebar-name').textContent   = profile.fullName || 'مستخدم';
  $('sidebar-role').textContent   = isAdmin ? 'مدير النظام' : 'مدرّس';
  $('role-badge').textContent     = isAdmin ? 'مدير' : 'مدرّس';

  // Hide admin-only nav
  $$('.admin-only-nav').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
  $$('.admin-only-action').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

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
// ══════════════════════════════════════════════════════════════
async function loadAllData() {
  const profile  = state.userProfile;
  const isAdmin  = profile.role === 'admin';
  const uid      = profile.userId;
  const assigned = profile.assignedGroups || [];

  try {
    // Groups
    let groupsQuery = db.collection('groups');
    if (!isAdmin) groupsQuery = groupsQuery.where(firebase.firestore.FieldPath.documentId(), 'in', assigned.length ? assigned : ['__none__']);
    const groupsSnap = await groupsQuery.get();
    state.groups = groupsSnap.docs.map(d => ({ ...d.data(), groupId: d.id }));

    const groupIds = state.groups.map(g => g.groupId);

    // Students
    if (groupIds.length) {
      const studentsSnap = await db.collection('students').where('groupId', 'in', groupIds).get();
      state.students = studentsSnap.docs.map(d => ({ ...d.data(), studentId: d.id }));
    } else { state.students = []; }

    // Sessions
    if (groupIds.length) {
      const sessionsSnap = await db.collection('sessions').where('groupId', 'in', groupIds).orderBy('sessionNumber').get();
      state.sessions = sessionsSnap.docs.map(d => ({ ...d.data(), sessionId: d.id }));
    } else { state.sessions = []; }

    // Evaluations
    let evalsQuery = db.collection('evaluations');
    if (!isAdmin) evalsQuery = evalsQuery.where('instructorId', '==', uid);
    const evalsSnap = await evalsQuery.get();
    state.evaluations = evalsSnap.docs.map(d => ({ ...d.data(), evaluationId: d.id }));

    // Instructors (admin only)
    if (isAdmin) {
      const insSnap = await db.collection('users').where('role', '==', 'instructor').get();
      state.instructors = insSnap.docs.map(d => ({ ...d.data(), userId: d.id }));
    }
  } catch (e) {
    console.error('Load error:', e);
    showToast('خطأ في تحميل البيانات: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  BUILD SELECT DROPDOWNS
// ══════════════════════════════════════════════════════════════
function buildSelectDropdowns() {
  const groupSelects = [
    'students-group-filter', 'sessions-group-filter',
    'eval-group-select', 'report-group-select',
    'group-instructor', 'session-group', 'student-group'
  ];

  // Populate group dropdowns
  ['students-group-filter', 'sessions-group-filter', 'eval-group-select', 'report-group-select', 'session-group', 'student-group'].forEach(id => {
    const el = $(id);
    if (!el) return;
    const isFilter = id.includes('filter');
    el.innerHTML = `<option value="">${isFilter ? 'كل المجموعات' : '— اختر مجموعة —'}</option>`;
    state.groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.groupId;
      opt.textContent = g.groupName;
      el.appendChild(opt);
    });
  });

  // Instructors dropdown in group modal
  const instSelect = $('group-instructor');
  if (instSelect) {
    instSelect.innerHTML = '<option value="">— اختر مدرّساً —</option>';
    state.instructors.forEach(i => {
      const opt = document.createElement('option');
      opt.value = i.userId;
      opt.textContent = i.fullName;
      instSelect.appendChild(opt);
    });
  }
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD (Admin)
// ══════════════════════════════════════════════════════════════
function renderDashboard() {
  $('stat-students').textContent    = state.students.length;
  $('stat-groups').textContent      = state.groups.length;
  $('stat-instructors').textContent = state.instructors.length;
  $('stat-sessions').textContent    = state.sessions.length;

  // Top student by total points
  const studentPoints = computeStudentTotals();
  const sorted = Object.entries(studentPoints).sort((a, b) => b[1].total - a[1].total);
  if (sorted.length) {
    const topStudent = state.students.find(s => s.studentId === sorted[0][0]);
    $('stat-top-student').textContent = topStudent ? topStudent.studentName : '—';
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
    totals[ev.studentId].total     += (ev.totalPoints || 0);
    totals[ev.studentId].creativity += (ev.creativity ? SCORE_RULES.creativity : 0);
    totals[ev.studentId].sessions  += 1;
    if (!ev.attendance)  totals[ev.studentId].attendedAll = false;
    if (!ev.homework)    totals[ev.studentId].hwAll = false;
  });
  return totals;
}

function renderRankingChart(sorted) {
  const ctx = $('rankingChart').getContext('2d');
  if (state.charts.ranking) state.charts.ranking.destroy();

  const top10 = sorted.slice(0, 10);
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
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,0.1)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderBadgesChart() {
  const ctx = $('badgesChart').getContext('2d');
  if (state.charts.badges) state.charts.badges.destroy();

  const totals = computeStudentTotals();
  const badges = computeBadges(totals, state.evaluations, state.sessions);
  const counts = { starOfMonth: 0, youngInnovator: 0, homeworkChamp: 0, perfectAttend: 0 };
  Object.values(badges).forEach(list => list.forEach(b => counts[b]++));

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
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { family: 'Cairo' } } } },
      cutout: '65%'
    }
  });
}

function renderAttendanceChart() {
  const ctx = $('attendanceChart').getContext('2d');
  if (state.charts.attendance) state.charts.attendance.destroy();

  // Sessions by group attendance
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
        { label: 'حضر', data: attended, backgroundColor: 'rgba(39,174,96,0.8)', borderRadius: 6 },
        { label: 'غاب', data: absent,   backgroundColor: 'rgba(231,76,60,0.8)',  borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
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
  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><p>لا توجد تقييمات بعد</p></div>';
    return;
  }
  const top5 = sorted.slice(0, 5);
  container.innerHTML = top5.map(([id, v], i) => {
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
  const isAdmin = state.userProfile.role === 'admin';

  if (!state.groups.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">📚</div><p>لا توجد مجموعات بعد</p></div>`;
    return;
  }

  grid.innerHTML = state.groups.map(g => {
    const instructor = state.instructors.find(i => i.userId === g.instructorId);
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

$('btn-add-group') && $('btn-add-group').addEventListener('click', () => {
  $('group-name').value   = '';
  $('group-course').value = '';
  buildSelectDropdowns();
  openModal('modal-group');
});

$('btn-save-group').addEventListener('click', async () => {
  const name       = $('group-name').value.trim();
  const course     = $('group-course').value.trim();
  const instructor = $('group-instructor').value;
  if (!name) { showToast('أدخل اسم المجموعة.', 'error'); return; }

  try {
    const ref = await db.collection('groups').add({ groupName: name, courseName: course, instructorId: instructor || '' });
    state.groups.push({ groupId: ref.id, groupName: name, courseName: course, instructorId: instructor || '' });
    // Update instructor's assignedGroups
    if (instructor) {
      await db.collection('users').doc(instructor).update({
        assignedGroups: firebase.firestore.FieldValue.arrayUnion(ref.id)
      });
    }
    closeModal('modal-group');
    buildSelectDropdowns();
    renderGroups();
    showToast(`تم إضافة مجموعة "${name}" بنجاح.`, 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
});

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

$('btn-add-instructor') && $('btn-add-instructor').addEventListener('click', () => {
  $('inst-name').value     = '';
  $('inst-email').value    = '';
  $('inst-password').value = '';
  // Build group checkboxes
  const box = $('inst-groups-checkboxes');
  box.innerHTML = state.groups.map(g => `
    <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer;">
      <input type="checkbox" name="inst-group" value="${g.groupId}" style="accent-color:var(--primary);width:16px;height:16px;" />
      ${g.groupName}
    </label>`).join('');
  openModal('modal-instructor');
});

$('btn-save-instructor').addEventListener('click', async () => {
  const name     = $('inst-name').value.trim();
  const email    = $('inst-email').value.trim();
  const password = $('inst-password').value;
  const selected = [...$$('input[name="inst-group"]:checked')].map(x => x.value);

  if (!name || !email || !password) { showToast('أكمل جميع الحقول.', 'error'); return; }

  try {
    // Create Firebase Auth user (requires Admin SDK in production; here uses client SDK for demo)
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await db.collection('users').doc(cred.user.uid).set({
      fullName: name, email, role: 'instructor', assignedGroups: selected
    });
    // Update groups with instructorId
    for (const gid of selected) {
      await db.collection('groups').doc(gid).update({ instructorId: cred.user.uid });
    }
    state.instructors.push({ userId: cred.user.uid, fullName: name, email, role: 'instructor', assignedGroups: selected });
    closeModal('modal-instructor');
    renderInstructors();
    buildSelectDropdowns();
    showToast(`تم إضافة المدرّس "${name}" بنجاح.`, 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
});

// ══════════════════════════════════════════════════════════════
//  STUDENTS
// ══════════════════════════════════════════════════════════════
function renderStudents(filterGroupId = '') {
  const tbody   = $('students-tbody');
  const isAdmin = state.userProfile.role === 'admin';
  let students  = filterGroupId ? state.students.filter(s => s.groupId === filterGroupId) : state.students;

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
        <td style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="editStudent('${s.studentId}')">✏️ تعديل</button>
          ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="confirmDelete('student','${s.studentId}','الطالب: ${s.studentName}')">🗑</button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

$('students-group-filter').addEventListener('change', e => {
  renderStudents(e.target.value);
});

$('btn-add-student').addEventListener('click', () => {
  $('student-modal-title').textContent = '➕ إضافة طالب جديد';
  $('student-name').value  = '';
  $('student-age').value   = '';
  $('student-phone').value = '';
  $('student-group').value = '';
  $('student-edit-id').value = '';
  state.editStudentId = null;
  openModal('modal-student');
});

window.editStudent = (studentId) => {
  const s = state.students.find(x => x.studentId === studentId);
  if (!s) return;
  $('student-modal-title').textContent = '✏️ تعديل بيانات الطالب';
  $('student-name').value   = s.studentName;
  $('student-age').value    = s.age || '';
  $('student-phone').value  = s.parentPhone || '';
  $('student-group').value  = s.groupId || '';
  $('student-edit-id').value = studentId;
  state.editStudentId = studentId;
  openModal('modal-student');
};

$('btn-save-student').addEventListener('click', async () => {
  const name    = $('student-name').value.trim();
  const age     = parseInt($('student-age').value) || null;
  const phone   = $('student-phone').value.trim();
  const groupId = $('student-group').value;
  const editId  = $('student-edit-id').value;

  if (!name || !groupId) { showToast('أدخل الاسم والمجموعة.', 'error'); return; }

  const data = {
    studentName: name,
    age,
    parentPhone: phone,
    groupId,
    enrollmentDate: editId ? (state.students.find(x => x.studentId === editId)?.enrollmentDate || firebase.firestore.FieldValue.serverTimestamp()) : firebase.firestore.FieldValue.serverTimestamp()
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
    renderStudents($('students-group-filter').value);
    renderGroups();
    $('stat-students').textContent = state.students.length;
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
});

// ══════════════════════════════════════════════════════════════
//  SESSIONS
// ══════════════════════════════════════════════════════════════
function renderSessions(filterGroupId = '') {
  const tbody    = $('sessions-tbody');
  let sessions   = filterGroupId ? state.sessions.filter(s => s.groupId === filterGroupId) : state.sessions;

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

$('sessions-group-filter').addEventListener('change', e => {
  renderSessions(e.target.value);
});

$('btn-add-session').addEventListener('click', () => {
  $('session-group').value  = '';
  $('session-number').value = '';
  $('session-date').value   = new Date().toISOString().split('T')[0];
  $('session-topic').value  = '';
  openModal('modal-session');
});

$('btn-save-session').addEventListener('click', async () => {
  const groupId = $('session-group').value;
  const num     = parseInt($('session-number').value);
  const date    = $('session-date').value;
  const topic   = $('session-topic').value.trim();

  if (!groupId || !num || !date) { showToast('أكمل الحقول المطلوبة.', 'error'); return; }

  const data = { groupId, sessionNumber: num, date, topic };
  try {
    const ref = await db.collection('sessions').add(data);
    state.sessions.push({ ...data, sessionId: ref.id });
    state.sessions.sort((a, b) => a.sessionNumber - b.sessionNumber);
    closeModal('modal-session');
    renderSessions($('sessions-group-filter').value);
    $('stat-sessions').textContent = state.sessions.length;
    showToast('تم إضافة الجلسة بنجاح.', 'success');
  } catch (e) { showToast('خطأ: ' + e.message, 'error'); }
});

// ══════════════════════════════════════════════════════════════
//  EVALUATION MATRIX
// ══════════════════════════════════════════════════════════════
$('eval-group-select').addEventListener('change', async function() {
  const groupId = this.value;
  const sessSelect = $('eval-session-select');
  sessSelect.innerHTML = '<option value="">— اختر جلسة —</option>';
  sessSelect.disabled = true;
  $('eval-matrix-container').style.display = 'none';
  $('eval-empty-state').style.display = 'block';

  if (!groupId) return;

  const groupSessions = state.sessions.filter(s => s.groupId === groupId);
  groupSessions.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.sessionId;
    opt.textContent = `جلسة ${s.sessionNumber} — ${s.date} — ${s.topic || ''}`;
    sessSelect.appendChild(opt);
  });
  sessSelect.disabled = false;
});

$('eval-session-select').addEventListener('change', async function() {
  const sessionId = this.value;
  const groupId   = $('eval-group-select').value;
  if (!sessionId || !groupId) return;

  const group   = state.groups.find(g => g.groupId === groupId);
  const session = state.sessions.find(s => s.sessionId === sessionId);
  const students = state.students.filter(s => s.groupId === groupId);

  if (!students.length) {
    showToast('لا يوجد طلاب في هذه المجموعة.', 'info');
    return;
  }

  $('eval-group-label').textContent   = group ? group.groupName : '';
  $('eval-session-label').textContent = session ? `جلسة ${session.sessionNumber}` : '';

  // Load existing evaluations for this session
  const existingEvals = {};
  state.evaluations.filter(ev => ev.sessionId === sessionId).forEach(ev => {
    existingEvals[ev.studentId] = ev;
  });

  const tbody = $('eval-matrix-tbody');
  tbody.innerHTML = students.map(student => {
    const ev = existingEvals[student.studentId] || {};
    const rowId = `row-${student.studentId}`;
    return `
      <tr id="${rowId}" data-student-id="${student.studentId}">
        <td><strong>${student.studentName}</strong></td>
        <td class="eval-checkbox"><input type="checkbox" class="ev-attendance" ${ev.attendance ? 'checked' : ''} onchange="recalcRow('${student.studentId}')" /></td>
        <td class="eval-checkbox"><input type="checkbox" class="ev-participation" ${ev.participation ? 'checked' : ''} onchange="recalcRow('${student.studentId}')" /></td>
        <td class="eval-checkbox"><input type="checkbox" class="ev-application" ${ev.application ? 'checked' : ''} onchange="recalcRow('${student.studentId}')" /></td>
        <td class="eval-checkbox"><input type="checkbox" class="ev-homework" ${ev.homework ? 'checked' : ''} onchange="recalcRow('${student.studentId}')" /></td>
        <td class="eval-checkbox"><input type="checkbox" class="ev-creativity" ${ev.creativity ? 'checked' : ''} onchange="recalcRow('${student.studentId}')" /></td>
        <td class="eval-checkbox penalty-checkbox"><input type="checkbox" class="ev-late" ${ev.latePenalty ? 'checked' : ''} onchange="recalcRow('${student.studentId}')" /></td>
        <td class="eval-checkbox penalty-checkbox"><input type="checkbox" class="ev-nohw" ${ev.homeworkPenalty ? 'checked' : ''} onchange="recalcRow('${student.studentId}')" /></td>
        <td class="score-cell" id="score-${student.studentId}">${ev.totalPoints || 0}</td>
      </tr>`;
  }).join('');

  // Initial score render
  students.forEach(s => recalcRow(s.studentId));

  $('eval-matrix-container').style.display = 'block';
  $('eval-empty-state').style.display = 'none';
});

window.recalcRow = (studentId) => {
  const row   = document.getElementById(`row-${studentId}`);
  if (!row) return;
  const get   = cls => row.querySelector(cls)?.checked || false;

  let points  = 0;
  if (get('.ev-attendance'))   points += SCORE_RULES.attendance;
  if (get('.ev-participation')) points += SCORE_RULES.participation;
  if (get('.ev-application'))  points += SCORE_RULES.application;
  if (get('.ev-homework'))     points += SCORE_RULES.homework;
  if (get('.ev-creativity'))   points += SCORE_RULES.creativity;
  if (get('.ev-late'))         points += SCORE_RULES.latePenalty;
  if (get('.ev-nohw'))         points += SCORE_RULES.homeworkPenalty;

  const cell = document.getElementById(`score-${studentId}`);
  if (cell) {
    cell.textContent = points;
    cell.className   = `score-cell${points < 0 ? ' danger' : points < 20 ? ' warning' : ''}`;
  }
};

$('btn-save-evaluations').addEventListener('click', async () => {
  const sessionId = $('eval-session-select').value;
  const groupId   = $('eval-group-select').value;
  if (!sessionId || !groupId) return;

  const students   = state.students.filter(s => s.groupId === groupId);
  const uid        = state.currentUser.uid;
  const batch      = db.batch();

  const existingMap = {};
  state.evaluations.filter(ev => ev.sessionId === sessionId).forEach(ev => {
    existingMap[ev.studentId] = ev;
  });

  const savedEvals = [];

  students.forEach(student => {
    const row = document.getElementById(`row-${student.studentId}`);
    if (!row) return;
    const get = cls => row.querySelector(cls)?.checked || false;

    const attendance     = get('.ev-attendance');
    const participation  = get('.ev-participation');
    const application    = get('.ev-application');
    const homework       = get('.ev-homework');
    const creativity     = get('.ev-creativity');
    const latePenalty    = get('.ev-late');
    const homeworkPenalty = get('.ev-nohw');

    let total = 0;
    if (attendance)     total += SCORE_RULES.attendance;
    if (participation)  total += SCORE_RULES.participation;
    if (application)    total += SCORE_RULES.application;
    if (homework)       total += SCORE_RULES.homework;
    if (creativity)     total += SCORE_RULES.creativity;
    if (latePenalty)    total += SCORE_RULES.latePenalty;
    if (homeworkPenalty) total += SCORE_RULES.homeworkPenalty;

    const data = {
      studentId: student.studentId,
      sessionId,
      attendance, participation, application,
      homework, creativity, latePenalty, homeworkPenalty,
      totalPoints: total,
      instructorId: uid,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    const existing = existingMap[student.studentId];
    if (existing) {
      const ref = db.collection('evaluations').doc(existing.evaluationId);
      batch.update(ref, data);
      savedEvals.push({ ...data, evaluationId: existing.evaluationId });
    } else {
      const ref = db.collection('evaluations').doc();
      batch.set(ref, data);
      savedEvals.push({ ...data, evaluationId: ref.id });
    }
  });

  try {
    await batch.commit();
    // Merge into state
    savedEvals.forEach(ev => {
      const idx = state.evaluations.findIndex(x => x.evaluationId === ev.evaluationId);
      if (idx !== -1) state.evaluations[idx] = ev;
      else state.evaluations.push(ev);
    });
    showToast('✅ تم حفظ جميع التقييمات بنجاح!', 'success');
  } catch (e) { showToast('خطأ في الحفظ: ' + e.message, 'error'); }
});

// ══════════════════════════════════════════════════════════════
//  BADGE ENGINE
// ══════════════════════════════════════════════════════════════
function computeBadges(totals, evaluations, sessions) {
  // Group students by groupId, compute per-cycle badges (every 4 sessions)
  const badgeMap = {}; // studentId -> Set of badge keys

  state.groups.forEach(group => {
    const groupStudents = state.students.filter(s => s.groupId === group.groupId);
    const groupSessions = sessions.filter(s => s.groupId === group.groupId).sort((a, b) => a.sessionNumber - b.sessionNumber);

    // Split into 4-session cycles
    for (let i = 0; i < groupSessions.length; i += 4) {
      const cycle = groupSessions.slice(i, i + 4);
      if (cycle.length < 4) continue; // Only complete cycles

      const cycleIds = new Set(cycle.map(s => s.sessionId));

      // Collect student stats for this cycle
      const cycleStats = {};
      groupStudents.forEach(s => {
        cycleStats[s.studentId] = {
          total: 0, creativity: 0, attended: 0, hwDone: 0, sessions: 0
        };
      });

      evaluations.forEach(ev => {
        if (!cycleIds.has(ev.sessionId)) return;
        if (!cycleStats[ev.studentId]) return;
        const cs = cycleStats[ev.studentId];
        cs.total     += ev.totalPoints || 0;
        cs.creativity += ev.creativity ? SCORE_RULES.creativity : 0;
        cs.attended   += ev.attendance ? 1 : 0;
        cs.hwDone     += ev.homework ? 1 : 0;
        cs.sessions   += 1;
      });

      const participating = Object.entries(cycleStats).filter(([, v]) => v.sessions > 0);
      if (!participating.length) continue;

      // 🥇 Star of Month — highest total
      const topTotal = participating.reduce((a, b) => b[1].total > a[1].total ? b : a);
      if (!badgeMap[topTotal[0]]) badgeMap[topTotal[0]] = new Set();
      badgeMap[topTotal[0]].add('starOfMonth');

      // 💡 Young Innovator — best creativity score
      const topCreative = participating.reduce((a, b) => b[1].creativity > a[1].creativity ? b : a);
      if (topCreative[1].creativity > 0) {
        if (!badgeMap[topCreative[0]]) badgeMap[topCreative[0]] = new Set();
        badgeMap[topCreative[0]].add('youngInnovator');
      }

      // 🎯 Homework Champion — 100% homework
      participating.forEach(([id, v]) => {
        if (v.hwDone === v.sessions && v.sessions > 0) {
          if (!badgeMap[id]) badgeMap[id] = new Set();
          badgeMap[id].add('homeworkChamp');
        }
      });

      // 🔥 Perfect Attendance
      participating.forEach(([id, v]) => {
        if (v.attended === 4) {
          if (!badgeMap[id]) badgeMap[id] = new Set();
          badgeMap[id].add('perfectAttend');
        }
      });
    }
  });

  // Convert Sets to arrays
  const result = {};
  Object.entries(badgeMap).forEach(([id, set]) => { result[id] = [...set]; });
  return result;
}

// ══════════════════════════════════════════════════════════════
//  REPORTS
// ══════════════════════════════════════════════════════════════
$('report-group-select').addEventListener('change', function() {
  const groupId   = this.value;
  const cycleSelect = $('report-cycle-select');
  const genBtn      = $('btn-generate-report');
  cycleSelect.innerHTML = '<option value="">— اختر الدورة —</option>';
  cycleSelect.disabled = true;
  genBtn.disabled = true;
  $('reports-container').innerHTML = '';

  if (!groupId) return;

  const groupSessions = state.sessions
    .filter(s => s.groupId === groupId)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);

  const cycles = Math.floor(groupSessions.length / 4);
  for (let i = 0; i < cycles; i++) {
    const start = groupSessions[i * 4];
    const end   = groupSessions[i * 4 + 3];
    const opt   = document.createElement('option');
    opt.value   = i;
    opt.textContent = `الدورة ${i + 1} — جلسات ${start.sessionNumber}–${end.sessionNumber} (${start.date} → ${end.date})`;
    cycleSelect.appendChild(opt);
  }

  if (cycles) {
    cycleSelect.disabled = false;
    cycleSelect.addEventListener('change', function() {
      genBtn.disabled = !this.value && this.value !== '0';
    });
  }
});

$('btn-generate-report').addEventListener('click', () => {
  const groupId   = $('report-group-select').value;
  const cycleIdx  = parseInt($('report-cycle-select').value);
  if (!groupId || isNaN(cycleIdx)) return;

  const group     = state.groups.find(g => g.groupId === groupId);
  const students  = state.students.filter(s => s.groupId === groupId);
  const groupSessions = state.sessions
    .filter(s => s.groupId === groupId)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);

  const cycle    = groupSessions.slice(cycleIdx * 4, cycleIdx * 4 + 4);
  const cycleIds = new Set(cycle.map(s => s.sessionId));

  const totals = computeStudentTotals();
  const badges = computeBadges(totals, state.evaluations, state.sessions);

  const container = $('reports-container');
  container.innerHTML = '';

  if (!students.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>لا يوجد طلاب</p></div>';
    return;
  }

  students.forEach(student => {
    const cycleEvals = state.evaluations.filter(ev => ev.studentId === student.studentId && cycleIds.has(ev.sessionId));
    const cycleTotal = cycleEvals.reduce((sum, ev) => sum + (ev.totalPoints || 0), 0);
    const attended   = cycleEvals.filter(ev => ev.attendance).length;
    const hwDone     = cycleEvals.filter(ev => ev.homework).length;
    const creativity = cycleEvals.filter(ev => ev.creativity).length;
    const studentBadges = badges[student.studentId] || [];

    const badgeHTML = studentBadges.map(b => {
      const rule = Object.values(BADGE_RULES).find(r => r.key === b);
      return rule ? `<span class="award-badge">${rule.label}</span>` : '';
    }).join('');

    const progressPercent = Math.min(100, Math.round((cycleTotal / 240) * 100));
    const progressColor   = progressPercent >= 80 ? 'var(--success)' : progressPercent >= 50 ? 'var(--primary)' : 'var(--warning)';

    const cardId = `report-card-${student.studentId}`;
    const card = document.createElement('div');
    card.className = 'report-card';
    card.id = cardId;
    card.innerHTML = `
      <div class="report-header">
        <div class="report-student-info">
          <h3>${student.studentName}</h3>
          <p>المجموعة: ${group ? group.groupName : '—'} | الدورة ${cycleIdx + 1}</p>
          <p style="margin-top:4px;">جلسات ${cycle[0]?.sessionNumber || ''}–${cycle[3]?.sessionNumber || ''}</p>
        </div>
        <div class="report-score-badge">
          <div class="score-num">${cycleTotal}</div>
          <div class="score-label">/ 240 نقطة</div>
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
              <th>الجلسة</th>
              <th>التاريخ</th>
              <th>الحضور</th>
              <th>الواجب</th>
              <th>الإبداع</th>
              <th>النقاط</th>
            </tr>
          </thead>
          <tbody>
            ${cycle.map(sess => {
              const ev = cycleEvals.find(e => e.sessionId === sess.sessionId);
              return `<tr>
                <td>جلسة ${sess.sessionNumber}</td>
                <td>${sess.date || '—'}</td>
                <td>${ev?.attendance ? '✅' : '❌'}</td>
                <td>${ev?.homework ? '✅' : '❌'}</td>
                <td>${ev?.creativity ? '✅' : '—'}</td>
                <td><strong style="color:var(--primary);">${ev?.totalPoints || 0}</strong></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;">
          <div style="flex:1;min-width:120px;background:var(--bg-card-alt);border-radius:var(--radius-sm);padding:12px;text-align:center;">
            <div style="font-size:1.5rem;font-weight:800;color:var(--success);">${attended}/4</div>
            <div style="font-size:0.78rem;color:var(--text-muted);">جلسات الحضور</div>
          </div>
          <div style="flex:1;min-width:120px;background:var(--bg-card-alt);border-radius:var(--radius-sm);padding:12px;text-align:center;">
            <div style="font-size:1.5rem;font-weight:800;color:var(--primary);">${hwDone}/4</div>
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
      </div>
    `;
    container.appendChild(card);
  });

  // Export all as Excel
  const exportAllBtn = document.createElement('div');
  exportAllBtn.style.cssText = 'margin-top:16px;text-align:center;';
  exportAllBtn.innerHTML = `
    <button class="btn btn-secondary btn-lg" onclick="exportGroupExcel('${groupId}','${cycleIdx}')">
      📊 تصدير تقرير المجموعة الكاملة (Excel)
    </button>`;
  container.appendChild(exportAllBtn);

  $('btn-generate-report').disabled = false;
});

// ══════════════════════════════════════════════════════════════
//  EXPORT FUNCTIONS
// ══════════════════════════════════════════════════════════════
window.exportPDF = (cardId, studentName) => {
  const card = document.getElementById(cardId);
  if (!card) return;
  const opt = {
    margin:      [8, 8, 8, 8],
    filename:    `تقرير-${studentName}.pdf`,
    image:       { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(card).save();
  showToast(`جاري تصدير تقرير ${studentName}...`, 'info');
};

window.printReport = (cardId) => {
  const card = document.getElementById(cardId);
  if (!card) return;
  const win = window.open('', '_blank');
  win.document.write(`
    <html dir="rtl"><head>
    <title>تقرير الطالب</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="app.css">
    <style>body{font-family:'Cairo',sans-serif;padding:20px;}.report-actions{display:none;}</style>
    </head><body>
    ${card.outerHTML}
    <script>window.onload=()=>window.print();<\/script>
    </body></html>`);
  win.document.close();
};

window.exportExcel = (studentId, cycleIdx, groupId) => {
  const student  = state.students.find(s => s.studentId === studentId);
  const groupSessions = state.sessions
    .filter(s => s.groupId === groupId)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const cycle    = groupSessions.slice(cycleIdx * 4, cycleIdx * 4 + 4);
  const cycleIds = new Set(cycle.map(s => s.sessionId));
  const cycleEvals = state.evaluations.filter(ev => ev.studentId === studentId && cycleIds.has(ev.sessionId));

  const rows = cycle.map(sess => {
    const ev = cycleEvals.find(e => e.sessionId === sess.sessionId);
    return {
      'الجلسة': `جلسة ${sess.sessionNumber}`,
      'التاريخ': sess.date,
      'الموضوع': sess.topic,
      'الحضور': ev?.attendance ? 'نعم' : 'لا',
      'المشاركة': ev?.participation ? 'نعم' : 'لا',
      'التطبيق': ev?.application ? 'نعم' : 'لا',
      'الواجب': ev?.homework ? 'نعم' : 'لا',
      'الإبداع': ev?.creativity ? 'نعم' : 'لا',
      'تأخر': ev?.latePenalty ? 'نعم' : 'لا',
      'غياب الواجب': ev?.homeworkPenalty ? 'نعم' : 'لا',
      'مجموع النقاط': ev?.totalPoints || 0
    };
  });

  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, student?.studentName || 'تقرير');
  XLSX.writeFile(wb, `تقرير-${student?.studentName || 'طالب'}-الدورة${parseInt(cycleIdx)+1}.xlsx`);
  showToast('تم تصدير ملف Excel بنجاح.', 'success');
};

window.exportGroupExcel = (groupId, cycleIdx) => {
  const group    = state.groups.find(g => g.groupId === groupId);
  const students = state.students.filter(s => s.groupId === groupId);
  const groupSessions = state.sessions
    .filter(s => s.groupId === groupId)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const cycle    = groupSessions.slice(cycleIdx * 4, cycleIdx * 4 + 4);
  const cycleIds = new Set(cycle.map(s => s.sessionId));

  const rows = students.map(student => {
    const cycleEvals = state.evaluations.filter(ev => ev.studentId === student.studentId && cycleIds.has(ev.sessionId));
    const total    = cycleEvals.reduce((s, ev) => s + (ev.totalPoints || 0), 0);
    const attended = cycleEvals.filter(ev => ev.attendance).length;
    const hwDone   = cycleEvals.filter(ev => ev.homework).length;
    const creative = cycleEvals.filter(ev => ev.creativity).length;
    return {
      'اسم الطالب': student.studentName,
      'العمر': student.age,
      'جلسات الحضور': `${attended}/4`,
      'واجبات مكتملة': `${hwDone}/4`,
      'مشاريع إبداعية': creative,
      'مجموع النقاط': total,
      'النسبة': `${Math.min(100, Math.round((total / 240) * 100))}%`
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, group?.groupName || 'المجموعة');
  XLSX.writeFile(wb, `تقرير-${group?.groupName || 'مجموعة'}-الدورة${parseInt(cycleIdx)+1}.xlsx`);
  showToast('تم تصدير تقرير المجموعة بنجاح.', 'success');
};

// ══════════════════════════════════════════════════════════════
//  DELETE CONFIRM
// ══════════════════════════════════════════════════════════════
window.confirmDelete = (type, id, label) => {
  $('confirm-msg').textContent = `هل أنت متأكد من حذف ${label}؟ لا يمكن التراجع عن هذه العملية.`;
  state.deleteCallback = async () => {
    try {
      await deleteEntity(type, id);
      closeModal('modal-confirm');
      showToast(`تم حذف "${label}" بنجاح.`, 'success');
    } catch (e) { showToast('خطأ في الحذف: ' + e.message, 'error'); }
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
    renderStudents($('students-group-filter').value);
    $('stat-students').textContent = state.students.length;
  } else if (type === 'session') {
    await db.collection('sessions').doc(id).delete();
    state.sessions = state.sessions.filter(s => s.sessionId !== id);
    renderSessions($('sessions-group-filter').value);
    $('stat-sessions').textContent = state.sessions.length;
  } else if (type === 'instructor') {
    await db.collection('users').doc(id).delete();
    state.instructors = state.instructors.filter(i => i.userId !== id);
    renderInstructors(); buildSelectDropdowns();
  }
}

$('btn-confirm-delete').addEventListener('click', () => {
  if (state.deleteCallback) state.deleteCallback();
});

// ══════════════════════════════════════════════════════════════
//  THEME TOGGLE
// ══════════════════════════════════════════════════════════════
let darkMode = localStorage.getItem('codingua-theme') === 'dark';
applyTheme();

function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  $('theme-toggle').textContent = darkMode ? '☀️' : '🌙';
}

$('theme-toggle').addEventListener('click', () => {
  darkMode = !darkMode;
  localStorage.setItem('codingua-theme', darkMode ? 'dark' : 'light');
  applyTheme();
});

// ══════════════════════════════════════════════════════════════
//  SIDEBAR NAVIGATION
// ══════════════════════════════════════════════════════════════
$$('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const panel = item.dataset.panel;
    if (!panel) return;
    setActivePanel(panel);
    // Refresh data when navigating to certain panels
    if (panel === 'reports-panel') {
      buildSelectDropdowns();
    }
  });
});

function closeSidebar() {
  if (window.innerWidth <= 768) {
    $('sidebar').classList.remove('open');
    $('sidebar-overlay').classList.remove('open');
  }
}

$('mobile-menu-btn').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
  $('sidebar-overlay').classList.toggle('open');
});

$('sidebar-overlay').addEventListener('click', closeSidebar);

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
    if (e.target === overlay) {
      closeModal(overlay.id);
    }
  });
});
