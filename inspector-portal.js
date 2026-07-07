// ============================================================
// INSPECTOR PORTAL LOGIC
// ============================================================
import { db } from './firebase-config.js';
import {
    collection, doc, getDoc, getDocs, updateDoc, query,
    where, orderBy, limit, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    requireAuth, showToast, showLoading, hideLoading, escapeHtml, money,
    timeAgo, pushNotification
} from './shared.js';

const State = { user: null, userData: null, currentScreen: 'dashboard' };

function navigateTo(screen) {
    State.currentScreen = screen;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.screen === screen));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screen}`)?.classList.add('active');
    loadScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window._navigateTo = navigateTo;
window._claimJob = claimJob;
window._completeInspection = completeInspection;

async function loadScreen(screen) {
    switch (screen) {
        case 'dashboard': return loadDashboard();
        case 'queue': return loadQueue();
        case 'assignments': return loadAssignments();
        case 'history': return loadHistory();
        case 'profile': return loadProfile();
    }
}

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------
async function loadDashboard() {
    document.getElementById('dash-welcome-name').textContent = State.userData?.displayName || 'User';
    try {
        const queueSnap = await getDocs(query(collection(db, 'inspections'), where('status', '==', 'unassigned')));
        document.getElementById('stat-queue').textContent = queueSnap.size;

        const assignedSnap = await getDocs(query(collection(db, 'inspections'), where('inspectorId', '==', State.user.uid), where('status', '==', 'assigned')));
        document.getElementById('stat-assigned').textContent = assignedSnap.size;

        const completedSnap = await getDocs(query(collection(db, 'inspections'), where('inspectorId', '==', State.user.uid), where('status', '==', 'completed')));
        document.getElementById('stat-completed').textContent = completedSnap.size;
        document.getElementById('stat-rating').textContent = (State.userData?.reputation || 100) + '%';

        const assigned = [];
        assignedSnap.forEach(d => assigned.push({ id: d.id, ...d.data() }));
        const grid = document.getElementById('dash-assignments');
        grid.innerHTML = assigned.length ? assigned.slice(0, 4).map(renderAssignmentCard).join('') : '<p class="text-muted" style="grid-column:1/-1;">No assignments right now — check the Job Queue.</p>';
    } catch (e) { console.error(e); }
}

// ---------------------------------------------------------
// QUEUE (unassigned jobs)
// ---------------------------------------------------------
async function loadQueue() {
    const grid = document.getElementById('queue-grid');
    try {
        const snap = await getDocs(query(collection(db, 'inspections'), where('status', '==', 'unassigned'), orderBy('createdAt', 'desc'), limit(30)));
        const jobs = [];
        snap.forEach(d => jobs.push({ id: d.id, ...d.data() }));
        grid.innerHTML = jobs.length ? jobs.map(renderQueueCard).join('') :
            '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-inbox"></i>No pending jobs — the queue is clear!</div>';
    } catch (e) { grid.innerHTML = '<p style="color:var(--accent-red);">Error loading queue.</p>'; }
}

function renderQueueCard(j) {
    return `
    <div class="card">
      <div class="card-header"><span class="card-title">🔍 ${escapeHtml(j.assetMake || '')} ${escapeHtml(j.assetModel || '')}</span><span class="badge badge-pending">Unassigned</span></div>
      <p><strong>Location:</strong> ${escapeHtml(j.location || 'TBA')}</p>
      <p class="text-muted" style="font-size:0.8rem;">Requested ${timeAgo(j.createdAt)}</p>
      <button class="btn btn-primary btn-sm mt-2" onclick="window._claimJob('${j.id}')"><i class="fas fa-hand-paper"></i> Claim Job</button>
    </div>`;
}

async function claimJob(inspectionId) {
    showLoading();
    try {
        await updateDoc(doc(db, 'inspections', inspectionId), {
            status: 'assigned', inspectorId: State.user.uid, inspectorName: State.userData?.displayName || State.user.email,
            assignedAt: serverTimestamp()
        });
        showToast('Job claimed! Find it under "My Assignments".', 'success');
        loadQueue();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}

// ---------------------------------------------------------
// MY ASSIGNMENTS
// ---------------------------------------------------------
async function loadAssignments() {
    const grid = document.getElementById('assignments-grid');
    try {
        const snap = await getDocs(query(collection(db, 'inspections'), where('inspectorId', '==', State.user.uid), where('status', '==', 'assigned'), orderBy('assignedAt', 'desc')));
        const jobs = [];
        snap.forEach(d => jobs.push({ id: d.id, ...d.data() }));
        grid.innerHTML = jobs.length ? jobs.map(renderAssignmentCard).join('') :
            '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-clipboard-check"></i>No active assignments. Visit the Job Queue to pick one up.</div>';
    } catch (e) { grid.innerHTML = '<p style="color:var(--accent-red);">Error loading assignments.</p>'; }
}

function renderAssignmentCard(j) {
    return `
    <div class="card">
      <div class="card-header"><span class="card-title">🔍 ${escapeHtml(j.assetMake || '')} ${escapeHtml(j.assetModel || '')}</span><span class="badge badge-upcoming">Assigned</span></div>
      <p><strong>Location:</strong> ${escapeHtml(j.location || 'TBA')}</p>
      <p class="text-muted" style="font-size:0.8rem;">Claimed ${timeAgo(j.assignedAt)}</p>
      <button class="btn btn-success btn-sm mt-2" onclick="window._completeInspection('${j.id}')"><i class="fas fa-check"></i> Complete Inspection</button>
    </div>`;
}

async function completeInspection(inspectionId) {
    const reading = prompt('Enter current mileage/hours reading:');
    if (!reading || isNaN(parseInt(reading))) { showToast('A valid mileage/hours reading is required.', 'warning'); return; }
    const notes = prompt('Inspector notes (condition summary):') || 'Inspection completed. Seal applied.';
    showLoading();
    try {
        const sealId = 'GCAH-SEAL-' + Date.now().toString(36).toUpperCase();
        const inspRef = doc(db, 'inspections', inspectionId);
        await updateDoc(inspRef, {
            status: 'completed', mileageReading: parseInt(reading), sealId,
            completedAt: serverTimestamp(), inspectorNotes: notes
        });
        const inspDoc = await getDoc(inspRef);
        const auctionId = inspDoc.data().auctionId;
        if (auctionId) {
            const endTime = new Date();
            endTime.setHours(endTime.getHours() + (inspDoc.data().durationHours || 48));
            const auctionRef = doc(db, 'auctions', auctionId);
            const auctionSnap = await getDoc(auctionRef);
            await updateDoc(auctionRef, {
                status: 'live', inspectionCompleted: true, inspectionId,
                sealId, mileageAtInspection: parseInt(reading),
                endTime: Timestamp.fromDate(endTime), updatedAt: serverTimestamp()
            });
            if (auctionSnap.exists()) {
                pushNotification(auctionSnap.data().sellerId, {
                    title: 'Inspection complete!', type: 'success',
                    message: `${auctionSnap.data().make} ${auctionSnap.data().model} passed inspection and is now LIVE.`,
                    link: 'seller-portal.html'
                });
            }
        }
        showToast('✅ Inspection complete! Seal: ' + sealId, 'success');
        loadAssignments();
        loadDashboard();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}

// ---------------------------------------------------------
// HISTORY
// ---------------------------------------------------------
async function loadHistory() {
    const tbody = document.getElementById('history-tbody');
    try {
        const snap = await getDocs(query(collection(db, 'inspections'), where('inspectorId', '==', State.user.uid), where('status', '==', 'completed'), orderBy('completedAt', 'desc'), limit(50)));
        const jobs = [];
        snap.forEach(d => jobs.push({ id: d.id, ...d.data() }));
        tbody.innerHTML = jobs.length ? jobs.map(j => `
            <tr><td>${escapeHtml(j.assetMake || '')} ${escapeHtml(j.assetModel || '')}</td>
            <td>${escapeHtml(j.location || '')}</td>
            <td>${j.mileageReading ? j.mileageReading.toLocaleString() : '-'}</td>
            <td><span class="seal-verified" style="font-size:0.7rem;">🔒 ${j.sealId || ''}</span></td>
            <td>${timeAgo(j.completedAt)}</td></tr>
        `).join('') : '<tr><td colspan="5" class="text-muted">No completed inspections yet.</td></tr>';
    } catch (e) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--accent-red);">Error loading history.</td></tr>'; }
}

// ---------------------------------------------------------
// PROFILE
// ---------------------------------------------------------
async function loadProfile() {
    const container = document.getElementById('profile-content');
    const u = State.userData;
    if (!u) { container.innerHTML = '<p style="color:var(--accent-red);">Unable to load profile.</p>'; return; }
    container.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="width:80px;height:80px;border-radius:50%;background:var(--gradient-gold);display:inline-flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;color:#1a1a1a;">${(u.displayName || 'U').charAt(0).toUpperCase()}</div>
      <h3 style="margin-top:12px;">${escapeHtml(u.displayName || 'User')}</h3>
      <p class="text-muted">${escapeHtml(u.email)}</p>
      <span class="badge badge-live">INSPECTOR</span>
    </div>
    <div class="grid-2">
      <div class="stat-card"><div class="stat-value">${u.reputation || 100}%</div><div class="stat-label">Reputation</div></div>
      <div class="stat-card"><div class="stat-value">${u.kycVerified ? '✅' : '⏳'}</div><div class="stat-label">KYC Status</div></div>
    </div>`;
    document.getElementById('edit-name').value = u.displayName || '';
    document.getElementById('edit-phone').value = u.phone || '';
    document.getElementById('edit-area').value = u.coverageArea || '';
}

document.getElementById('profile-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const name = document.getElementById('edit-name').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        const coverageArea = document.getElementById('edit-area').value.trim();
        await updateDoc(doc(db, 'users', State.user.uid), { displayName: name, phone, coverageArea, updatedAt: serverTimestamp() });
        State.userData.displayName = name;
        document.getElementById('nav-user-name').textContent = name;
        document.getElementById('nav-avatar').textContent = name.charAt(0).toUpperCase();
        showToast('Profile updated!', 'success');
        loadProfile();
    } catch (e2) { showToast('Error: ' + e2.message, 'error'); }
    finally { hideLoading(); }
});

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
requireAuth({
    allowedRoles: ['inspector'],
    onReady: (user, userData) => {
        State.user = user;
        State.userData = userData;
        navigateTo('dashboard');
        hideLoading();
    }
});
