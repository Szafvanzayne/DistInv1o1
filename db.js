/**
 * BigStore Pro - Database Module (Firebase Firestore)
 * Replaces idb with cloud-syncing Firestore + Local Persistence
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, enableMultiTabIndexedDbPersistence, collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, where, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB8YYpw79ldinopbmLhccGNXRI-g3HTafQ",
    authDomain: "bigstore-pro-cloud.firebaseapp.com",
    projectId: "bigstore-pro-cloud",
    storageBucket: "bigstore-pro-cloud.firebasestorage.app",
    messagingSenderId: "305318294275",
    appId: "1:305318294275:web:2f0b97a246e2f06d3b6f36",
    measurementId: "G-9H0F6XYBMT"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

// Enable offline persistence (cache data for offline use and sync later)
enableMultiTabIndexedDbPersistence(firestore).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Firebase Persistence: Multiple tabs open, persistence enabled in first tab only.');
    } else if (err.code == 'unimplemented') {
        console.warn('Firebase Persistence: Browser does not support offline caching.');
    }
});

export const db = {
    async open() {
        return true; // No longer needed, but kept for compatibility with app.js initialization
    },

    getStoreId() {
        const user = auth.currentUser;
        if (!user) throw new Error("User not authenticated.");
        return user.uid; // Using the authenticated user's UID as their isolated Store ID
    },

    // --- Products ---

    async addProduct(product) {
        const storeId = this.getStoreId();
        product.storeId = storeId;
        product.updatedAt = serverTimestamp();

        const docId = `${storeId}_${product.barcode}`;
        // Do not await setDoc to prevent offline hanging
        setDoc(doc(firestore, "products", docId), product).catch(err => {
            console.error("Failed to sync product to cloud:", err);
        });
        return true;
    },

    async getProduct(barcode) {
        const storeId = this.getStoreId();
        const docId = `${storeId}_${barcode}`;
        const docSnap = await getDoc(doc(firestore, "products", docId));
        return docSnap.exists() ? docSnap.data() : null;
    },

    async getAllProducts() {
        const storeId = this.getStoreId();
        const q = query(collection(firestore, "products"), where("storeId", "==", storeId));
        const querySnapshot = await getDocs(q);
        const products = [];
        querySnapshot.forEach((doc) => {
            products.push(doc.data());
        });
        return products;
    },

    // New real-time listener for products
    listenToProducts(callback) {
        const storeId = this.getStoreId();
        const q = query(collection(firestore, "products"), where("storeId", "==", storeId));
        return onSnapshot(q, (querySnapshot) => {
            const products = [];
            querySnapshot.forEach((doc) => {
                products.push(doc.data());
            });
            callback(products);
        }, (error) => {
            console.error("Firebase sync error on products:", error);
        });
    },

    async deleteProduct(barcode) {
        const storeId = this.getStoreId();
        const docId = `${storeId}_${barcode}`;
        await deleteDoc(doc(firestore, "products", docId));
        return true;
    },

    // --- Invoices ---

    async createInvoice(invoice) {
        const storeId = this.getStoreId();
        invoice.storeId = storeId;
        invoice.updatedAt = serverTimestamp();

        const docId = `${storeId}_${invoice.id}`;
        // Do not await setDoc. Firebase will cache it locally immediately
        // but the promise only resolves when the server acknowledges it (which hangs offline).
        setDoc(doc(firestore, "invoices", docId), invoice).catch(err => {
            console.error("Failed to sync invoice to cloud:", err);
        });
        return true;
    },

    async getAllInvoices() {
        const storeId = this.getStoreId();
        const q = query(collection(firestore, "invoices"), where("storeId", "==", storeId));
        const querySnapshot = await getDocs(q);
        const invoices = [];
        querySnapshot.forEach((doc) => {
            invoices.push(doc.data());
        });
        return invoices;
    },

    // New real-time listener for invoices
    listenToInvoices(callback) {
        const storeId = this.getStoreId();
        const q = query(collection(firestore, "invoices"), where("storeId", "==", storeId));
        return onSnapshot(q, (querySnapshot) => {
            const invoices = [];
            querySnapshot.forEach((doc) => {
                invoices.push(doc.data());
            });
            callback(invoices);
        }, (error) => {
            console.error("Firebase sync error on invoices:", error);
        });
    },

    async getInvoice(id) {
        const storeId = this.getStoreId();
        const docId = `${storeId}_${id}`;
        const docSnap = await getDoc(doc(firestore, "invoices", docId));
        return docSnap.exists() ? docSnap.data() : null;
    }
};
