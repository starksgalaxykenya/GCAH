// ============================================================
// BUYER PORTAL LOGIC
// ============================================================
import { db } from './firebase-config.js';
import {
    collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query,
    where, orderBy, limit, onSnapshot, serverTimestamp, increment, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    requireAuth, showToast, showLoading, hideLoading, escapeHtml, money,
    timeAgo, catIcon, minNextBid, attachCountdown, pushNotification, CONFIG,
    runExpiryWatchdog
} from './shared.js';

const State = {
    user: null, userData: null,
    auctions: [], filteredAuctions: [],
    stock: [], filteredStock: [],
    watchlistIds: new Set(),
    activeAuctionId: null, activeStockId: null,
    unsubscribers: [], currentScreen: 'dashboard'
};

// ---------------------------------------------------------
// Navigation
// ---------------------------------------------------------
function navigateTo(screen, data = null) {
    if (screen === 'auction-detail' && data) State.activeAuctionId = data;
    State.currentScreen = screen;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.screen === screen));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${screen}`)?.classList.add('active');
    clearSubscriptions();
    loadScreen(screen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
function clearSubscriptions() { State.unsubscribers.forEach(u => u()); State.unsubscribers = []; }

async function loadScreen(screen) {
    switch (screen) {
        case 'dashboard': return loadDashboard();
        case 'auctions': return loadAuctions();
        case 'auction-detail': return loadAuctionDetail();
        case 'store': return loadStock();
        case 'watchlist': return loadWatchlist();
        case 'orders': return loadOrders();
        case 'escrow': return loadEscrow();
        case 'profile': return loadProfile();
    }
}

window._navigateTo = navigateTo;
window._filterAuctions = applyAuctionFilters;
window._filterStock = applyStockFilters;
window._navigateToAuction = (id) => navigateTo('auction-detail', id);
window._placeBid = placeBid;
window._toggleWatch = toggleWatch;
window._openStockItem = openStockItem;
window._closeModal = closeModal;

function closeModal() { document.getElementById('modal-container').innerHTML = ''; }

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------
async function loadDashboard() {
    document.getElementById('dash-welcome-name').textContent = State.userData?.displayName || 'User';
    try {
        const liveSnap = await getDocs(query(collection(db, 'auctions'), where('status', '==', 'live')));
        document.getElementById('stat-active').textContent = liveSnap.size;

        const bidsSnap = await getDocs(query(collection(db, 'bids'), where('userId', '==', State.user.uid)));
        document.getElementById('stat-bids').textContent = bidsSnap.size;

        const escrowSnap = await getDocs(query(collection(db, 'escrow'), where('buyerId', '==', State.user.uid)));
        let escTotal = 0;
        escrowSnap.forEach(d => { const s = d.data().status; if (s !== 'released_to_seller') escTotal += (d.data().amount || 0); });
        document.getElementById('stat-escrow').textContent = money(escTotal);

        const wonSnap = await getDocs(query(collection(db, 'auctions'), where('winningBidderId', '==', State.user.uid), where('status', '==', 'ended')));
        document.getElementById('stat-won').textContent = wonSnap.size;

        const auctions = [];
        liveSnap.forEach(d => auctions.push({ id: d.id, ...d.data() }));
        auctions.sort((a, b) => (a.endTime?.seconds || 0) - (b.endTime?.seconds || 0));
        const dashGrid = document.getElementById('dash-live-auctions');
        dashGrid.innerHTML = auctions.length ? auctions.slice(0, 6).map(renderAuctionCard).join('') : '<p class="text-muted" style="grid-column:1/-1;">No live auctions at the moment.</p>';

        const stockSnap = await getDocs(query(collection(db, 'stock'), where('status', '==', 'available'), limit(4)));
        const items = [];
        stockSnap.forEach(d => items.push({ id: d.id, ...d.data() }));
        document.getElementById('dash-stock-items').innerHTML = items.length ? items.map(renderStockCard).join('') : '<p class="text-muted" style="grid-column:1/-1;">No store items yet.</p>';
    } catch (e) { console.error(e); }
}

// ---------------------------------------------------------
// AUCTIONS
// ---------------------------------------------------------
async function loadAuctions() {
    try {
        await loadWatchlistIds();
        const snap = await getDocs(query(collection(db, 'auctions'), where('status', 'in', ['live', 'upcoming', 'ended']), orderBy('createdAt', 'desc'), limit(60)));
        State.auctions = [];
        snap.forEach(d => State.auctions.push({ id: d.id, ...d.data() }));
        applyAuctionFilters();
    } catch (e) {
        document.getElementById('auctions-grid').innerHTML = '<p class="text-muted">Error loading auctions: ' + escapeHtml(e.message) + '</p>';
    }
}

function applyAuctionFilters() {
    const cat = document.getElementById('auction-filter-category')?.value || 'all';
    const stat = document.getElementById('auction-filter-status')?.value || 'all';
    const sort = document.getElementById('auction-sort')?.value || 'newest';
    const search = (document.getElementById('auction-search')?.value || '').toLowerCase().trim();
    let filtered = [...State.auctions];
    if (cat !== 'all') filtered = filtered.filter(a => a.category === cat);
    if (stat !== 'all') filtered = filtered.filter(a => a.status === stat);
    if (search) filtered = filtered.filter(a => `${a.make} ${a.model}`.toLowerCase().includes(search));
    if (sort === 'ending_soon') filtered.sort((a, b) => (a.endTime?.seconds || 0) - (b.endTime?.seconds || 0));
    if (sort === 'newest') filtered.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (sort === 'price_high') filtered.sort((a, b) => (b.currentBid || 0) - (a.currentBid || 0));
    if (sort === 'price_low') filtered.sort((a, b) => (a.currentBid || 0) - (b.currentBid || 0));
    State.filteredAuctions = filtered;
    const grid = document.getElementById('auctions-grid');
    grid.innerHTML = filtered.length ? filtered.map(renderAuctionCard).join('') :
        '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-gavel"></i>No auctions match your filters.</div>';
}

function renderAuctionCard(auction) {
    const now = new Date();
    const endTime = auction.endTime?.toDate ? auction.endTime.toDate() : new Date(auction.endTime || 0);
    const isLive = auction.status === 'live' && endTime > now;
    const timeLeft = endTime - now;
    const h = Math.max(0, Math.floor(timeLeft / 3600000)), m = Math.max(0, Math.floor((timeLeft % 3600000) / 60000)), s = Math.max(0, Math.floor((timeLeft % 60000) / 1000));
    const statusBadge = auction.status === 'ended' ? '<span class="badge badge-sold">Ended</span>' :
        isLive ? '<span class="badge badge-live">🔴 LIVE</span>' : '<span class="badge badge-upcoming">Upcoming</span>';
    const countdown = isLive ? `<span class="countdown-timer${timeLeft < 3600000 ? ' urgent' : ''}">⏱ ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}</span>` : '';
    const bid = auction.currentBid || auction.startingBid || 0;
    const watched = State.watchlistIds.has(auction.id);
    return `
    <div class="auction-card">
      <div class="auction-card-image" onclick="window._navigateToAuction('${auction.id}')">
        <span style="font-size:4rem;">${catIcon(auction.category)}</span>
        <div class="overlay-badge">${statusBadge}</div>
        <div style="position:absolute;top:10px;left:10px;font-size:1.2rem;cursor:pointer;" onclick="event.stopPropagation();window._toggleWatch('${auction.id}')">${watched ? '❤️' : '🤍'}</div>
      </div>
      <div class="auction-card-body" onclick="window._navigateToAuction('${auction.id}')" style="cursor:pointer;">
        <div class="auction-card-title">${escapeHtml(auction.make)} ${escapeHtml(auction.model)}</div>
        <div class="auction-card-sub">${auction.year || 'N/A'} · ${escapeHtml(auction.location || 'TBA')}</div>
        <div class="auction-card-bid">${money(bid)}</div>
      </div>
      <div class="auction-card-footer"><span>${auction.bidCount || 0} bids</span>${countdown}</div>
    </div>`;
}

// ---------------------------------------------------------
// AUCTION DETAIL (real-time)
// ---------------------------------------------------------
async function loadAuctionDetail() {
    const id = State.activeAuctionId;
    const container = document.getElementById('auction-detail-content');
    if (!id) { container.innerHTML = '<p class="text-muted">No auction selected.</p>'; return; }
    container.innerHTML = '<p class="text-muted">Loading auction...</p>';

    const unsubAuction = onSnapshot(doc(db, 'auctions', id), (aSnap) => {
        if (!aSnap.exists()) { container.innerHTML = '<p style="color:var(--accent-red);">Auction not found.</p>'; return; }
        renderAuctionDetail({ id: aSnap.id, ...aSnap.data() });
    }, (e) => { container.innerHTML = '<p style="color:var(--accent-red);">Error: ' + escapeHtml(e.message) + '</p>'; });
    State.unsubscribers.push(unsubAuction);

    const bidsQuery = query(collection(db, 'bids'), where('auctionId', '==', id), orderBy('timestamp', 'desc'), limit(20));
    const unsubBids = onSnapshot(bidsQuery, (snap) => {
        const bids = [];
        snap.forEach(d => bids.push(d.data()));
        const list = document.getElementById('bid-history-list');
        if (!list) return;
        list.innerHTML = bids.length ? bids.map(b => `
            <div class="bid-row">
              <span class="bid-user">${escapeHtml(b.bidderName)}</span>
              <span class="bid-amount">${money(b.amount)}</span>
              <span class="bid-time">${timeAgo(b.timestamp)}</span>
            </div>`).join('') : '<p class="text-muted">No bids yet — be the first!</p>';
    });
    State.unsubscribers.push(unsubBids);
}

function renderAuctionDetail(auction) {
    const container = document.getElementById('auction-detail-content');
    const now = new Date();
    const endTime = auction.endTime?.toDate ? auction.endTime.toDate() : new Date(auction.endTime || 0);
    const isLive = auction.status === 'live' && endTime > now;
    const currentBid = auction.currentBid || auction.startingBid || 0;
    const minNext = minNextBid(currentBid);
    const watched = State.watchlistIds.has(auction.id);
    container.innerHTML = `
    <div class="grid-2">
      <div class="card card-gold-border" style="text-align:center;padding:40px;position:relative;">
        <div style="position:absolute;top:16px;left:16px;font-size:1.5rem;cursor:pointer;" onclick="window._toggleWatch('${auction.id}')" title="Watch">${watched ? '❤️' : '🤍'}</div>
        <span style="font-size:6rem;">${catIcon(auction.category)}</span>
        <h2 style="font-weight:800;margin-top:12px;">${escapeHtml(auction.make)} ${escapeHtml(auction.model)}</h2>
        <p class="text-muted">${auction.year || 'N/A'} · ${escapeHtml(auction.location || 'TBA')}</p>
        ${auction.mileage ? `<p>🛣 Mileage: <strong>${auction.mileage.toLocaleString()} km</strong></p>` : ''}
        ${auction.vin ? `<p style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;">🔢 VIN: ${escapeHtml(auction.vin)}</p>` : ''}
        ${auction.sealId ? '<span class="seal-verified">🔒 Seal Verified</span>' : '<span class="seal-broken">⚠️ Seal Pending</span>'}
        <p style="margin-top:12px;color:var(--text-secondary);">${escapeHtml(auction.description || '')}</p>
        <p class="text-muted mt-2" style="font-size:0.8rem;">Seller: ${escapeHtml(auction.sellerName || 'Galaxy CAH')}</p>
      </div>
      <div>
        <div class="card" style="text-align:center;">
          <div style="font-size:0.85rem;color:var(--text-muted);">CURRENT BID</div>
          <div style="font-size:2.5rem;font-weight:900;color:var(--accent-gold);font-family:'JetBrains Mono',monospace;">${money(currentBid)}</div>
          <div>${isLive ? '<span class="badge badge-live">🔴 LIVE</span>' : auction.status === 'ended' ? '<span class="badge badge-sold">Ended</span>' : '<span class="badge badge-upcoming">Upcoming</span>'}</div>
          ${isLive ? `
          <div class="countdown-timer" style="font-size:1.5rem;margin:12px 0;" id="detail-countdown">⏱ Calculating...</div>
          <p style="font-size:0.85rem;color:var(--text-muted);">Min next bid: <strong>${money(minNext)}</strong></p>
          <input type="number" class="form-input" id="bid-amount" placeholder="Enter bid amount" min="${minNext}" style="text-align:center;font-size:1.1rem;margin-top:8px;">
          <button class="btn btn-primary btn-block btn-lg mt-2" onclick="window._placeBid('${auction.id}',${minNext})"><i class="fas fa-gavel"></i> PLACE BID</button>
          ` : ''}
          ${auction.winningBidderId === State.user?.uid && auction.status === 'ended' ? '<div class="badge badge-sold" style="margin-top:8px;">🏆 YOU WON! Check your Escrow tab.</div>' : ''}
          ${auction.status === 'ended' && auction.winningBidderId !== State.user?.uid ? '<div class="badge badge-neutral" style="margin-top:8px;">Auction closed</div>' : ''}
        </div>
        <div class="card mt-2"><div class="card-title mb-2">📋 Bid History</div><div id="bid-history-list"><p class="text-muted">Loading bids...</p></div></div>
      </div>
    </div>`;
    if (isLive) attachCountdown(document.getElementById('detail-countdown'), endTime);
}

async function placeBid(auctionId, minBid) {
    const bidAmt = parseFloat(document.getElementById('bid-amount')?.value || 0);
    if (!bidAmt || bidAmt < minBid) { showToast(`Minimum bid: ${money(minBid)}`, 'warning'); return; }
    showLoading();
    try {
        const aRef = doc(db, 'auctions', auctionId);
        const aSnap = await getDoc(aRef);
        if (!aSnap.exists()) throw new Error('Auction not found');
        const auction = aSnap.data();
        if (auction.status !== 'live') throw new Error('Auction not live');
        if (bidAmt <= (auction.currentBid || auction.startingBid || 0)) throw new Error('Bid too low — someone may have just outbid you');
        await addDoc(collection(db, 'bids'), {
            auctionId, userId: State.user.uid, bidderName: State.userData?.displayName || State.user.email,
            amount: bidAmt, timestamp: serverTimestamp()
        });
        await updateDoc(aRef, { currentBid: bidAmt, bidCount: increment(1), lastBidderId: State.user.uid, lastBidTime: serverTimestamp() });
        await updateDoc(doc(db, 'users', State.user.uid), { totalBids: increment(1) });
        if (auction.lastBidderId && auction.lastBidderId !== State.user.uid) {
            pushNotification(auction.lastBidderId, {
                title: 'You were outbid!', type: 'warning',
                message: `${escapeHtml(auction.make)} ${escapeHtml(auction.model)} now at ${money(bidAmt)}`,
                link: `auction-detail.html`
            });
        }
        showToast('🎉 Bid placed! ' + money(bidAmt), 'success');
        document.getElementById('bid-amount').value = '';
    } catch (e) { showToast('Bid failed: ' + e.message, 'error'); }
    finally { hideLoading(); }
}

// ---------------------------------------------------------
// WATCHLIST
// ---------------------------------------------------------
async function loadWatchlistIds() {
    if (!State.user) return;
    const snap = await getDocs(query(collection(db, 'watchlist'), where('userId', '==', State.user.uid)));
    State.watchlistIds = new Set();
    snap.forEach(d => State.watchlistIds.add(d.data().auctionId));
    State.watchlistDocIds = {};
    snap.forEach(d => { State.watchlistDocIds[d.data().auctionId] = d.id; });
}

async function toggleWatch(auctionId) {
    if (!State.watchlistDocIds) State.watchlistDocIds = {};
    try {
        if (State.watchlistIds.has(auctionId)) {
            const docId = State.watchlistDocIds[auctionId];
            if (docId) await deleteDoc(doc(db, 'watchlist', docId));
            State.watchlistIds.delete(auctionId);
            showToast('Removed from watchlist', 'info');
        } else {
            const ref = await addDoc(collection(db, 'watchlist'), { userId: State.user.uid, auctionId, createdAt: serverTimestamp() });
            State.watchlistIds.add(auctionId);
            State.watchlistDocIds[auctionId] = ref.id;
            showToast('Added to watchlist ❤️', 'success');
        }
        if (State.currentScreen === 'auctions') applyAuctionFilters();
        if (State.currentScreen === 'auction-detail') loadAuctionDetail();
        if (State.currentScreen === 'watchlist') loadWatchlist();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function loadWatchlist() {
    const grid = document.getElementById('watchlist-grid');
    try {
        await loadWatchlistIds();
        if (State.watchlistIds.size === 0) {
            grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-heart"></i>Your watchlist is empty. Tap the heart on any auction to add it here.</div>';
            return;
        }
        const ids = [...State.watchlistIds];
        const items = [];
        for (const id of ids) {
            const s = await getDoc(doc(db, 'auctions', id));
            if (s.exists()) items.push({ id: s.id, ...s.data() });
        }
        grid.innerHTML = items.length ? items.map(renderAuctionCard).join('') : '<p class="text-muted" style="grid-column:1/-1;">Watched auctions were not found (may have been removed).</p>';
    } catch (e) { grid.innerHTML = '<p style="color:var(--accent-red);">Error loading watchlist.</p>'; }
}

// ---------------------------------------------------------
// STORE (OWN STOCK)
// ---------------------------------------------------------
async function loadStock() {
    const grid = document.getElementById('stock-grid');
    try {
        const snap = await getDocs(query(collection(db, 'stock'), orderBy('createdAt', 'desc'), limit(60)));
        State.stock = [];
        snap.forEach(d => { const item = { id: d.id, ...d.data() }; if (item.status !== 'archived') State.stock.push(item); });
        applyStockFilters();
    } catch (e) { grid.innerHTML = '<p style="color:var(--accent-red);">Error loading store: ' + escapeHtml(e.message) + '</p>'; }
}

function applyStockFilters() {
    const cat = document.getElementById('stock-filter-category')?.value || 'all';
    const search = (document.getElementById('stock-search')?.value || '').toLowerCase().trim();
    let filtered = [...State.stock];
    if (cat !== 'all') filtered = filtered.filter(i => i.category === cat);
    if (search) filtered = filtered.filter(i => `${i.make} ${i.model}`.toLowerCase().includes(search));
    const grid = document.getElementById('stock-grid');
    grid.innerHTML = filtered.length ? filtered.map(renderStockCard).join('') :
        '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-store"></i>No store items match your filters.</div>';
}

function renderStockCard(item) {
    const inStock = (item.quantity || 0) > 0 && item.status === 'available';
    return `
    <div class="stock-card">
      <div class="stock-card-image"><span style="font-size:3.5rem;">${catIcon(item.category)}</span>
        <div class="overlay-badge">${inStock ? '<span class="badge badge-instock">In Stock</span>' : '<span class="badge badge-outofstock">Sold Out</span>'}</div>
      </div>
      <div class="stock-card-body">
        <div class="auction-card-title">${escapeHtml(item.make)} ${escapeHtml(item.model)}</div>
        <div class="auction-card-sub">${item.year || ''} ${item.condition ? '· ' + escapeHtml(item.condition) : ''}</div>
        <div class="stock-price">${money(item.price)}</div>
        <div class="stock-qty">${item.quantity || 0} available · Galaxy CAH owned</div>
        <button class="btn btn-secondary btn-sm mt-2 w-full" onclick="window._openStockItem('${item.id}')" ${inStock ? '' : 'disabled'}>
          <i class="fas fa-shopping-cart"></i> ${inStock ? 'View & Buy' : 'Unavailable'}
        </button>
      </div>
    </div>`;
}

function openStockItem(id) {
    const item = State.stock.find(i => i.id === id);
    if (!item) return;
    State.activeStockId = id;
    const inStock = (item.quantity || 0) > 0 && item.status === 'available';
    document.getElementById('modal-container').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) window._closeModal()">
      <div class="modal">
        <div class="modal-header"><span class="card-title">${escapeHtml(item.make)} ${escapeHtml(item.model)}</span><button class="modal-close" onclick="window._closeModal()">&times;</button></div>
        <div style="text-align:center;font-size:4rem;margin-bottom:12px;">${catIcon(item.category)}</div>
        <p><strong>Category:</strong> ${escapeHtml(item.category)}</p>
        <p><strong>Condition:</strong> ${escapeHtml(item.condition || 'N/A')}</p>
        <p><strong>Year:</strong> ${item.year || 'N/A'}</p>
        <p><strong>Location:</strong> ${escapeHtml(item.location || 'Galaxy CAH Warehouse')}</p>
        <p style="margin:12px 0;color:var(--text-secondary);">${escapeHtml(item.description || '')}</p>
        <div class="stock-price text-center" style="font-size:1.8rem;">${money(item.price)}</div>
        <p class="text-muted text-center mb-2">${item.quantity || 0} units available</p>
        ${inStock ? `
        <div class="form-group">
          <label class="form-label">Quantity</label>
          <input type="number" class="form-input" id="buy-qty" value="1" min="1" max="${item.quantity}">
        </div>
        <button class="btn btn-primary btn-block btn-lg" onclick="window._buyStockItem('${id}')"><i class="fas fa-bolt"></i> Buy Now</button>
        ` : '<p class="text-center" style="color:var(--accent-red);">This item is currently out of stock.</p>'}
      </div>
    </div>`;
    window._buyStockItem = buyStockItem;
}

