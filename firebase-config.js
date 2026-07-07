// ============================================================
// FIREBASE CONFIG — single source of truth, imported by every page
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// NOTE: Replace these values with your own Firebase project's config
// (Firebase console -> Project settings -> General -> Your apps -> SDK config).
// These are safe to expose in client-side code; access control is enforced
// through Firestore Security Rules (see /firestore.rules.md in this project).
const firebaseConfig = {
    apiKey: "AIzaSyCJ2eJ6kmfop87Dj6AnKtjvw58Qzk1QJW4",
    authDomain: "galaxy-cah.firebaseapp.com",
    projectId: "galaxy-cah",
    storageBucket: "galaxy-cah.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:0000000000000000000000"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Central place to tune business rules across every portal
export const CONFIG = {
    platformFeePercent: 0.03,       // 3% platform fee taken from winning bid
    listingFeeKES: 2500,            // flat fee charged when a seller lists an asset
    minBidIncrementPercent: 0.02,   // minimum next-bid increment (2%)
    minBidIncrementFloor: 1000,     // KES floor for the increment
    defaultAuctionDurations: [24, 48, 72],
    categories: [
        { value: "vehicle", label: "Vehicle", icon: "🚗" },
        { value: "tractor", label: "Tractor", icon: "🚜" },
        { value: "implement", label: "Farm Implement", icon: "🔧" },
        { value: "tool", label: "Tool / Equipment", icon: "🛠️" },
        { value: "general", label: "General Item", icon: "📦" }
    ],
    roles: ["buyer", "seller", "inspector", "admin"]
};
