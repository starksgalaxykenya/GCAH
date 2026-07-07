// ============================================================
// ADMIN PORTAL LOGIC
// ============================================================
import { db } from './firebase-config.js';
import {
    collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query,
    where, orderBy, limit, serverTimestamp, increment, Timestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    requireAuth, showToast, showLoading, hideLoading, escapeHtml, money,
    timeAgo, catIcon, pushNotification, CONFIG
} from './shared.js';

const State = {
    user: null, userData: null, currentScreen: 'overview',
    users: [], auctions: [], stock: [], inspections: [], escrow: [], payouts: [], orders: [], inspectors: []
};

function navigateTo(screen) {
    State.currentScreen = screen;
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.toggle('active', l.dataset.screen === screen));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screen}`)?.classList.add('active');
    loadScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
window._navigateTo = navigateTo;

async function loadScreen(screen) {
    switch (screen) {
        case 'overview': return loadOverview();
        case 'users': return loadUsers();
        case 'auctions': return loadAdminAuctions();
        case 'stock': return loadAdminStock();
        case 'inspections': return loadAdminInspections();
        case 'escrow': return loadAdminEscrow();
        case 'payouts': return loadPayouts();
        case 'orders': return loadAdminOrders();
        case 'settings': return loadSettings();
    }
}

function closeModal() { document.getElementById('modal-container').innerHTML = ''; }
window._closeModal = closeModal;

// =========================================================
// OVERVIEW
// =========================================================
async function loadOverview() {
    try {
        const [usersSnap, auctionsSnap, escrowSnap, stockSnap, inspSnap, disputesSnap, payoutsSnap] = await Promise.all([
            getDocs(collection(db, 'users')),
            getDocs(collection(db, 'auctions')),
            getDocs(collection(db, 'escrow')),
            getDocs(collection(db, 'stock')),
            getDocs(query(collection(db, 'inspections'), where('status', '==', 'unassigned'))),
            getDocs(query(collection(db, 'disputes'), where('status', '==', 'open'))),
            getDocs(query(collection(db, 'payouts'), where('status', '==', 'requested')))
        ]);

        document.getElementById('ov-users').textContent = usersSnap.size;

        const auctions = [];
        auctionsSnap.forEach(d => auctions.push({ id: d.id, ...d.data() }));
        document.getElementById('ov-live').textContent = auctions.filter(a => a.status === 'live').length;

        const ended = auctions.filter(a => a.status === 'ended' && a.winningBidderId);
        const gmv = ended.reduce((sum, a) => sum + (a.winningBid || a.currentBid || 0), 0);
        document.getElementById('ov-gmv').textContent = money(gmv);

        let feesTotal = 0;
        escrowSnap.forEach(d => feesTotal += (d.data().platformFee || 0));
        document.getElementById('ov-fees').textContent = money(feesTotal);

        document.getElementById('ov-pending-insp').textContent = inspSnap.size;
        document.getElementById('ov-disputes').textContent = disputesSnap.size;
        document.getElementById('ov-payouts').textContent = payoutsSnap.size;

        let stockValue = 0;
        stockSnap.forEach(d => { const s = d.data(); stockValue += (s.price || 0) * (s.quantity || 0); });
        document.getElementById('ov-stock-value').textContent = money(stockValue);

        const byCat = {};
        auctions.forEach(a => { byCat[a.category] = (byCat[a.category] || 0) + 1; });
        const max = Math.max(1, ...Object.values(byCat));
        const chart = document.getElementById('ov-category-chart');
        const entries = CONFIG.categories.map(c => ({ ...c, count: byCat[c.value] || 0 }));
        chart.innerHTML = entries.map(c => `
            <div class="flex-between mb-1">
                <span style="width:140px;font-size:0.85rem;">${c.icon} ${c.label}</span>
                <div class="progress-bar" style="flex:1;"><div class="progress-bar-fill" style="width:${(c.count / max) * 100}%;"></div></div>
                <span style="width:30px;text-align:right;font-size:0.8rem;color:var(--text-muted);">${c.count}</span>
            </div>`).join('');
    } catch (e) { showToast('Error loading overview: ' + e.message, 'error'); }
}

// =========================================================
// USERS
// =========================================================
async function loadUsers() {
    try {
        const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
        State.users = [];
        snap.forEach(d => State.users.push({ id: d.id, ...d.data() }));
        renderUsers('all');
    } catch (e) { document.getElementById('users-tbody').innerHTML = `<tr><td colspan="6" style="color:var(--accent-red);">${escapeHtml(e.message)}</td></tr>`; }
}
document.querySelectorAll('#user-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('#user-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderUsers(tab.dataset.filter);
    });
});
function applyUserSearch() { renderUsers(document.querySelector('#user-tabs .tab.active')?.dataset.filter || 'all'); }
window._filterUsers = applyUserSearch;

function renderUsers(filter) {
    let list = State.users;
    if (filter !== 'all') list = list.filter(u => u.role === filter);
    const search = (document.getElementById('user-search')?.value || '').toLowerCase().trim();
    if (search) list = list.filter(u => `${u.displayName} ${u.email}`.toLowerCase().includes(search));
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = list.length ? list.map(u => `
        <tr>
          <td><span class="avatar-sm">${(u.displayName || 'U').charAt(0).toUpperCase()}</span>${escapeHtml(u.displayName || 'User')}<br><span class="text-muted" style="font-size:0.75rem;">${escapeHtml(u.email)}</span></td>
          <td><span class="badge badge-neutral">${(u.role || 'buyer').toUpperCase()}</span>${u.suspended ? ' <span class="badge badge-rejected">Suspended</span>' : ''}</td>
          <td>${u.kycVerified ? '✅ Verified' : '⏳ Pending'}</td>
          <td>${u.reputation || 100}%</td>
          <td>${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : '-'}</td>
          <td style="white-space:nowrap;">
            ${!u.kycVerified ? `<button class="btn btn-sm btn-success" onclick="window._toggleKyc('${u.id}',true)"><i class="fas fa-check"></i></button>` : `<button class="btn btn-sm btn-secondary" onclick="window._toggleKyc('${u.id}',false)">Unverify</button>`}
            <button class="btn btn-sm ${u.suspended ? 'btn-success' : 'btn-danger'}" onclick="window._toggleSuspend('${u.id}',${!u.suspended})">${u.suspended ? 'Unsuspend' : 'Suspend'}</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="6" class="text-muted">No users match.</td></tr>';
}