async function buyStockItem(stockId) {
    const qty = parseInt(document.getElementById('buy-qty')?.value || 1);
    if (!qty || qty < 1) { showToast('Enter a valid quantity', 'warning'); return; }
    showLoading();
    try {
        const ref = doc(db, 'stock', stockId);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error('Item not found');
        const item = snap.data();
        if ((item.quantity || 0) < qty) throw new Error('Not enough stock available');
        const total = item.price * qty;
        await addDoc(collection(db, 'orders'), {
            stockId, itemName: `${item.make} ${item.model}`, category: item.category,
            buyerId: State.user.uid, buyerName: State.userData?.displayName || State.user.email,
            unitPrice: item.price, quantity: qty, total, status: 'pending_payment',
            createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        await updateDoc(ref, { quantity: increment(-qty), status: (item.quantity - qty) <= 0 ? 'sold_out' : 'available' });
        showToast(`✅ Order placed for ${money(total)}. Track it in "Orders".`, 'success');
        closeModal();
        loadStock();
    } catch (e) { showToast('Purchase failed: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._buyStockItem = buyStockItem;

// ---------------------------------------------------------
// ORDERS
// ---------------------------------------------------------
async function loadOrders() {
    const grid = document.getElementById('orders-grid');
    try {
        const snap = await getDocs(query(collection(db, 'orders'), where('buyerId', '==', State.user.uid), orderBy('createdAt', 'desc'), limit(30)));
        const orders = [];
        snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
        if (!orders.length) { grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-box"></i>No store orders yet.</div>'; return; }
        const statusColor = { pending_payment: 'badge-pending', paid: 'badge-upcoming', shipped: 'badge-escrow', delivered: 'badge-sold', cancelled: 'badge-rejected' };
        grid.innerHTML = orders.map(o => `
        <div class="card">
          <div class="card-header"><span class="card-title">📦 ${escapeHtml(o.itemName)}</span><span class="badge ${statusColor[o.status] || 'badge-neutral'}">${o.status.replace(/_/g, ' ')}</span></div>
          <p><strong>Quantity:</strong> ${o.quantity}</p>
          <p><strong>Total:</strong> <span class="text-gold" style="font-weight:700;">${money(o.total)}</span></p>
          <p class="text-muted" style="font-size:0.8rem;">Ordered ${timeAgo(o.createdAt)}</p>
        </div>`).join('');
    } catch (e) { grid.innerHTML = '<p style="color:var(--accent-red);">Error loading orders.</p>'; }
}

// ---------------------------------------------------------
// ESCROW
// ---------------------------------------------------------
async function loadEscrow() {
    const container = document.getElementById('escrow-list');
    try {
        const snap = await getDocs(query(collection(db, 'escrow'), where('participants', 'array-contains', State.user.uid), orderBy('createdAt', 'desc'), limit(20)));
        const records = [];
        snap.forEach(d => records.push({ id: d.id, ...d.data() }));
        if (!records.length) { container.innerHTML = '<p class="text-muted" style="grid-column:1/-1;">No escrow records.</p>'; return; }
        const order = ['initiated', 'funds_held', 'asset_delivered', 'buyer_approved', 'released_to_seller'];
        container.innerHTML = records.map(esc => {
            const idx = order.indexOf(esc.status);
            const stepClass = (s) => order.indexOf(s) < idx ? 'completed' : order.indexOf(s) === idx ? 'active' : '';
            return `
            <div class="card">
              <div class="card-header"><span class="card-title">💼 #${esc.id.slice(-6)}</span><span class="badge badge-escrow">${esc.status.replace(/_/g, ' ').toUpperCase()}</span></div>
              <p><strong>Amount:</strong> <span class="text-gold" style="font-weight:700;">${money(esc.amount)}</span></p>
              <p><strong>Asset:</strong> ${escapeHtml(esc.auctionMake || '')} ${escapeHtml(esc.auctionModel || '')}</p>
              <div class="escrow-steps">
                <div class="escrow-connector"></div>
                ${order.map(s => `<div class="escrow-step ${stepClass(s)}"><div class="escrow-step-dot">${order.indexOf(s) + 1}</div><div class="escrow-step-label">${s.replace(/_/g, ' ')}</div></div>`).join('')}
              </div>
              ${esc.ntsaTransferStatus ? `<p><strong>NTSA:</strong> ${escapeHtml(esc.ntsaTransferStatus)}</p>` : ''}
              ${esc.disputeRaised ? '<p style="color:var(--accent-red);"><strong>⚠ Dispute open:</strong> ' + escapeHtml(esc.disputeReason || '') + '</p>' : `<button class="btn btn-sm btn-danger mt-1" onclick="window._raiseDispute('${esc.id}')">Raise a Dispute</button>`}
            </div>`;
        }).join('');
    } catch (e) { container.innerHTML = '<p style="color:var(--accent-red);">Error loading escrow.</p>'; }
}

async function raiseDispute(escrowId) {
    const reason = prompt('Briefly describe the issue with this transaction:');
    if (!reason) return;
    showLoading();
    try {
        await updateDoc(doc(db, 'escrow', escrowId), { disputeRaised: true, disputeReason: reason, disputeStatus: 'open', disputeRaisedBy: State.user.uid, updatedAt: serverTimestamp() });
        await addDoc(collection(db, 'disputes'), { escrowId, raisedBy: State.user.uid, raisedByName: State.userData?.displayName, reason, status: 'open', createdAt: serverTimestamp() });
        showToast('Dispute submitted. Our admin team will review it shortly.', 'warning');
        loadEscrow();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window._raiseDispute = raiseDispute;

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
      <span class="badge badge-sold">BUYER</span>
    </div>
    <div class="grid-2">
      <div class="stat-card"><div class="stat-value">${u.totalBids || 0}</div><div class="stat-label">Total Bids</div></div>
      <div class="stat-card"><div class="stat-value">${u.totalWon || 0}</div><div class="stat-label">Assets Won</div></div>
      <div class="stat-card"><div class="stat-value">${u.reputation || 100}%</div><div class="stat-label">Reputation</div></div>
      <div class="stat-card"><div class="stat-value">${u.kycVerified ? '✅' : '⏳'}</div><div class="stat-label">KYC Status</div></div>
    </div>
    <p class="mt-2 text-muted text-center" style="font-size:0.8rem;">Member since: ${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : 'N/A'}</p>`;
    document.getElementById('edit-name').value = u.displayName || '';
    document.getElementById('edit-phone').value = u.phone || '';
}

document.getElementById('profile-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    try {
        const name = document.getElementById('edit-name').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        await updateDoc(doc(db, 'users', State.user.uid), { displayName: name, phone, updatedAt: serverTimestamp() });
        State.userData.displayName = name;
        State.userData.phone = phone;
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
    allowedRoles: ['buyer'],
    onReady: (user, userData) => {
        State.user = user;
        State.userData = userData;
        navigateTo('dashboard');
        runExpiryWatchdog();
        setInterval(runExpiryWatchdog, 30000);
        setInterval(async () => {
            // periodically refresh the auctions grid so cards without an
            // active onSnapshot listener still reflect new bids/status.
            if (State.currentScreen === 'auctions') applyAuctionFilters();
        }, 15000);
        hideLoading();
    }
});
