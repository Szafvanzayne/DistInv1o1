/**
 * BigStore Pro - Database Module (Firebase Firestore)
 * Replaces idb with cloud-syncing Firestore + Local Persistence
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, enableMultiTabIndexedDbPersistence, collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, where, serverTimestamp, onSnapshot, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";


// Initialize Firebase
export const firebaseConfig = {
    apiKey: "AIzaSyB8YYpw79ldinopbmLhccGNXRI-g3HTafQ",
    authDomain: "bigstore-pro-cloud.firebaseapp.com",
    projectId: "bigstore-pro-cloud",
    storageBucket: "bigstore-pro-cloud.firebasestorage.app",
    messagingSenderId: "305318294275",
    appId: "1:305318294275:web:2f0b97a246e2f06d3b6f36",
    measurementId: "G-9H0F6XYBMT"
};

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
    profile: null, // Cached user profile (role, storeId)

    async open() {
        return true; // No longer needed, but kept for compatibility with app.js initialization
    },

    async fetchUserProfile(uid, email) {
        try {
            const userDocRef = doc(firestore, "users", uid);
            let docSnap = await getDoc(userDocRef);

            // Check for invites first (The Source of Truth for roles)
            let inviteData = null;
            if (email) {
                const q = query(collection(firestore, "staff_invites"), where("email", "==", email));
                const inviteSnap = await getDocs(q);
                if (!inviteSnap.empty) {
                    inviteData = inviteSnap.docs[0].data();
                }
            }

            if (docSnap.exists()) {
                this.profile = docSnap.data();

                // DATA REPAIR: If user is an admin but has a staff invite, sync the role/store
                if (inviteData && (this.profile.role !== inviteData.role || this.profile.storeId !== inviteData.storeId)) {
                    console.log("Syncing role/store from invite for:", email);
                    const updateObj = {
                        role: inviteData.role || 'staff',
                        storeId: inviteData.storeId,
                        invitedBy: inviteData.invitedBy
                    };
                    await updateDoc(userDocRef, updateObj);
                    this.profile = { ...this.profile, ...updateObj };

                    // If they are being promoted to Store Admin, ensure their store details are initialized/synced
                    if (this.profile.role === 'store_admin' && inviteData.storeDetails) {
                        await this.updateStoreDetails(this.profile.storeId, {
                            ...inviteData.storeDetails,
                            email: email.toLowerCase()
                        });
                    }

                    // Cleanup invite after syncing
                    await deleteDoc(doc(firestore, "staff_invites", email.toLowerCase()));
                }

                // Ensure email is stored if missing
                if (!this.profile.email && email) {
                    await updateDoc(userDocRef, { email: email });
                    this.profile.email = email;
                }
                return this.profile;
            } else {
                // New user flow
                if (inviteData) {
                    this.profile = {
                        email: email,
                        role: inviteData.role || 'staff',
                        storeId: inviteData.storeId || uid,
                        invitedBy: inviteData.invitedBy,
                        createdAt: serverTimestamp()
                    };

                    // If this is a new store admin from an invite, initialize their store details
                    if (this.profile.role === 'store_admin') {
                        const details = inviteData.storeDetails || {
                            name: 'My Store',
                            address: 'Update your address',
                            phone: '0000000000',
                            gstin: ''
                        };
                        await this.updateStoreDetails(this.profile.storeId, details);
                    }
                } else {
                    // Default profile for new registrations (Store Admin)
                    this.profile = {
                        email: email || '',
                        role: 'store_admin',
                        storeId: uid,
                        createdAt: serverTimestamp()
                    };
                    // Initialize default store details
                    await this.updateStoreDetails(uid, {
                        name: 'My Store',
                        address: 'Update your address',
                        phone: '0000000000',
                        gstin: ''
                    });
                }
                await setDoc(userDocRef, this.profile);

                // Cleanup invite after registration
                if (inviteData) {
                    await deleteDoc(doc(firestore, "staff_invites", email.toLowerCase()));
                }

                return this.profile;
            }
        } catch (err) {
            console.error("Error fetching user profile:", err);
            return { role: 'staff', storeId: uid }; // Fallback safety
        }
    },

    async getStoreDetails(storeId) {
        const id = storeId || this.getStoreId();
        const docRef = doc(firestore, "stores", id);
        const snap = await getDoc(docRef);
        return snap.exists() ? snap.data() : null;
    },

    async updateStoreDetails(storeId, details) {
        const id = storeId || this.getStoreId();
        const docRef = doc(firestore, "stores", id);

        // If this is a new store or staffLimit is not set, default to 3
        if (details.staffLimit === undefined) {
            const snap = await getDoc(docRef);
            if (!snap.exists() || snap.data().staffLimit === undefined) {
                details.staffLimit = 3;
            }
        }

        await setDoc(docRef, {
            ...details,
            updatedAt: serverTimestamp()
        }, { merge: true });
        return true;
    },

    getStoreId() {
        if (this.profile && this.profile.role === 'super_admin' && this.profile.activeStoreId) {
            return this.profile.activeStoreId;
        }
        if (this.profile && this.profile.storeId) {
            return this.profile.storeId;
        }
        const user = auth.currentUser;
        if (!user) throw new Error("User not authenticated.");
        return user.uid; // Using the authenticated user's UID as their isolated Store ID
    },

    async getAllStores() {
        // Fetch all store admins to list stores (User ID = Store ID)
        const q = query(collection(firestore, "users"), where("role", "==", "store_admin"));
        const snap = await getDocs(q);
        const stores = [];
        snap.forEach(doc => {
            const data = doc.data();
            stores.push({
                id: doc.id,
                email: data.email,
                name: data.email ? data.email.split('@')[0] : doc.id.slice(0, 8) // Fallback name
            });
        });
        return stores;
    },

    isAdmin() {
        return this.profile && (this.profile.role === 'store_admin' || this.profile.role === 'super_admin');
    },

    isSuperAdmin() {
        return this.profile && this.profile.role === 'super_admin';
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
    },

    async deleteInvoice(id) {
        try {
            const storeId = this.getStoreId();
            const docId = `${storeId}_${id}`;
            console.log("Attempting to delete invoice:", docId);
            await deleteDoc(doc(firestore, "invoices", docId));
            return true;
        } catch (err) {
            console.error("Failed to delete invoice:", err);
            throw err;
        }
    },

    async deductStock(barcode, qty) {
        try {
            const storeId = this.getStoreId();
            const docId = `${storeId}_${barcode}`;
            const productRef = doc(firestore, "products", docId);

            // Atomic decrement using increment(-qty)
            // This works offline and syncs correctly
            updateDoc(productRef, {
                stock: increment(-qty),
                updatedAt: serverTimestamp()
            }).catch(err => {
                console.error(`Failed to deduct stock for ${barcode}:`, err);
            });
            return true;
        } catch (err) {
            console.error("Error in deductStock:", err);
            return false;
        }
    },

    // --- Staff Management ---

    async addStaffInvite(email, role = 'staff', targetStoreId = null, storeDetails = null) {
        const inviterStoreId = this.getStoreId();
        const storeId = targetStoreId || inviterStoreId;

        await setDoc(doc(firestore, "staff_invites", email.toLowerCase()), {
            email: email.toLowerCase(),
            role: role,
            storeId: storeId,
            invitedBy: auth.currentUser.uid,
            status: 'pending',
            createdAt: serverTimestamp(),
            storeDetails: storeDetails || null
        });
        return true;
    },

    listenToStaff(callback) {
        const isMaster = this.isSuperAdmin() && !this.profile.activeStoreId;
        let qUsers, qInvites;

        if (isMaster) {
            // Global view for Super Admin on Master Dashboard
            qUsers = collection(firestore, "users");
            qInvites = collection(firestore, "staff_invites");
        } else {
            const storeId = this.getStoreId();
            qUsers = query(collection(firestore, "users"), where("storeId", "==", storeId));
            qInvites = query(collection(firestore, "staff_invites"), where("storeId", "==", storeId));
        }

        let users = [];
        let invites = [];

        const updateCallback = () => {
            const isUserSuperAdmin = this.isSuperAdmin();
            const isUserStoreAdmin = this.profile && this.profile.role === 'store_admin';
            let people = [...users];

            // SECURITY: If the viewer is NOT a Super Admin, hide all Super Admin accounts
            if (!isUserSuperAdmin) {
                people = people.filter(p => p.role !== 'super_admin');
            }

            // USER REQUIREMENT: Store Managers should only see their 'staff' (and their own account)
            if (isUserStoreAdmin) {
                people = people.filter(p => p.role === 'staff' || p.uid === auth.currentUser.uid);
            }

            invites.forEach(inv => {
                // Don't duplicate if they already registered
                if (!people.some(p => p.email === inv.email)) {
                    // SECURITY: Also hide Super Admin invites from non-masters
                    if (isUserSuperAdmin || inv.role !== 'super_admin') {
                        // USER REQUIREMENT: Store Managers only see Staff invites
                        if (isUserSuperAdmin || inv.role === 'staff') {
                            people.push({ uid: inv.id, email: inv.email, role: inv.role || 'staff', status: 'pending' });
                        }
                    }
                }
            });
            callback(people);
        };

        const unsubUsers = onSnapshot(qUsers, (snap) => {
            users = snap.docs.map(doc => ({ uid: doc.id, ...doc.data(), status: 'active' }));
            updateCallback();
        });

        const unsubInvites = onSnapshot(qInvites, (snap) => {
            invites = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            updateCallback();
        });

        // Combined unsubscribe cleanup
        return () => {
            unsubUsers();
            unsubInvites();
        };
    },

    async deleteStaff(uidOrInviteId, isInvite = false) {
        const collectionName = isInvite ? "staff_invites" : "users";
        if (!isInvite && uidOrInviteId === auth.currentUser.uid) return false;
        await deleteDoc(doc(firestore, collectionName, uidOrInviteId));
        return true;
    },

    // --- Super Admin Capabilities ---

    async getAllStores() {
        if (!this.isSuperAdmin()) return [];
        const q = query(collection(firestore, "users"), where("role", "==", "store_admin"));
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    listenToUserProfile(uid, callback) {
        return onSnapshot(doc(firestore, "users", uid), (doc) => {
            callback(doc.exists() ? doc.data() : null);
        });
    },

    async getStaffCount(storeId) {
        const q = query(collection(firestore, "users"), where("storeId", "==", storeId), where("role", "==", "staff"));
        const snap = await getDocs(q);
        return snap.size;
    },

    async createUserProfile(uid, data) {
        const userDocRef = doc(firestore, "users", uid);
        await setDoc(userDocRef, {
            ...data,
            createdAt: serverTimestamp()
        });
        return true;
    },

    async updateUserProfile(uid, data) {
        const userDocRef = doc(firestore, "users", uid);
        await updateDoc(userDocRef, {
            ...data,
            updatedAt: serverTimestamp()
        });
        return true;
    },

    // --- Customer Management ---

    async addCustomer(customer) {
        const storeId = this.getStoreId();
        customer.storeId = storeId;
        customer.createdAt = serverTimestamp();

        // Generate a simple ID if not provided (phone is a good candidate for customers)
        const id = customer.phone || Date.now().toString();
        await setDoc(doc(firestore, "customers", `${storeId}_${id}`), customer);
        return true;
    },

    async updateCustomer(id, details) {
        const storeId = this.getStoreId();
        const docRef = doc(firestore, "customers", `${storeId}_${id}`);
        await updateDoc(docRef, {
            ...details,
            updatedAt: serverTimestamp()
        });
        return true;
    },

    async deleteCustomer(id) {
        const storeId = this.getStoreId();
        await deleteDoc(doc(firestore, "customers", `${storeId}_${id}`));
        return true;
    },

    async getCustomer(id) {
        const storeId = this.getStoreId();
        const docSnap = await getDoc(doc(firestore, "customers", `${storeId}_${id}`));
        return docSnap.exists() ? docSnap.data() : null;
    },

    listenToCustomers(callback) {
        const storeId = this.getStoreId();
        const q = query(collection(firestore, "customers"), where("storeId", "==", storeId));
        return onSnapshot(q, (snap) => {
            const customers = [];
            snap.forEach(doc => {
                customers.push({ id: doc.id.replace(`${storeId}_`, ''), ...doc.data() });
            });
            callback(customers);
        }, (err) => {
            console.error("Firebase sync error on customers:", err);
        });
    }
};
