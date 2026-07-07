// ============================================================
// SHARED UTILITIES — imported by every portal's JS file
// ============================================================
import { auth, db, CONFIG } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    doc, getDoc, setDoc, collection, query, where, orderBy, limit,
    onSnapshot, addDoc, updateDoc, serverTimestamp, increment, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export { CONFIG };

// ---------------------------------------------------------
// Toasts & loading overlay
// ---------------------------------------------------------
export function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${icons[type] || 'ℹ️'} <span>${escapeHtml(message)}</span>`;
    toast.onclick = () => toast.remove();
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
}
export function showLoading() { document.getElementById('loading-overlay')?.classList.remove('hidden'); }
export function hideLoading() { document.getElementById('loading-overlay')?.classList.add('hidden'); }

// ---------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
export function money(n) { return 'KES ' + Number(n || 0).toLocaleString(); }
export function timeAgo(date) {
    if (!date) return '';
    const d = date.toDate ? date.toDate() : new Date(date);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString();
}
export function starRating(score) {
    const s = Math.round(score || 0);
    return '★'.repeat(Math.max(0, Math.min(5, s))) + '☆'.repeat(Math.max(0, 5 - s));
}
export function catIcon(cat) {
    return (CONFIG.categories.find(c => c.value === cat) || {}).icon || '📦';
}
export function minNextBid(currentBid) {
    return currentBid + Math.max(CONFIG.minBidIncrementFloor, Math.floor(currentBid * CONFIG.minBidIncrementPercent));
}

// ---------------------------------------------------------
// Auth guard — call at the top of every portal page.
// Redirects unauthenticated users to index.html, and redirects
// users whose role doesn't match the portal to their correct home.
// ---------------------------------------------------------
const ROLE_HOME = {
    buyer: 'buyer-portal.html',
    seller: 'seller-portal.html',
    inspector: 'inspector-portal.html',
    admin: 'admin-portal.html'
};

export function requireAuth({ allowedRoles = null, onReady } = {}) {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        let userDoc = await getDoc(doc(db, 'users', user.uid));
        let userData;
        if (!userDoc.exists()) {
            userData = {
                uid: user.uid, email: user.email, displayName: user.displayName || 'User',
                role: 'buyer', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
                kycVerified: false, totalBids: 0, totalWon: 0, escrowBalance: 0,
                reputation: 100, suspended: false
            };
            await setDoc(doc(db, 'users', user.uid), userData);
        } else {
            userData = userDoc.data();
        }
        if (userData.suspended) {
            showToast('Your account has been suspended. Contact support.', 'error', 8000);
            await signOut(auth);
            window.location.href = 'index.html';
            return;
        }
        if (allowedRoles && !allowedRoles.includes(userData.role)) {
            const home = ROLE_HOME[userData.role] || 'index.html';
            window.location.href = home;
            return;
        }
        renderNavIdentity(user, userData);
        initNotifications(user.uid);
        onReady && onReady(user, userData);
    });
}

function renderNavIdentity(user, userData) {
    const nameEl = document.getElementById('nav-user-name');
    const avatarEl = document.getElementById('nav-avatar');
    if (nameEl) nameEl.textContent = userData.displayName || user.email;
    if (avatarEl) avatarEl.textContent = (userData.displayName || 'U').charAt(0).toUpperCase();
}

export async function handleLogout() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (e) { showToast('Logout failed: ' + e.message, 'error'); }
}
window._handleLogout = handleLogout;

// ---------------------------------------------------------
// Notifications — bell dropdown wired into any page that
// includes the #notif-bell / #notif-panel markup in its nav.
// ---------------------------------------------------------
export async function pushNotification(userId, { title, message, type = 'info', link = null }) {
    try {
        await addDoc(collection(db, 'notifications'), {
            userId, title, message, type, link, read: false, createdAt: serverTimestamp()
        });
    } catch (e) { console.error('Notification error', e); }
}

function initNotifications(uid) {
    const panel = document.getElementById('notif-panel');
    const bell = document.getElementById('notif-bell');
    const dot = document.getElementById('notif-dot');
    if (!panel || !bell) return;

    bell.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('open');
    });
    document.addEventListener('click', () => panel.classList.remove('open'));
    panel.addEventListener('click', (e) => e.stopPropagation());

    const q = query(collection(db, 'notifications'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(20));
    onSnapshot(q, (snap) => {
        const items = [];
        let unread = 0;
        snap.forEach(d => { const data = d.data(); items.push({ id: d.id, ...data }); if (!data.read) unread++; });
        if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
        if (items.length === 0) {
            panel.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
            return;
        }
        panel.innerHTML = items.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
                <div class="n-title">${escapeHtml(n.title)}</div>
                <div>${escapeHtml(n.message)}</div>
                <div class="n-time">${timeAgo(n.createdAt)}</div>
            </div>`).join('');
        panel.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('click', async () => {
                const id = el.dataset.id;
                await updateDoc(doc(db, 'notifications', id), { read: true }).catch(() => {});
                if (el.dataset.link) window.location.href = el.dataset.link;
            });
        });
    }, (err) => console.warn('Notifications listener error', err));
}

