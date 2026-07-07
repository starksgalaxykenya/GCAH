// ============================================================
// AUTH PAGE LOGIC (index.html)
// ============================================================
import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    onAuthStateChanged, updateProfile, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showToast, showLoading, hideLoading } from './shared.js';

const ROLE_HOME = {
    buyer: 'buyer-portal.html',
    seller: 'seller-portal.html',
    inspector: 'inspector-portal.html',
    admin: 'admin-portal.html'
};

let authMode = 'login';

function updateAuthForm() {
    const isRegister = authMode === 'register';
    document.getElementById('auth-name-group').style.display = isRegister ? 'block' : 'none';
    document.getElementById('auth-role-group').style.display = isRegister ? 'block' : 'none';
    document.getElementById('auth-forgot').style.display = isRegister ? 'none' : 'block';
    const btn = document.getElementById('auth-submit-btn');
    btn.innerHTML = isRegister ? '<i class="fas fa-user-plus"></i> Create Account' : '<i class="fas fa-sign-in-alt"></i> Sign In';
}

document.querySelectorAll('#auth-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('#auth-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        authMode = tab.dataset.authTab;
        updateAuthForm();
    });
});

document.getElementById('auth-forgot').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    if (!email) { showToast('Enter your email above first, then click "Forgot password?" again.', 'warning'); return; }
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset email sent to ' + email, 'success');
    } catch (err) { showToast(err.message, 'error'); }
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showLoading();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const name = document.getElementById('auth-name').value.trim();
    const role = document.getElementById('auth-role').value;
    const phone = document.getElementById('auth-phone')?.value.trim() || '';
    try {
        if (authMode === 'register') {
            if (!name) throw new Error('Full name is required');
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(cred.user, { displayName: name });
            await setDoc(doc(db, 'users', cred.user.uid), {
                uid: cred.user.uid, email, displayName: name, role, phone,
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
                kycVerified: false, totalBids: 0, totalWon: 0, escrowBalance: 0,
                reputation: 100, suspended: false
            });
            showToast('Account created! Welcome to Galaxy CAH.', 'success');
        } else {
            await signInWithEmailAndPassword(auth, email, password);
            showToast('Signed in successfully!', 'success');
        }
    } catch (error) {
        let msg = error.message;
        if (error.code === 'auth/email-already-in-use') msg = 'This email is already registered.';
        if (error.code === 'auth/invalid-credential') msg = 'Invalid email or password.';
        if (error.code === 'auth/weak-password') msg = 'Password must be at least 6 characters.';
        showToast(msg, 'error');
        hideLoading();
    }
});

// If already signed in, skip straight to the right portal.
onAuthStateChanged(auth, async (user) => {
    if (!user) { hideLoading(); return; }
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const role = userDoc.exists() ? userDoc.data().role : 'buyer';
        window.location.href = ROLE_HOME[role] || 'buyer-portal.html';
    } catch (e) {
        hideLoading();
    }
});

updateAuthForm();
