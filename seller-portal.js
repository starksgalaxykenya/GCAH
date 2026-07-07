// ============================================================
// SELLER PORTAL LOGIC
// ============================================================
import { db } from './firebase-config.js';
import {
    collection, doc, getDoc, getDocs, addDoc, updateDoc, query,
    where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    requireAuth, showToast, showLoading, hideLoading, escapeHtml, money,
    timeAgo, catIcon, pushNotification, CONFIG, runExpiryWatchdog
} from './shared.js';

const State = { user: null, userData: null, listings: [], currentScreen: 'dashboard' };

function navigateTo(screen) {
    State.currentScreen = screen;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.screen === screen));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screen}`)?.classList.add('active');
    loadScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window._navigateTo = navigateTo;

async function loadScreen(screen) {
    switch (screen) {
        case 'dashboard': return loadDashboard();
        case 'listings': return loadListings();
        case 'earnings': return loadEarnings();
        case 'escrow': return loadEscrow();
        case 'profile': return loadProfile();
    }
}

document.getElementById('listing-fee-amount').textContent = money(CONFIG.listingFeeKES);

document.querySelectorAll('#listing-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('#listing-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderListings(tab.dataset.filter);
    });
});

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------
async function loadDashboard() {
    document.getElementById('dash-welcome-name').textContent = State.userData?.displayName || 'User';
    try {
        const snap = await getDocs(query(collection(db, 'auctions'), where('sellerId', '==', State.user.uid), orderBy('createdAt', 'desc')));
        const listings = [];
        snap.forEach(d => listings.push({ id: d.id, ...d.data() }));
        State.listings = listings;
        document.getElementById('stat-listings').textContent = listings.length;
        document.getElementById('stat-live').textContent = listings.filter(l => l.status === 'live').length;
        const sold = listings.filter(l => l.status === 'ended' && l.winningBidderId);
        document.getElementById('stat-sold').textContent = sold.length;
        const revenue = sold.reduce((sum, l) => sum + (l.winningBid || l.currentBid || 0), 0);
        document.getElementById('stat-revenue').textContent = money(revenue);
        const grid = document.getElementById('dash-recent-listings');
        grid.innerHTML = listings.length ? listings.slice(0, 6).map(renderListingCard).join('') : '<p class="text-muted" style="grid-column:1/-1;">You haven\'t listed anything yet.</p>';
    } catch (e) { console.error(e); }
}

// ---------------------------------------------------------
// LISTINGS
// ---------------------------------------------------------
async function loadListings() {
    const grid = document.getElementById('listings-grid');
    try {
        const snap = await getDocs(query(collection(db, 'auctions'), where('sellerId', '==', State.user.uid), orderBy('createdAt', 'desc')));
        State.listings = [];
        snap.forEach(d => State.listings.push({ id: d.id, ...d.data() }));
        renderListings('all');
    } catch (e) { grid.innerHTML = '<p style="color:var(--accent-red);">Error loading listings.</p>'; }
}

function renderListings(filter) {
    const grid = document.getElementById('listings-grid');
    let list = State.listings;
    if (filter && filter !== 'all') list = list.filter(l => l.status === filter);
    grid.innerHTML = list.length ? list.map(renderListingCard).join('') :
        '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-list"></i>No listings in this category.</div>';
}

function renderListingCard(a) {
    const statusMap = {
        pending_inspection: ['badge-pending', 'Pending Inspection'],
        pending_approval: ['badge-pending', 'Pending Approval'],
        live: ['badge-live', '🔴 LIVE'],
        upcoming: ['badge-upcoming', 'Upcoming'],
        ended: ['badge-sold', a.winningBidderId ? 'Sold' : 'Ended (No Sale)'],
        rejected: ['badge-rejected', 'Rejected']
    };
    const [cls, label] = statusMap[a.status] || ['badge-neutral', a.status];
    return `
    <div class="card">
      <div class="card-header"><span style="font-size:2rem;">${catIcon(a.category)}</span><span class="badge ${cls}">${label}</span></div>
      <div class="auction-card-title">${escapeHtml(a.make)} ${escapeHtml(a.model)}</div>
      <div class="auction-card-sub mb-1">${a.year || ''} · ${escapeHtml(a.location || '')}</div>
      <p><strong>Current Bid:</strong> <span class="text-gold" style="font-weight:700;">${money(a.currentBid || a.startingBid)}</span></p>
      <p class="text-muted" style="font-size:0.8rem;">${a.bidCount || 0} bids · listed ${timeAgo(a.createdAt)}</p>
      ${a.status === 'rejected' && a.rejectionReason ? `<p style="color:var(--accent-red);font-size:0.8rem;margin-top:6px;">Reason: ${escapeHtml(a.rejectionReason)}</p>` : ''}
    </div>`;
}

// ---------------------------------------------------------
// CREATE LISTING
// ---------------------------------------------------------
document.getElementById('listing-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const data = {
            category: document.getElementById('listing-category').value,
            make: document.getElementById('listing-make').value.trim(),
            model: document.getElementById('listing-model').value.trim(),
            year: parseInt(document.getElementById('listing-year').value) || null,
            vin: document.getElementById('listing-vin').value.trim(),
            mileage: parseInt(document.getElementById('listing-mileage').value) || null,
            reservePrice: parseFloat(document.getElementById('listing-reserve').value),
            startingBid: parseFloat(document.getElementById('listing-start-bid').value),
            durationHours: parseInt(document.getElementById('listing-duration').value),
            location: document.getElementById('listing-location').value.trim(),
            description: document.getElementById('listing-description').value.trim(),
            sellerId: State.user.uid,
            sellerName: State.userData?.displayName || State.user.email,
            status: 'pending_inspection',
            currentBid: parseFloat(document.getElementById('listing-start-bid').value),
            bidCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            exclusivityAgreed: document.getElementById('listing-exclusivity').checked,
            listingFee: CONFIG.listingFeeKES,
            sealId: null, inspectionId: null, inspectionCompleted: false, mileageAtInspection: null, endTime: null
        };
        const ref = await addDoc(collection(db, 'auctions'), data);
        // Auto-create an inspection assignment queued for an inspector to pick up.
        await addDoc(collection(db, 'inspections'), {
            auctionId: ref.id, assetMake: data.make, assetModel: data.model, location: data.location,
            durationHours: data.durationHours, status: 'unassigned', inspectorId: null, inspectorName: null,
            createdAt: serverTimestamp()
        });
        showToast(`✅ Asset listed! Inspector will be dispatched. Fee: ${money(CONFIG.listingFeeKES)}.`, 'success');
        document.getElementById('listing-form').reset();
        navigateTo('dashboard');
    } catch (er) { showToast('Error: ' + er.message, 'error'); }
    finally { hideLoading(); }
});

// ---------------------------------------------------------
// EARNINGS
// ---------------------------------------------------------
async function loadEarnings() {
    try {
        const snap = await getDocs(query(collection(db, 'escrow'), where('sellerId', '==', State.user.uid), orderBy('createdAt', 'desc')));
        const records = [];
        snap.forEach(d => records.push({ id: d.id, ...d.data() }));
        let available = 0, pending = 0, lifetime = 0;
        records.forEach(r => {
            const net = (r.amount || 0) - (r.platformFee || 0);
            lifetime += net;
            if (r.status === 'released_to_seller') available += 0; // already paid out, counted below via payouts
            else pending += net;
        });
        const paySnap = await getDocs(query(collection(db, 'payouts'), where('sellerId', '==', State.user.uid), orderBy('createdAt', 'desc')));
        const payouts = [];
        paySnap.forEach(d => payouts.push({ id: d.id, ...d.data() }));
        const releasedNotPaid = records.filter(r => r.status === 'released_to_seller');
        const paidEscrowIds = new Set(payouts.filter(p => p.status !== 'rejected').map(p => p.escrowId));
        available = releasedNotPaid.filter(r => !paidEscrowIds.has(r.id)).reduce((sum, r) => sum + ((r.amount || 0) - (r.platformFee || 0)), 0);

        document.getElementById('earn-available').textContent = money(available);
        document.getElementById('earn-pending').textContent = money(pending);
        document.getElementById('earn-lifetime').textContent = money(lifetime);

        const tbody = document.getElementById('payout-tbody');
        tbody.innerHTML = payouts.length ? payouts.map(p => `
            <tr><td>${p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : ''}</td>
            <td>${escapeHtml(p.assetLabel || '-')}</td><td>${money(p.amount)}</td>
            <td><span class="badge ${p.status === 'paid' ? 'badge-sold' : p.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}">${p.status}</span></td></tr>
        `).join('') : '<tr><td colspan="4" class="text-muted">No payout requests yet.</td></tr>';

        State._availableEscrowRecords = releasedNotPaid.filter(r => !paidEscrowIds.has(r.id));
    } catch (e) { console.error(e); showToast('Error loading earnings: ' + e.message, 'error'); }
}

async function requestPayout() {
    const records = State._availableEscrowRecords || [];
    if (!records.length) { showToast('No released funds available for payout yet.', 'info'); return; }
    showLoading();
    try {
        for (const r of records) {
            await addDoc(collection(db, 'payouts'), {
                sellerId: State.user.uid, sellerName: State.userData?.displayName, escrowId: r.id,
                assetLabel: `${r.auctionMake || ''} ${r.auctionModel || ''}`.trim(),
                amount: (r.amount || 0) - (r.platformFee || 0), status: 'requested', createdAt: serverTimestamp()
            });
        }
        showToast('Payout request submitted! Admin will process it shortly.', 'success');
        loadEarnings();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._requestPayout = requestPayout;

// ---------------------------------------------------------
// ESCROW
// ---------------------------------------------------------
async function loadEscrow() {
    const container = document.getElementById('escrow-list');
    try {
        const snap = await getDocs(query(collection(db, 'escrow'), where('sellerId', '==', State.user.uid), orderBy('createdAt', 'desc'), limit(20)));
        const records = [];
        snap.forEach(d => records.push({ id: d.id, ...d.data() }));
        if (!records.length) { container.innerHTML = '<p class="text-muted" style="grid-column:1/-1;">No escrow records yet.</p>'; return; }
        const order = ['initiated', 'funds_held', 'asset_delivered', 'buyer_approved', 'released_to_seller'];
        container.innerHTML = records.map(esc => {
            const idx = order.indexOf(esc.status);
            const stepClass = (s) => order.indexOf(s) < idx ? 'completed' : order.indexOf(s) === idx ? 'active' : '';
            return `
            <div class="card">
              <div class="card-header"><span class="card-title">💼 #${esc.id.slice(-6)}</span><span class="badge badge-escrow">${esc.status.replace(/_/g, ' ').toUpperCase()}</span></div>
              <p><strong>Gross Amount:</strong> ${money(esc.amount)}</p>
              <p><strong>Platform Fee:</strong> -${money(esc.platformFee)}</p>
              <p><strong>Net Payout:</strong> <span class="text-green" style="font-weight:700;">${money((esc.amount || 0) - (esc.platformFee || 0))}</span></p>
              <div class="escrow-steps"><div class="escrow-connector"></div>
                ${order.map(s => `<div class="escrow-step ${stepClass(s)}"><div class="escrow-step-dot">${order.indexOf(s) + 1}</div><div class="escrow-step-label">${s.replace(/_/g, ' ')}</div></div>`).join('')}
              </div>
              ${esc.disputeRaised ? '<p style="color:var(--accent-red);"><strong>⚠ Dispute open:</strong> ' + escapeHtml(esc.disputeReason || '') + '</p>' : ''}
            </div>`;
        }).join('');
    } catch (e) { container.innerHTML = '<p style="color:var(--accent-red);">Error loading escrow.</p>'; }
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
      <span class="badge badge-upcoming">SELLER</span>
    </div>
    <div class="grid-2">
      <div class="stat-card"><div class="stat-value">${State.listings.length}</div><div class="stat-label">Total Listings</div></div>
      <div class="stat-card"><div class="stat-value">${u.reputation || 100}%</div><div class="stat-label">Reputation</div></div>
      <div class="stat-card"><div class="stat-value">${u.kycVerified ? '✅' : '⏳'}</div><div class="stat-label">KYC Status</div></div>
      <div class="stat-card"><div class="stat-value">${u.createdAt?.toDate ? u.createdAt.toDate().getFullYear() : '-'}</div><div class="stat-label">Member Since</div></div>
    </div>`;
    document.getElementById('edit-name').value = u.displayName || '';
    document.getElementById('edit-phone').value = u.phone || '';
    document.getElementById('edit-payout').value = u.payoutDetails || '';
}

document.getElementById('profile-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const name = document.getElementById('edit-name').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        const payoutDetails = document.getElementById('edit-payout').value.trim();
        await updateDoc(doc(db, 'users', State.user.uid), { displayName: name, phone, payoutDetails, updatedAt: serverTimestamp() });
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
    allowedRoles: ['seller'],
    onReady: (user, userData) => {
        State.user = user;
        State.userData = userData;
        navigateTo('dashboard');
        runExpiryWatchdog();
        setInterval(runExpiryWatchdog, 30000);
        hideLoading();
    }
});