// ---------------------------------------------------------
// Auction expiry watchdog — any signed-in portal can call this
// periodically so live auctions settle even if no admin is online.
// Admin portal also runs a fuller version with extra notifications.
// ---------------------------------------------------------
export async function runExpiryWatchdog() {
    try {
        const now = new Date();
        const snap = await getDocs(query(collection(db, 'auctions'), where('status', '==', 'live')));
        for (const d of snap.docs) {
            const a = d.data();
            const end = a.endTime?.toDate ? a.endTime.toDate() : new Date(a.endTime);
            if (end > now) continue;
            const bidsSnap = await getDocs(query(collection(db, 'bids'), where('auctionId', '==', d.id), orderBy('amount', 'desc'), limit(1)));
            let winnerId = null, winnerName = null, winBid = a.currentBid || a.startingBid || 0;
            bidsSnap.forEach(b => { winnerId = b.data().userId; winnerName = b.data().bidderName; winBid = b.data().amount; });
            const update = { status: 'ended', winningBid: winBid, endedAt: serverTimestamp(), updatedAt: serverTimestamp() };
            if (winnerId && winBid >= (a.reservePrice || 0)) {
                update.winningBidderId = winnerId;
                update.winningBidderName = winnerName;
                await updateDoc(d.ref, update);
                await addDoc(collection(db, 'escrow'), {
                    auctionId: d.id, auctionMake: a.make, auctionModel: a.model,
                    buyerId: winnerId, sellerId: a.sellerId, amount: winBid,
                    platformFee: Math.round(winBid * CONFIG.platformFeePercent), status: 'initiated',
                    participants: [winnerId, a.sellerId], createdAt: serverTimestamp(),
                    ntsaTransferStatus: 'pending', disputeRaised: false
                });
                await updateDoc(doc(db, 'users', winnerId), { totalWon: increment(1) });
            } else {
                update.winningBidderId = null; update.winningBidderName = null;
                await updateDoc(d.ref, update);
            }
        }
    } catch (e) { console.warn('Expiry watchdog error', e); }
}

// ---------------------------------------------------------
// Simple client-side countdown helper
// ---------------------------------------------------------
export function attachCountdown(el, endDate, onTick) {
    if (!el) return () => {};
    function update() {
        const diff = endDate - new Date();
        if (diff <= 0) {
            el.textContent = '⏱ ENDED';
            el.classList.add('urgent');
            onTick && onTick(0);
            return false;
        }
        const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
        el.textContent = `⏱ ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        el.classList.toggle('urgent', diff < 3600000);
        onTick && onTick(diff);
        return true;
    }
    update();
    const interval = setInterval(() => { if (!update()) clearInterval(interval); }, 1000);
    return () => clearInterval(interval);
}