async function toggleKyc(uid, verified) {
    showLoading();
    try {
        await updateDoc(doc(db, 'users', uid), { kycVerified: verified, updatedAt: serverTimestamp() });
        pushNotification(uid, { title: verified ? 'KYC Verified' : 'KYC Verification Reset', type: verified ? 'success' : 'info', message: verified ? 'Your identity has been verified by Galaxy CAH.' : 'Your KYC status was reset. Please contact support.' });
        showToast('User KYC updated.', 'success');
        loadUsers();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._toggleKyc = toggleKyc;

async function toggleSuspend(uid, suspend) {
    if (suspend && !confirm('Suspend this user? They will be signed out and blocked from logging in.')) return;
    showLoading();
    try {
        await updateDoc(doc(db, 'users', uid), { suspended: suspend, updatedAt: serverTimestamp() });
        showToast(suspend ? 'User suspended.' : 'User reinstated.', 'success');
        loadUsers();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._toggleSuspend = toggleSuspend;

// =========================================================
// AUCTIONS
// =========================================================
async function loadAdminAuctions() {
    try {
        const snap = await getDocs(query(collection(db, 'auctions'), orderBy('createdAt', 'desc'), limit(100)));
        State.auctions = [];
        snap.forEach(d => State.auctions.push({ id: d.id, ...d.data() }));
        renderAdminAuctions('all');
    } catch (e) { document.getElementById('admin-auctions-grid').innerHTML = `<p style="color:var(--accent-red);">${escapeHtml(e.message)}</p>`; }
}
document.querySelectorAll('#auction-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('#auction-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderAdminAuctions(tab.dataset.filter);
    });
});

function renderAdminAuctions(filter) {
    let list = State.auctions;
    if (filter !== 'all') list = list.filter(a => a.status === filter);
    const grid = document.getElementById('admin-auctions-grid');
    grid.innerHTML = list.length ? list.map(a => `
    <div class="card">
      <div class="card-header"><span style="font-size:1.8rem;">${catIcon(a.category)}</span><span class="badge ${a.status === 'live' ? 'badge-live' : a.status === 'ended' ? 'badge-sold' : a.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}">${a.status.replace(/_/g, ' ')}</span></div>
      <div class="auction-card-title">${escapeHtml(a.make)} ${escapeHtml(a.model)} ${a.featured ? '⭐' : ''}</div>
      <p class="text-muted" style="font-size:0.8rem;">Seller: ${escapeHtml(a.sellerName || '-')}</p>
      <p><strong>Bid:</strong> ${money(a.currentBid || a.startingBid)} · ${a.bidCount || 0} bids</p>
      <div class="flex" style="gap:6px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-sm btn-secondary" onclick="window._toggleFeature('${a.id}',${!a.featured})">${a.featured ? 'Unfeature' : '⭐ Feature'}</button>
        ${a.status === 'pending_inspection' || a.status === 'upcoming' ? `<button class="btn btn-sm btn-danger" onclick="window._rejectAuction('${a.id}')">Reject</button>` : ''}
        ${a.status === 'live' ? `<button class="btn btn-sm btn-danger" onclick="window._forceEndAuction('${a.id}')">Force End</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="window._deleteAuction('${a.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('') : '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-gavel"></i>No auctions in this category.</div>';
}

async function toggleFeature(id, featured) {
    try { await updateDoc(doc(db, 'auctions', id), { featured, updatedAt: serverTimestamp() }); showToast(featured ? 'Auction featured.' : 'Auction unfeatured.', 'success'); loadAdminAuctions(); }
    catch (e) { showToast('Error: ' + e.message, 'error'); }
}
window._toggleFeature = toggleFeature;

async function rejectAuction(id) {
    const reason = prompt('Reason for rejecting this listing:');
    if (!reason) return;
    showLoading();
    try {
        const snap = await getDoc(doc(db, 'auctions', id));
        await updateDoc(doc(db, 'auctions', id), { status: 'rejected', rejectionReason: reason, updatedAt: serverTimestamp() });
        if (snap.exists()) pushNotification(snap.data().sellerId, { title: 'Listing rejected', type: 'error', message: `${snap.data().make} ${snap.data().model}: ${reason}` });
        showToast('Auction rejected.', 'success');
        loadAdminAuctions();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._rejectAuction = rejectAuction;

async function forceEndAuction(id) {
    if (!confirm('Force-end this auction now? The current highest bidder will win (if above reserve).')) return;
    showLoading();
    try { await settleAuction(id); showToast('Auction force-ended.', 'success'); loadAdminAuctions(); }
    catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._forceEndAuction = forceEndAuction;

async function deleteAuction(id) {
    if (!confirm('Permanently delete this auction listing? This cannot be undone.')) return;
    showLoading();
    try { await deleteDoc(doc(db, 'auctions', id)); showToast('Auction deleted.', 'success'); loadAdminAuctions(); }
    catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._deleteAuction = deleteAuction;

// Shared settlement logic (also used by the background expiry checker)
async function settleAuction(auctionId) {
    const aRef = doc(db, 'auctions', auctionId);
    const aSnap = await getDoc(aRef);
    if (!aSnap.exists()) return;
    const a = aSnap.data();
    const bidsSnap = await getDocs(query(collection(db, 'bids'), where('auctionId', '==', auctionId), orderBy('amount', 'desc'), limit(1)));
    let winnerId = null, winnerName = null, winBid = a.currentBid || a.startingBid || 0;
    bidsSnap.forEach(b => { winnerId = b.data().userId; winnerName = b.data().bidderName; winBid = b.data().amount; });
    const update = { status: 'ended', winningBid: winBid, endedAt: serverTimestamp(), updatedAt: serverTimestamp() };
    if (winnerId && winBid >= (a.reservePrice || 0)) {
        update.winningBidderId = winnerId;
        update.winningBidderName = winnerName;
        await updateDoc(aRef, update);
        await addDoc(collection(db, 'escrow'), {
            auctionId, auctionMake: a.make, auctionModel: a.model,
            buyerId: winnerId, sellerId: a.sellerId, amount: winBid,
            platformFee: Math.round(winBid * CONFIG.platformFeePercent), status: 'initiated',
            participants: [winnerId, a.sellerId], createdAt: serverTimestamp(),
            ntsaTransferStatus: 'pending', disputeRaised: false
        });
        if (winnerId) await updateDoc(doc(db, 'users', winnerId), { totalWon: increment(1) });
        if (winnerId) pushNotification(winnerId, { title: 'You won the auction!', type: 'success', message: `${a.make} ${a.model} for ${money(winBid)}. Check your Escrow tab.` });
        pushNotification(a.sellerId, { title: 'Your asset sold!', type: 'success', message: `${a.make} ${a.model} sold for ${money(winBid)}.` });
    } else {
        update.winningBidderId = null; update.winningBidderName = null;
        await updateDoc(aRef, update);
        pushNotification(a.sellerId, { title: 'Auction ended without a sale', type: 'info', message: `${a.make} ${a.model} did not meet reserve price.` });
    }
}

// =========================================================
// OWN STOCK (auction-house-owned inventory)
// =========================================================
async function loadAdminStock() {
    try {
        const snap = await getDocs(query(collection(db, 'stock'), orderBy('createdAt', 'desc')));
        State.stock = [];
        snap.forEach(d => State.stock.push({ id: d.id, ...d.data() }));
        renderAdminStock();
    } catch (e) { document.getElementById('admin-stock-grid').innerHTML = `<p style="color:var(--accent-red);">${escapeHtml(e.message)}</p>`; }
}

function renderAdminStock() {
    const grid = document.getElementById('admin-stock-grid');
    grid.innerHTML = State.stock.length ? State.stock.map(s => `
    <div class="stock-card">
      <div class="stock-card-image"><span style="font-size:3rem;">${catIcon(s.category)}</span>
        <div class="overlay-badge"><span class="badge ${s.status === 'available' ? 'badge-instock' : s.status === 'archived' ? 'badge-neutral' : 'badge-outofstock'}">${s.status}</span></div>
      </div>
      <div class="stock-card-body">
        <div class="auction-card-title">${escapeHtml(s.make)} ${escapeHtml(s.model)}</div>
        <div class="stock-price">${money(s.price)}</div>
        <div class="stock-qty">${s.quantity || 0} in stock</div>
        <div class="flex" style="gap:6px;margin-top:10px;">
          <button class="btn btn-sm btn-secondary" onclick="window._openStockForm('${s.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger" onclick="window._deleteStock('${s.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </div>`).join('') : '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-store"></i>No stock items yet. Add the first one!</div>';
}

function openStockForm(id) {
    const item = id ? State.stock.find(s => s.id === id) : null;
    document.getElementById('modal-container').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) window._closeModal()">
      <div class="modal">
        <div class="modal-header"><span class="card-title">${item ? 'Edit' : 'Add'} Stock Item</span><button class="modal-close" onclick="window._closeModal()">&times;</button></div>
        <form id="stock-form">
          <div class="grid-2">
            <div class="form-group"><label class="form-label">Category *</label>
              <select class="form-select" id="stock-category" required>
                ${CONFIG.categories.map(c => `<option value="${c.value}" ${item?.category === c.value ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label class="form-label">Condition</label>
              <select class="form-select" id="stock-condition">
                <option ${item?.condition === 'New' ? 'selected' : ''}>New</option>
                <option ${item?.condition === 'Used - Excellent' ? 'selected' : ''}>Used - Excellent</option>
                <option ${item?.condition === 'Used - Good' ? 'selected' : ''}>Used - Good</option>
                <option ${item?.condition === 'Used - Fair' ? 'selected' : ''}>Used - Fair</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Make *</label><input type="text" class="form-input" id="stock-make" value="${escapeHtml(item?.make || '')}" required></div>
            <div class="form-group"><label class="form-label">Model *</label><input type="text" class="form-input" id="stock-model" value="${escapeHtml(item?.model || '')}" required></div>
            <div class="form-group"><label class="form-label">Year</label><input type="number" class="form-input" id="stock-year" value="${item?.year || ''}"></div>
            <div class="form-group"><label class="form-label">Location</label><input type="text" class="form-input" id="stock-location" value="${escapeHtml(item?.location || 'Galaxy CAH Warehouse')}"></div>
            <div class="form-group"><label class="form-label">Unit Price (KES) *</label><input type="number" class="form-input" id="stock-price" value="${item?.price || ''}" required min="1"></div>
            <div class="form-group"><label class="form-label">Quantity *</label><input type="number" class="form-input" id="stock-qty" value="${item?.quantity ?? 1}" required min="0"></div>
          </div>
          <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="stock-description">${escapeHtml(item?.description || '')}</textarea></div>
          <button type="submit" class="btn btn-primary btn-block">${item ? 'Save Changes' : 'Add to Inventory'}</button>
        </form>
      </div>
    </div>`;
    document.getElementById('stock-form').addEventListener('submit', (e) => saveStock(e, id));
}
window._openStockForm = openStockForm;

async function saveStock(e, id) {
    e.preventDefault();
    showLoading();
    try {
        const qty = parseInt(document.getElementById('stock-qty').value);
        const data = {
            category: document.getElementById('stock-category').value,
            condition: document.getElementById('stock-condition').value,
            make: document.getElementById('stock-make').value.trim(),
            model: document.getElementById('stock-model').value.trim(),
            year: parseInt(document.getElementById('stock-year').value) || null,
            location: document.getElementById('stock-location').value.trim(),
            price: parseFloat(document.getElementById('stock-price').value),
            quantity: qty,
            description: document.getElementById('stock-description').value.trim(),
            status: qty > 0 ? 'available' : 'sold_out',
            updatedAt: serverTimestamp()
        };
        if (id) {
            await updateDoc(doc(db, 'stock', id), data);
            showToast('Stock item updated.', 'success');
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'stock'), data);
            showToast('Stock item added.', 'success');
        }
        closeModal();
        loadAdminStock();
    } catch (er) { showToast('Error: ' + er.message, 'error'); }
    finally { hideLoading(); }
}

async function deleteStock(id) {
    if (!confirm('Delete this stock item permanently?')) return;
    showLoading();
    try { await deleteDoc(doc(db, 'stock', id)); showToast('Stock item deleted.', 'success'); loadAdminStock(); }
    catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._deleteStock = deleteStock;

// =========================================================
// INSPECTIONS
// =========================================================
async function loadAdminInspections() {
    const grid = document.getElementById('admin-inspections-grid');
    try {
        const [inspSnap, inspectorsSnap] = await Promise.all([
            getDocs(query(collection(db, 'inspections'), orderBy('createdAt', 'desc'), limit(60))),
            getDocs(query(collection(db, 'users'), where('role', '==', 'inspector')))
        ]);
        State.inspections = [];
        inspSnap.forEach(d => State.inspections.push({ id: d.id, ...d.data() }));
        State.inspectors = [];
        inspectorsSnap.forEach(d => State.inspectors.push({ id: d.id, ...d.data() }));

        grid.innerHTML = State.inspections.length ? State.inspections.map(j => `
        <div class="card">
          <div class="card-header"><span class="card-title">🔍 ${escapeHtml(j.assetMake || '')} ${escapeHtml(j.assetModel || '')}</span><span class="badge ${j.status === 'completed' ? 'badge-sold' : j.status === 'assigned' ? 'badge-upcoming' : 'badge-pending'}">${j.status}</span></div>
          <p><strong>Location:</strong> ${escapeHtml(j.location || 'TBA')}</p>
          <p class="text-muted" style="font-size:0.8rem;">${j.inspectorName ? 'Inspector: ' + escapeHtml(j.inspectorName) : 'Unassigned'}</p>
          ${j.sealId ? `<span class="seal-verified">🔒 ${j.sealId}</span>` : ''}
          ${j.status === 'unassigned' ? `
          <div class="flex mt-2" style="gap:6px;">
            <select class="form-select" id="assign-select-${j.id}" style="flex:1;">
              <option value="">Assign inspector...</option>
              ${State.inspectors.map(i => `<option value="${i.id}">${escapeHtml(i.displayName)}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-primary" onclick="window._assignInspector('${j.id}')">Assign</button>
          </div>` : ''}
        </div>`).join('') : '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-clipboard-check"></i>No inspection jobs found.</div>';
    } catch (e) { grid.innerHTML = `<p style="color:var(--accent-red);">${escapeHtml(e.message)}</p>`; }
}

async function assignInspector(inspectionId) {
    const select = document.getElementById(`assign-select-${inspectionId}`);
    const inspectorId = select?.value;
    if (!inspectorId) { showToast('Choose an inspector first.', 'warning'); return; }
    const inspector = State.inspectors.find(i => i.id === inspectorId);
    showLoading();
    try {
        await updateDoc(doc(db, 'inspections', inspectionId), {
            status: 'assigned', inspectorId, inspectorName: inspector?.displayName || 'Inspector', assignedAt: serverTimestamp()
        });
        pushNotification(inspectorId, { title: 'New inspection assigned', type: 'info', message: 'An admin assigned you a new inspection job.', link: 'inspector-portal.html' });
        showToast('Inspector assigned.', 'success');
        loadAdminInspections();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._assignInspector = assignInspector;

// =========================================================
// ESCROW & DISPUTES
// =========================================================
async function loadAdminEscrow() {
    try {
        const snap = await getDocs(query(collection(db, 'escrow'), orderBy('createdAt', 'desc'), limit(60)));
        State.escrow = [];
        snap.forEach(d => State.escrow.push({ id: d.id, ...d.data() }));
        renderAdminEscrow('all');
    } catch (e) { document.getElementById('admin-escrow-grid').innerHTML = `<p style="color:var(--accent-red);">${escapeHtml(e.message)}</p>`; }
}
document.querySelectorAll('#escrow-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('#escrow-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderAdminEscrow(tab.dataset.filter);
    });
});

function renderAdminEscrow(filter) {
    let list = State.escrow;
    if (filter === 'disputed') list = list.filter(e => e.disputeRaised);
    const order = ['initiated', 'funds_held', 'asset_delivered', 'buyer_approved', 'released_to_seller'];
    const grid = document.getElementById('admin-escrow-grid');
    grid.innerHTML = list.length ? list.map(esc => {
        const idx = order.indexOf(esc.status);
        const nextStatus = order[idx + 1];
        return `
        <div class="card">
          <div class="card-header"><span class="card-title">💼 #${esc.id.slice(-6)}</span><span class="badge badge-escrow">${esc.status.replace(/_/g, ' ')}</span></div>
          <p><strong>Asset:</strong> ${escapeHtml(esc.auctionMake || '')} ${escapeHtml(esc.auctionModel || '')}</p>
          <p><strong>Amount:</strong> ${money(esc.amount)} <span class="text-muted">(fee ${money(esc.platformFee)})</span></p>
          <div class="escrow-steps"><div class="escrow-connector"></div>
            ${order.map((s, i) => `<div class="escrow-step ${i < idx ? 'completed' : i === idx ? 'active' : ''}"><div class="escrow-step-dot">${i + 1}</div><div class="escrow-step-label">${s.replace(/_/g, ' ')}</div></div>`).join('')}
          </div>
          ${esc.disputeRaised ? `<div class="mileage-alert mb-1">⚠ Dispute: ${escapeHtml(esc.disputeReason || '')}</div><button class="btn btn-sm btn-success" onclick="window._resolveDispute('${esc.id}')">Resolve Dispute</button>` : ''}
          <div class="flex mt-1" style="gap:6px;">
            <select class="form-select" id="ntsa-select-${esc.id}" style="flex:1;">
              <option ${esc.ntsaTransferStatus === 'pending' ? 'selected' : ''}>pending</option>
              <option ${esc.ntsaTransferStatus === 'in_progress' ? 'selected' : ''}>in_progress</option>
              <option ${esc.ntsaTransferStatus === 'completed' ? 'selected' : ''}>completed</option>
              <option ${esc.ntsaTransferStatus === 'n/a' ? 'selected' : ''}>n/a</option>
            </select>
            <button class="btn btn-sm btn-secondary" onclick="window._updateNtsa('${esc.id}')">Update NTSA</button>
          </div>
          ${nextStatus ? `<button class="btn btn-sm btn-primary mt-1 w-full" onclick="window._advanceEscrow('${esc.id}','${nextStatus}')"><i class="fas fa-forward"></i> Advance to "${nextStatus.replace(/_/g, ' ')}"</button>` : '<p class="text-green mt-1" style="font-size:0.8rem;">✅ Fully settled</p>'}
        </div>`;
    }).join('') : '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-shield-alt"></i>No escrow records to show.</div>';
}

async function advanceEscrow(id, nextStatus) {
    showLoading();
    try {
        await updateDoc(doc(db, 'escrow', id), { status: nextStatus, updatedAt: serverTimestamp() });
        showToast('Escrow advanced to "' + nextStatus.replace(/_/g, ' ') + '".', 'success');
        loadAdminEscrow();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._advanceEscrow = advanceEscrow;

async function updateNtsa(id) {
    const val = document.getElementById(`ntsa-select-${id}`)?.value;
    showLoading();
    try { await updateDoc(doc(db, 'escrow', id), { ntsaTransferStatus: val, updatedAt: serverTimestamp() }); showToast('NTSA status updated.', 'success'); loadAdminEscrow(); }
    catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._updateNtsa = updateNtsa;

async function resolveDispute(escrowId) {
    const resolution = prompt('Resolution notes for this dispute:');
    if (!resolution) return;
    showLoading();
    try {
        await updateDoc(doc(db, 'escrow', escrowId), { disputeRaised: false, disputeResolution: resolution, updatedAt: serverTimestamp() });
        const dSnap = await getDocs(query(collection(db, 'disputes'), where('escrowId', '==', escrowId), where('status', '==', 'open')));
        for (const d of dSnap.docs) await updateDoc(d.ref, { status: 'resolved', resolution, resolvedAt: serverTimestamp() });
        showToast('Dispute resolved.', 'success');
        loadAdminEscrow();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._resolveDispute = resolveDispute;

// =========================================================
// PAYOUTS
// =========================================================
async function loadPayouts() {
    const tbody = document.getElementById('payouts-tbody');
    try {
        const snap = await getDocs(query(collection(db, 'payouts'), orderBy('createdAt', 'desc'), limit(60)));
        State.payouts = [];
        snap.forEach(d => State.payouts.push({ id: d.id, ...d.data() }));
        tbody.innerHTML = State.payouts.length ? State.payouts.map(p => `
            <tr>
              <td>${escapeHtml(p.sellerName || '-')}</td>
              <td>${escapeHtml(p.assetLabel || '-')}</td>
              <td>${money(p.amount)}</td>
              <td><span class="badge ${p.status === 'paid' ? 'badge-sold' : p.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}">${p.status}</span></td>
              <td>${timeAgo(p.createdAt)}</td>
              <td>${p.status === 'requested' ? `
                <button class="btn btn-sm btn-success" onclick="window._processPayout('${p.id}','paid')"><i class="fas fa-check"></i></button>
                <button class="btn btn-sm btn-danger" onclick="window._processPayout('${p.id}','rejected')"><i class="fas fa-times"></i></button>` : '-'}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="text-muted">No payout requests.</td></tr>';
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6" style="color:var(--accent-red);">${escapeHtml(e.message)}</td></tr>`; }
}

async function processPayout(id, status) {
    showLoading();
    try {
        await updateDoc(doc(db, 'payouts', id), { status, processedAt: serverTimestamp() });
        const p = State.payouts.find(x => x.id === id);
        if (p) pushNotification(p.sellerId, { title: status === 'paid' ? 'Payout processed' : 'Payout rejected', type: status === 'paid' ? 'success' : 'error', message: `${money(p.amount)} for ${p.assetLabel}` });
        showToast('Payout ' + status + '.', 'success');
        loadPayouts();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._processPayout = processPayout;

// =========================================================
// STORE ORDERS
// =========================================================
async function loadAdminOrders() {
    const tbody = document.getElementById('orders-tbody');
    try {
        const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(60)));
        State.orders = [];
        snap.forEach(d => State.orders.push({ id: d.id, ...d.data() }));
        const nextStep = { pending_payment: 'paid', paid: 'shipped', shipped: 'delivered' };
        tbody.innerHTML = State.orders.length ? State.orders.map(o => `
            <tr>
              <td>${escapeHtml(o.buyerName || '-')}</td>
              <td>${escapeHtml(o.itemName || '-')}</td>
              <td>${o.quantity}</td>
              <td>${money(o.total)}</td>
              <td><span class="badge ${o.status === 'delivered' ? 'badge-sold' : o.status === 'cancelled' ? 'badge-rejected' : 'badge-pending'}">${o.status.replace(/_/g, ' ')}</span></td>
              <td>${nextStep[o.status] ? `<button class="btn btn-sm btn-primary" onclick="window._advanceOrder('${o.id}','${nextStep[o.status]}')">Mark ${nextStep[o.status]}</button>` : ''}
                  ${o.status !== 'delivered' && o.status !== 'cancelled' ? `<button class="btn btn-sm btn-danger" onclick="window._advanceOrder('${o.id}','cancelled')">Cancel</button>` : ''}</td>
            </tr>`).join('') : '<tr><td colspan="6" class="text-muted">No store orders yet.</td></tr>';
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6" style="color:var(--accent-red);">${escapeHtml(e.message)}</td></tr>`; }
}

async function advanceOrder(id, status) {
    showLoading();
    try {
        await updateDoc(doc(db, 'orders', id), { status, updatedAt: serverTimestamp() });
        const o = State.orders.find(x => x.id === id);
        if (o) pushNotification(o.buyerId, { title: 'Order update', type: 'info', message: `${o.itemName} is now "${status}".` });
        showToast('Order updated.', 'success');
        loadAdminOrders();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._advanceOrder = advanceOrder;

// =========================================================
// BROADCAST
// =========================================================
document.getElementById('broadcast-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const role = document.getElementById('broadcast-role').value;
        const title = document.getElementById('broadcast-title').value.trim();
        const message = document.getElementById('broadcast-message').value.trim();
        const snap = role === 'all' ? await getDocs(collection(db, 'users')) : await getDocs(query(collection(db, 'users'), where('role', '==', role)));
        const sends = [];
        snap.forEach(d => sends.push(pushNotification(d.id, { title, message, type: 'info' })));
        await Promise.all(sends);
        showToast(`Broadcast sent to ${sends.length} user(s).`, 'success');
        document.getElementById('broadcast-form').reset();
    } catch (er) { showToast('Error: ' + er.message, 'error'); }
    finally { hideLoading(); }
});

// =========================================================
// SETTINGS
// =========================================================
async function loadSettings() {
    try {
        const snap = await getDoc(doc(db, 'settings', 'global'));
        const s = snap.exists() ? snap.data() : {};
        document.getElementById('setting-fee').value = (s.platformFeePercent ?? CONFIG.platformFeePercent) * 100;
        document.getElementById('setting-listing-fee').value = s.listingFeeKES ?? CONFIG.listingFeeKES;
        document.getElementById('setting-increment').value = (s.minBidIncrementPercent ?? CONFIG.minBidIncrementPercent) * 100;
    } catch (e) { showToast('Error loading settings: ' + e.message, 'error'); }
}
document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        await setDoc(doc(db, 'settings', 'global'), {
            platformFeePercent: parseFloat(document.getElementById('setting-fee').value) / 100,
            listingFeeKES: parseFloat(document.getElementById('setting-listing-fee').value),
            minBidIncrementPercent: parseFloat(document.getElementById('setting-increment').value) / 100,
            updatedAt: serverTimestamp()
        }, { merge: true });
        showToast('Settings saved. Reload other portals to apply.', 'success');
    } catch (er) { showToast('Error: ' + er.message, 'error'); }
    finally { hideLoading(); }
});

// =========================================================
// BACKGROUND: auto-settle expired live auctions
// =========================================================
async function checkExpiredAuctions() {
    try {
        const now = new Date();
        const snap = await getDocs(query(collection(db, 'auctions'), where('status', '==', 'live')));
        for (const d of snap.docs) {
            const a = d.data();
            const end = a.endTime?.toDate ? a.endTime.toDate() : new Date(a.endTime);
            if (end <= now) await settleAuction(d.id);
        }
    } catch (e) { console.error('Expiry check error:', e); }
}

// =========================================================
// INIT
// =========================================================
requireAuth({
    allowedRoles: ['admin'],
    onReady: (user, userData) => {
        State.user = user;
        State.userData = userData;
        document.getElementById('nav-user-name').textContent = userData.displayName || 'Admin';
        document.getElementById('nav-avatar').textContent = (userData.displayName || 'A').charAt(0).toUpperCase();
        navigateTo('overview');
        checkExpiredAuctions();
        setInterval(checkExpiredAuctions, 30000);
        hideLoading();
    }
});
