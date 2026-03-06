/**
 * BigStore Pro - Main Application Logic
 * 
 * This file contains the core logic for the Single Page Application (SPA).
 * It handles:
 * 1. State Management (storing data in memory)
 * 2. Navigation (switching 'screens' without reloading)
 * 3. Interactions (scanning, calculating tax, generating PDFs)
 * 4. Data Persistence (calls to db.js to save to IndexedDB)
 */

import { db, auth, firestore, firebaseConfig } from './db.js?v=2.3';
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

window.currentState = {
    view: 'home',            // Current visible screen
    inventory: [],           // List of products (cached)
    cart: [],                // Items currently in the bill
    currentInvoice: null,    // The invoice being generated
    currentPdfBlob: null,    // The PDF file data
    unsubProducts: null,     // Firebase snapshot listener functions
    unsubInvoices: null,
    unsubProfile: null,
    unsubCustomers: null,
    editingInvoiceId: null,
    editingInvoiceDate: null,
    selectedCustomer: null,
    priceType: 'retail'
};

// --- Initialization ---
// This runs when the page first loads. It checks for dependencies and starts the DB.
document.addEventListener('DOMContentLoaded', async () => {
    console.log("BigStore Pro Initializing...");

    // Initialize the database connection (Firebase)
    await db.open();
    console.log("Database initialized");

    setupNavigation();

    // Listen to Firebase Auth state
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            console.log("User logged in:", user.uid);
            window.currentState.user = user;

            // Fetch User Profile (Role-Based Access)
            const profile = await db.fetchUserProfile(user.uid, user.email);
            console.log("User profile loaded:", profile.role);

            // Session Guardian: Watch if profile is deleted by admin
            if (window.currentState.unsubProfile) window.currentState.unsubProfile();
            window.currentState.unsubProfile = db.listenToUserProfile(user.uid, (p) => {
                if (!p) {
                    // Profile deleted! Force logout
                    console.warn("Access revoked by admin. Logging out...");
                    alert("Your access has been revoked by an administrator.");
                    signOut(auth);
                }
            });

            // Show lower navigation tools
            const nav = document.querySelector('.bottom-nav');
            if (nav) {
                nav.style.display = 'flex';
                // Hide Management/Staff icons based on role
                updateNavVisibility(profile.role);
            }

            // Re-render current view or go home if on login
            if (window.currentState.view === 'login' || !window.currentState.view) {
                renderView('home');
            } else {
                renderView(window.currentState.view);
            }
        } else {
            console.log("User logged out");
            window.currentState.user = null;
            db.profile = null; // Clear cached profile
            // Hide navigation items so user cannot access inventory without login
            const nav = document.querySelector('.bottom-nav');
            if (nav) nav.style.display = 'none';

            renderView('login');
        }
    });
});

function updateNavVisibility(role) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const target = item.dataset.target;
        if (target === 'management' || target === 'settings') {
            item.style.display = (role === 'super_admin' || role === 'store_admin') ? 'flex' : 'none';
        } else {
            item.style.display = 'flex';
        }
    });
}

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const target = item.dataset.target;
            if (target) {
                navItems.forEach(nav => nav.classList.remove('active'));
                if (!item.classList.contains('fab')) {
                    item.classList.add('active');
                }
                renderView(target);
            }
        });
    });
}

// --- View Rendering (Router) ---
// This function handles the "Navigation". It clears the #app container and
// injects the HTML for the requested specific screen.
//
// EDITING TIP: To change the look of a page, find the corresponding 'case' below.
// To add a new page:
// 1. Add a new 'case "new-page-name":'
// 2. Define the HTML in app.innerHTML = ...
// 3. Call renderView('new-page-name') to go there.
const cleanupListeners = () => {
    if (window.currentState.unsubInvoices) {
        window.currentState.unsubInvoices();
        window.currentState.unsubInvoices = null;
    }
    if (window.currentState.unsubProducts) {
        window.currentState.unsubProducts();
        window.currentState.unsubProducts = null;
    }
};

window.renderView = async (viewName) => {
    const app = document.getElementById('app');
    cleanupListeners(); // Stop background syncing to old DOM elements
    app.innerHTML = ''; // Clear current screen
    console.log(`Navigating to ${viewName}`);

    switch (viewName) {
        case 'login':
            app.innerHTML = `
                <div class="screen active" style="display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 20px; text-align: center; min-height: 80vh;">
                    <div style="margin-bottom: 30px;">
                        <span class="material-icons-round" style="font-size: 64px; color: #1e3a8a;">storefront</span>
                        <h1 style="color: #1e3a8a; margin-top: 10px;">BigStore Pro</h1>
                        <p style="color: #6b7280;">Secure Cloud Login</p>
                    </div>
                    
                    <form onsubmit="handleAuth(event)" style="width: 100%; max-width: 400px; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); text-align: left;">
                        <div style="margin-bottom: 15px;">
                            <label>Email ID</label>
                            <input type="email" name="email" required placeholder="store@example.com">
                        </div>
                        <div style="margin-bottom: 20px;">
                            <label>Password</label>
                            <input type="password" name="password" required placeholder="••••••••">
                        </div>
                        <div id="auth-error" style="color: red; font-size: 14px; margin-bottom: 15px; display: none;"></div>
                        <button type="submit" name="action" value="login" onclick="this.form.submitedBtn='login'" class="btn-primary" style="margin-bottom: 10px;">Login securely</button>
                    </form>
                </div>
            `;
            break;

        case 'home':
            app.innerHTML = `
                <div class="screen active" style="padding: 0;">
                    <div class="wave-header"></div>
                    <div style="position: relative; z-index: 2; padding: 20px;">
                        <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; margin-top: 10px;">
                            <div>
                                <h1 style="color: white; margin-bottom: 5px;">Dashboard</h1>
                                <p style="color: rgba(255,255,255,0.8); font-size: 14px;">Welcome Back, ${db.profile.role.replace('_', ' ')}</p>
                            </div>
                            <div style="width: 48px; height: 48px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                                <span class="material-icons-round" style="color: #1e3a8a;">person</span>
                            </div>
                        </header>

                        ${db.isSuperAdmin() ? `
                            <div class="card" style="margin-bottom: 20px; padding: 15px; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); color: white; border: none;">
                                <label style="color: white; font-size: 12px; margin-bottom: 8px; display: block;">SUPER ADMIN: View Store</label>
                                <select id="store-selector" onchange="setActiveStore(this.value)" style="width: 100%; padding: 10px; border-radius: 8px; border: none; background: white; color: #1e3a8a; font-weight: 600;">
                                    <option value="">My Master ID (${window.currentState.user.uid.slice(0, 8)})</option>
                                    <option disabled>Loading other stores...</option>
                                </select>
                            </div>
                        ` : ''}
                        
                        <!-- Stats Cards (2x2 Grid) -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px;">
                            <div class="stat-card">
                                <span class="material-icons-round" style="color: #1e3a8a; font-size: 24px;">receipt_long</span>
                                <h2 id="stat-invoices-today" style="color: #1f2937; margin-top: 10px;">0</h2>
                                <span style="color: #6b7280; font-size: 12px;">Invoices Today</span>
                            </div>
                            <div class="stat-card">
                                <span class="material-icons-round" style="color: #10b981; font-size: 24px;">payments</span>
                                <h2 id="stat-sales-today" style="color: #1f2937; margin-top: 10px;">₹0</h2>
                                <span style="color: #6b7280; font-size: 12px;">Sales Today</span>
                            </div>
                            <div class="stat-card">
                                <span class="material-icons-round" style="color: #f59e0b; font-size: 24px;">inventory_2</span>
                                <h2 id="stat-total-products" style="color: #1f2937; margin-top: 10px;">0</h2>
                                <span style="color: #6b7280; font-size: 12px;">Items in Store</span>
                            </div>
                            <div class="stat-card">
                                <span class="material-icons-round" style="color: #ef4444; font-size: 24px;">warning_amber</span>
                                <h2 id="stat-low-stock" style="color: #1f2937; margin-top: 10px;">0</h2>
                                <span style="color: #6b7280; font-size: 12px;">Low Stock Alerts</span>
                            </div>
                        </div>

                        <h3 style="margin-bottom: 15px; color: #1e3a8a; font-weight: 600;">Quick Actions</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px;">
                             <button class="btn-primary" onclick="renderView('scan')" style="height: 60px;">
                                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
                                    <span class="material-icons-round" style="font-size: 20px;">qr_code_scanner</span> 
                                    <span style="font-size: 12px;">Invoice</span>
                                </div>
                            </button>
                            
                            <button class="btn-secondary" onclick="renderView('inventory')" style="height: 60px;">
                                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
                                    <span class="material-icons-round" style="font-size: 20px;">add_circle</span> 
                                    <span style="font-size: 12px;">Add Stock</span>
                                </div>
                            </button>

                            <button class="btn-secondary" onclick="renderView('customers')" style="background: #f0fdf4; border-color: #bbf7d0; color: #15803d; height: 60px;">
                                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
                                    <span class="material-icons-round" style="font-size: 20px;">assignment_ind</span> 
                                    <span style="font-size: 12px; font-weight: 700;">Customers</span>
                                </div>
                            </button>
                        </div>

                        ${db.isAdmin() ? `
                            <h3 style="margin-bottom: 15px; color: #1e3a8a; font-weight: 600;">Administrative Tools</h3>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                <button class="btn-secondary" onclick="renderView('reports')" style="background: #eff6ff; border-color: #bfdbfe; color: #1e40af; height: 80px; padding: 5px;">
                                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;">
                                        <span class="material-icons-round" style="font-size: 20px;">analytics</span> 
                                        <span style="font-size: 11px; font-weight: 700;">Reports</span>
                                    </div>
                                </button>
                                <button class="btn-secondary" onclick="renderView('management')" style="background: #fdf2f8; border-color: #fbcfe8; color: #9d174d; height: 80px; padding: 5px;">
                                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;">
                                        <span class="material-icons-round" style="font-size: 20px;">people</span> 
                                        <span style="font-size: 11px; font-weight: 700;">Staff</span>
                                    </div>
                                </button>
                            </div>
                        ` : ''}

                        <div style="height: 80px;"></div>
                    </div>
                </div>
            `;
            loadDashboardStats();
            if (db.isSuperAdmin()) loadStoreSelector();
            break;

        case 'inventory':
            app.innerHTML = `
                <div class="screen active">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h1>Inventory</h1>
                        <button class="btn-primary" style="width: auto; padding: 10px 20px; font-size: 14px;" onclick="showAddProductForm()">
                            + Add New
                        </button>
                    </div>
                    
                    <div id="inventory-list" style="padding-bottom: 80px;">
                        <div class="text-center text-muted">Loading live data...</div>
                    </div>
                </div>
            `;
            // Attach real-time listener
            if (window.currentState.unsubProducts) window.currentState.unsubProducts();
            window.currentState.unsubProducts = db.listenToProducts(products => {
                renderInventoryList(products);
            });
            break;

        case 'add-product':
            app.innerHTML = `
                <div class="screen active">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                        <button onclick="renderView('inventory')" style="background:none; border:none; padding:0;">
                            <span class="material-icons-round" style="color: var(--text-main);">arrow_back</span>
                        </button>
                        <h1>Add Product</h1>
                    </div>

                    <form id="add-product-form" onsubmit="handleSaveProduct(event)">
                        <div class="card">
                            <h3 class="mb-2">Basic Info</h3>
                            <div style="position: relative;">
                                <label>Barcode / SKU</label>
                                <div style="display: flex; gap: 10px;">
                                    <input type="text" name="barcode" id="p-barcode" required placeholder="Scan or type..." style="margin-bottom: 0;">
                                    <button type="button" onclick="startScannerForField('p-barcode')" style="background: #eef2f6; border: none; border-radius: 8px; width: 50px; display: flex; align-items: center; justify-content: center;">
                                        <span class="material-icons-round" style="color: #1e3a8a;">qr_code_scanner</span>
                                    </button>
                                </div>
                            </div>
                            <div style="margin-top: 15px;">
                                <label>Product Name</label>
                                <input type="text" name="name" required placeholder="e.g. Maggi 100g">
                            </div>
                             <div style="margin-top: 15px;">
                                <label>HSN Number</label>
                                <input type="number" name="hsn" placeholder="123456">
                            </div>
                        </div>

                        <div class="card">
                            <h3 class="mb-2">Stock & Unit</h3>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                <div>
                                    <label>Stock Qty</label>
                                    <input type="number" name="stock" required value="0">
                                </div>
                                <div>
                                    <label>Pack Size</label>
                                    <input type="number" name="pack" value="1">
                                </div>
                                <div>
                                    <label>Measure</label>
                                    <input type="number" step="0.01" name="measure" placeholder="1.0">
                                </div>
                            </div>
                        </div>

                        <div class="card">
                            <h3 class="mb-2">Pricing</h3>
                             <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                <div>
                                    <label>Cost Price</label>
                                    <input type="number" step="0.01" name="costPrice" placeholder="0.00">
                                </div>
                                <div>
                                    <label>Retail Price</label>
                                    <input type="number" step="0.01" name="retailPrice" id="p-retail" required placeholder="0.00" oninput="calculateGST()">
                                </div>
                                <div>
                                    <label>Wholesale Price</label>
                                    <input type="number" step="0.01" name="wholesalePrice" placeholder="0.00">
                                </div>
                                <div>
                                    <label>Card Price</label>
                                    <input type="number" step="0.01" name="cardPrice" placeholder="0.00">
                                </div>
                            </div>
                        </div>

                        <div class="card">
                            <h3 class="mb-2">Tax (GST)</h3>
                            <label>GST Slab</label>
                            <select name="gstSlab" id="p-slab" onchange="calculateGST()" style="width: 100%; padding: 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-surface); margin-bottom: 15px;">
                                <option value="0">0%</option>
                                <option value="5">5%</option>
                                <option value="12">12%</option>
                                <option value="18">18%</option>
                                <option value="28">28%</option>
                            </select>

                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                                <div>
                                    <label>GST Amt</label>
                                    <input type="number" step="0.01" name="gstAmount" id="p-gst" readonly style="background: var(--bg-surface-2);">
                                </div>
                                <div>
                                    <label>CGST</label>
                                    <input type="number" step="0.01" name="cgst" id="p-cgst" readonly style="background: var(--bg-surface-2);">
                                </div>
                                <div>
                                    <label>SGST</label>
                                    <input type="number" step="0.01" name="sgst" id="p-sgst" readonly style="background: var(--bg-surface-2);">
                                </div>
                            </div>
                        </div>

                        <button type="submit" class="btn-primary" style="margin-bottom: 50px;">Save Product</button>
                    </form>
                </div>
            `;
            break;

        case 'scan':
            app.innerHTML = `
                <div class="screen active" style="padding-bottom: 100px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                        <button onclick="renderView('home')" style="background:none; border:none; padding:0;">
                            <span class="material-icons-round" style="color: var(--text-main);">arrow_back</span>
                        </button>
                        <h1>New Invoice</h1>
                    </div>

                    <!-- Customer Info -->
                    <div class="card" style="padding: 15px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <label style="margin-bottom: 0;">Customer Selection</label>
                            <span id="price-tier-badge" style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #dcfce7; color: #166534; text-transform: uppercase; font-weight: 700;">Retail Tier</span>
                        </div>
                        <div style="position: relative; display: flex; gap: 10px;">
                            <div style="flex: 1; position: relative;">
                                <input type="text" id="cust-search" placeholder="Search Customer or Walk-in..." oninput="handleCustomerSearchInput(this.value)" style="margin-bottom: 0;">
                                <div id="cust-search-results" style="display: none; position: absolute; top: 100%; left: 0; width: 100%; background: white; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); z-index: 102; max-height: 200px; overflow-y: auto;"></div>
                            </div>
                            <button onclick="showAddCustomerModal()" style="background: #1e3a8a; color: white; border: none; border-radius: 8px; width: 45px; display: flex; align-items: center; justify-content: center; height: 45px;">
                                <span class="material-icons-round">person_add</span>
                            </button>
                        </div>
                        <input type="hidden" id="cust-id">
                        <div id="selected-customer-details" style="display: none; margin-top: 10px; font-size: 13px; color: #1e3a8a; font-weight: 600;">
                            Selected: <span id="display-cust-name"></span> (<span id="display-cust-phone"></span>)
                            <button onclick="clearSelectedCustomer()" style="background:none; border:none; color:#ef4444; margin-left:10px; font-size:11px;">Clear</button>
                        </div>
                    </div>

                    <!-- Scan / Search Area -->
                    <div class="card" style="padding: 15px; background: #eef2f6; border: none;">
                        <div style="display: flex; gap: 10px;">
                             <button onclick="startCameraScan()" style="background: #1e3a8a; border: none; border-radius: 8px; width: 60px; display: flex; align-items: center; justify-content: center;">
                                <span class="material-icons-round" style="color: white; font-size: 24px;">qr_code_scanner</span>
                            </button>
                            <div style="flex: 1; position: relative;">
                                <input type="text" id="product-search" placeholder="Type Name or Scan..." style="margin-bottom: 0; padding-right: 40px;" oninput="handleSearchInput(this.value)">
                                <span class="material-icons-round" style="position: absolute; right: 10px; top: 12px; color: var(--text-muted);">search</span>
                            </div>
                        </div>
                        <div id="search-results" style="display: none; background: white; margin-top: 10px; border-radius: 8px; max-height: 200px; overflow-y: auto; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                            <!-- Dropdown Results -->
                        </div>
                    </div>

                    <!-- Cart Items -->
                    <h3 style="margin: 20px 0 10px 0;">Items (<span id="cart-count">0</span>)</h3>
                    <div id="cart-list">
                        <div class="text-center text-muted" style="margin-top: 30px;">Cart is empty</div>
                    </div>

                    </div>
                </div>

                <!-- Footer Totals (Floating above Nav) -->
                <div style="position: fixed; bottom: 70px; left: 0; width: 100%; background: white; padding: 15px 20px; box-shadow: 0 -4px 10px rgba(0,0,0,0.05); z-index: 101; border-top-left-radius: 20px; border-top-right-radius: 20px; border: 1px solid #eee;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <span style="color: var(--text-secondary);">Total</span>
                        <h1 style="color: #1e3a8a;" id="cart-total">₹0.00</h1>
                    </div>
                    <button class="btn-primary" onclick="generateInvoice()">Generate Invoice</button>
                </div>
            `;
            if (currentState.cart.length > 0) renderCart();

            // Restore Selected Customer UI
            if (currentState.selectedCustomer) {
                const c = currentState.selectedCustomer;
                const dName = document.getElementById('display-cust-name');
                const dPhone = document.getElementById('display-cust-phone');
                const dDetails = document.getElementById('selected-customer-details');

                if (dName && dPhone && dDetails) {
                    dName.innerText = c.name;
                    dPhone.innerText = c.phone;
                    dDetails.style.display = 'block';
                }

                const badge = document.getElementById('price-tier-badge');
                if (badge) {
                    const priceType = c.priceType || 'retail';
                    badge.innerText = `${priceType} Tier`;
                    badge.style.background = priceType === 'retail' ? '#dcfce7' : priceType === 'wholesale' ? '#dbeafe' : '#fef3c7';
                    badge.style.color = priceType === 'retail' ? '#166534' : priceType === 'wholesale' ? '#1e40af' : '#92400e';
                }
            }
            break;

        case 'invoice-preview':
            // Expects currentState.currentInvoice to be set
            const inv = currentState.currentInvoice;
            if (!inv) { renderView('home'); return; }

            const shopSettings = await db.getStoreDetails() || {
                name: 'BigStore Pro',
                gstin: 'NOT SET',
                address: '',
                phone: ''
            };

            app.innerHTML = `
                <div class="screen active" style="padding-bottom: 20px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                        <button onclick="renderView('scan')" style="background:none; border:none; padding:0;">
                            <span class="material-icons-round" style="color: var(--text-main);">arrow_back</span>
                        </button>
                        <h1>Order Summary</h1>
                    </div>

                    <!-- HTML Invoice Summary -->
                    <div class="card" style="padding: 20px; font-family: 'Inter', sans-serif; border: 1px solid #e2e8f0; background: #fff;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2 style="color: #1e3a8a; margin: 0; text-transform: uppercase;">${shopSettings.name}</h2>
                            <p style="font-size: 11px; color: #64748b; margin-top: 2px;">${shopSettings.address} ${shopSettings.phone ? ' | ' + shopSettings.phone : ''}</p>
                            <p style="font-size: 11px; color: #64748b; margin-top: 5px;">#${inv.id}</p>
                        </div>

                        <div style="display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 13px;">
                            <div>
                                <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase;">Customer</div>
                                <div style="font-weight: 600;">${inv.customerName}</div>
                                ${inv.customerPhone ? `<div style="font-size: 11px; color: #64748b;">${inv.customerPhone}</div>` : ''}
                            </div>
                            <div style="text-align: right;">
                                <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase;">Date</div>
                                <div style="font-weight: 600;">${new Date(inv.date).toLocaleDateString()}</div>
                                ${inv.priceType ? `<div style="font-size: 10px; color: #1e3a8a; font-weight: 700; text-transform: uppercase; margin-top: 4px;">${inv.priceType} Price</div>` : ''}
                            </div>
                        </div>

                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 12px;">
                            <thead>
                                <tr style="border-bottom: 1px solid #f1f5f9; text-align: left; color: #64748b;">
                                    <th style="padding: 8px 0;">Item</th>
                                    <th style="padding: 8px 0; text-align: center;">Qty</th>
                                    <th style="padding: 8px 0; text-align: right;">Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${inv.items.map(item => `
                                    <tr style="border-bottom: 1px solid #f8fafc;">
                                        <td style="padding: 8px 0;">${item.name}</td>
                                        <td style="padding: 8px 0; text-align: center;">${item.qty}</td>
                                        <td style="padding: 8px 0; text-align: right;">₹${((item.priceUsed || item.retailPrice) * item.qty).toFixed(2)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>

                        <div style="border-top: 2px dashed #f1f5f9; padding-top: 10px;">
                            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px;">
                                <span style="color: #64748b;">Subtotal</span>
                                <span>₹${inv.totalTaxable.toFixed(2)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px;">
                                <span style="color: #64748b;">Tax (GST)</span>
                                <span>₹${inv.totalTax.toFixed(2)}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; color: #1e3a8a; margin-top: 10px;">
                                <span>Total</span>
                                <span>₹${inv.totalAmount.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Actions -->
                    <div class="card" style="padding: 15px;">
                        <h3 class="mb-2">Send or Save</h3>
                         <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <button onclick="shareInvoice('whatsapp', this)" style="background: #25D366; color: white; border: none; padding: 12px; border-radius: 6px; font-weight: 600; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                <span class="material-icons-round">chat</span> WhatsApp
                            </button>
                            <button onclick="shareInvoice('email', this)" style="background: #EA4335; color: white; border: none; padding: 12px; border-radius: 6px; font-weight: 600; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                <span class="material-icons-round">email</span> Email
                            </button>
                             <button onclick="shareInvoice('download', this)" style="background: #1e3a8a; color: white; border: none; padding: 12px; border-radius: 6px; font-weight: 600; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                <span class="material-icons-round">download</span> Download
                            </button>
                             <button onclick="shareInvoice('print', this)" style="background: var(--bg-surface-2); color: var(--text-main); border: none; padding: 12px; border-radius: 6px; font-weight: 600; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                                <span class="material-icons-round">print</span> Print
                            </button>
                        </div>
                    </div>
                    
                    <button class="btn-secondary" style="margin-top: 20px; width: 100%;" onclick="renderView('home'); currentState.cart = [];">
                        Done (Start New)
                    </button>
                </div>
            `;
            break;

        case 'reports':
            app.innerHTML = `
                <div class="screen active">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                        <button onclick="renderView('home')" style="background:none; border:none; padding:0;">
                            <span class="material-icons-round" style="color: var(--text-main);">arrow_back</span>
                        </button>
                        <h1 style="flex: 1;">Analytics</h1>
                         <button class="btn-secondary" style="width: auto; padding: 5px 15px;" onclick="renderView('invoices')">
                            <span class="material-icons-round" style="font-size: 18px; vertical-align: middle;">receipt_long</span> History
                        </button>
                    </div>

                    <div class="card" style="padding: 15px; margin-bottom: 20px;">
                        <h3 style="margin-bottom: 15px; color: #1e3a8a;">Sales Trend (Today)</h3>
                        <canvas id="salesChart" height="200"></canvas>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                        <div class="stat-card">
                            <span style="font-size: 12px; color: #6b7280;">Avg. Bill Value</span>
                            <h2 id="report-avg-bill">₹0</h2>
                        </div>
                        <div class="stat-card">
                            <span style="font-size: 12px; color: #6b7280;">Total Items Sold</span>
                            <h2 id="report-total-items">0</h2>
                        </div>
                    </div>

                    <div class="card" style="padding: 15px;">
                        <h3 style="margin-bottom: 15px; color: #1e3a8a;">Top Products</h3>
                        <div id="top-products-list">
                            <!-- Top 3 products placeholder -->
                            <div class="text-center text-muted">Calculating...</div>
                        </div>
                    </div>
                </div>
            `;
            if (window.currentState.unsubReports) window.currentState.unsubReports();
            window.currentState.unsubReports = db.listenToInvoices(invoices => {
                renderReportsDashboard(invoices);
            });
            break;

        case 'management':
            app.innerHTML = `
                <div class="screen active">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                        <button onclick="renderView('home')" style="background:none; border:none; padding:0;">
                            <span class="material-icons-round" style="color: var(--text-main);">arrow_back</span>
                        </button>
                        <h1 style="flex: 1;">Staff</h1>
                        <button class="btn-primary" style="width: auto; padding: 10px 20px;" onclick="showAddStaffModal()">
                            + Add
                        </button>
                    </div>
 
                    <div id="staff-list" style="margin-top: 20px; padding-bottom: 80px;">
                        <div class="text-center text-muted">Loading staff...</div>
                    </div>
                </div>
            `;
            if (window.currentState.unsubStaff) window.currentState.unsubStaff();
            window.currentState.unsubStaff = db.listenToStaff(staff => {
                renderStaffList(staff);
            });
            break;

        case 'customers':
            app.innerHTML = `
                <div class="screen active">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                        <button onclick="renderView('home')" style="background:none; border:none; padding:0;">
                            <span class="material-icons-round" style="color: var(--text-main);">arrow_back</span>
                        </button>
                        <h1 style="flex: 1;">Customers</h1>
                        <button class="btn-primary" style="width: auto; padding: 10px 20px;" onclick="showAddCustomerModal()">
                            + Add New
                        </button>
                    </div>
 
                    <div id="customer-list" style="margin-top: 20px; padding-bottom: 80px;">
                        <div class="text-center text-muted">Loading customers...</div>
                    </div>
                </div>
            `;
            if (window.currentState.unsubCustomers) window.currentState.unsubCustomers();
            window.currentState.unsubCustomers = db.listenToCustomers(customers => {
                renderCustomerList(customers);
            });
            break;

        case 'invoices':
            app.innerHTML = `
                <div class="screen active">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
                        <button onclick="renderView('home')" style="background:none; border:none; padding:0;">
                            <span class="material-icons-round" style="color: var(--text-main);">arrow_back</span>
                        </button>
                        <h1>History</h1>
                    </div>
                    <div id="invoice-list" style="margin-top: 20px; padding-bottom: 80px;">
                        <div class="text-center text-muted">Loading live data...</div>
                    </div>
                </div>
            `;
            if (window.currentState.unsubInvoices) window.currentState.unsubInvoices();
            window.currentState.unsubInvoices = db.listenToInvoices(invoices => {
                renderInvoiceList(invoices);
            });
            break;

        case 'settings':
            let settings = await db.getStoreDetails();

            // Migration / Default fallback
            if (!settings) {
                const local = JSON.parse(localStorage.getItem('shopSettings'));
                settings = local || {
                    name: 'BigStore Pro',
                    gstin: '29ABCDE1234F1Z5',
                    address: 'Kerala, India',
                    phone: '9876543210'
                };
                // Initialize Firestore with local data or defaults
                await db.updateStoreDetails(null, settings);
            }

            const isStaff = db.profile && db.profile.role === 'staff';

            app.innerHTML = `
                <div class="screen active">
                    <h1>Settings</h1>
                    
                    <div class="card" style="margin-top: 20px;">
                        <h3 class="mb-2">Store Details</h3>
                        <p style="color: var(--text-secondary); font-size: 12px; margin-bottom: 15px;">
                            ${isStaff ? 'Viewing store information (Read-only for Staff)' : 'These details will appear on your invoices.'}
                        </p>
                        
                        <form onsubmit="saveSettings(event)">
                            <div style="margin-bottom: 15px;">
                                <label>Shop Name</label>
                                <input type="text" name="shopName" value="${settings.name}" required ${isStaff ? 'readonly style="background: #f8fafc; cursor: not-allowed;"' : ''}>
                            </div>
                            <div style="margin-bottom: 15px;">
                                <label>GSTIN</label>
                                <input type="text" name="gstin" value="${settings.gstin}" ${isStaff ? 'readonly style="background: #f8fafc; cursor: not-allowed;"' : ''}>
                            </div>
                             <div style="margin-bottom: 15px;">
                                <label>Address</label>
                                <input type="text" name="address" value="${settings.address}" ${isStaff ? 'readonly style="background: #f8fafc; cursor: not-allowed;"' : ''}>
                            </div>
                            <div style="margin-bottom: 15px;">
                                <label>Phone</label>
                                <input type="text" name="phone" value="${settings.phone}" ${isStaff ? 'readonly style="background: #f8fafc; cursor: not-allowed;"' : ''}>
                            </div>
                            ${isStaff ? '' : '<button type="submit" class="btn-primary">Save Details</button>'}
                        </form>
                    </div>

                    <div class="card">
                        <h3 class="mb-2">About</h3>
                        <p style="color: var(--text-secondary); line-height: 1.6;">
                            <strong>BigStore Pro</strong> is a lightweight, offline-first inventory and billing tool designed for small businesses.
                            Built with PWA technology for maximum speed and compatibility.
                        </p>
                    </div>

                    <div style="text-align: center; margin-top: 30px; color: var(--text-secondary);">
                        <p>App Version: <strong>v3.5 (Cloud Sync Active)</strong></p>
                        <p style="font-size: 12px; margin-top: 5px;">&copy; 2026 BigStore Pro</p>
                    </div>
                    
                    <div style="margin-top: 30px;">
                        <button class="btn-primary" style="background: #ef4444; width: 100%; border-color: #ef4444;" onclick="logout()">Log Out Session</button>
                    </div>

                    <div style="height: 50px;"></div>
                </div>
            `;
            break;
    }
}

// --- Navigation Helpers & Auth ---

window.handleAuth = async (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    const password = e.target.password.value;
    const action = e.target.submitedBtn || 'login';
    const errorDiv = document.getElementById('auth-error');
    if (errorDiv) errorDiv.style.display = 'none';

    try {
        if (action === 'register') {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            // db.fetchUserProfile takes care of checking invites and setting the correct role/storeId
            await db.fetchUserProfile(userCredential.user.uid, email);
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
    } catch (err) {
        if (errorDiv) {
            errorDiv.innerText = err.message.replace('Firebase: ', '');
            errorDiv.style.display = 'block';
        } else {
            alert(err.message);
        }
    }
};

window.handleDirectStaffCreate = async (e) => {
    e.preventDefault();
    const email = document.getElementById('staff-email').value;
    const password = document.getElementById('staff-password').value;
    const role = document.getElementById('staff-role').value;
    const staffLimitInput = document.getElementById('staff-limit');
    const staffLimit = staffLimitInput ? parseInt(staffLimitInput.value) : 3;
    const btn = e.target.querySelector('button');

    // --- Update Handling Branch ---
    if (window.editingStaffUid) {
        try {
            btn.disabled = true;
            btn.innerText = 'Updating...';

            const profileData = {
                role: role,
                storeId: document.getElementById('staff-store-id')?.value || db.getStoreId()
            };

            await db.updateUserProfile(window.editingStaffUid, profileData);

            alert("Staff role updated successfully!");
            document.getElementById('staff-modal').style.display = 'none';
        } catch (err) {
            alert("Failed to update: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = 'Update Account';
        }
        return;
    }

    // Security Check: Only Super Admin can create Store Admins
    if (role === 'store_admin' && !db.isSuperAdmin()) {
        alert("Action Denied: Only Super Admins can create Store Admin accounts.");
        return;
    }

    if (password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }

    let storeDetails = null;
    let targetStoreId = null;

    if (role === 'store_admin') {
        storeDetails = {
            name: document.getElementById('staff-store-name').value,
            phone: document.getElementById('staff-store-phone').value,
            address: document.getElementById('staff-store-address').value,
            gstin: document.getElementById('staff-store-gst').value
        };
    } else {
        targetStoreId = document.getElementById('staff-store-id').value;
        if (!targetStoreId && db.isSuperAdmin()) {
            alert("Please select a store for this staff member.");
            return;
        }

        // --- Staff Limit Check ---
        const finalStoreId = targetStoreId || db.getStoreId();
        const count = await db.getStaffCount(finalStoreId);
        const storeInfo = await db.getStoreDetails(finalStoreId);
        const limit = (storeInfo && storeInfo.staffLimit) ? parseInt(storeInfo.staffLimit) : 3;

        if (count >= limit) {
            alert(`Limit Reached: This store is allowed only ${limit} staff members. Contact Super Admin to upgrade.`);
            return;
        }
        targetStoreId = finalStoreId;
    }

    const roleLabel = role === 'store_admin' ? 'Store Admin' : 'Staff';
    if (!confirm(`Create ${roleLabel} account for ${email}?`)) {
        return;
    }

    // Secondary App Helper to prevent current Admin logout
    const tempAppName = `TempApp_${Date.now()}`;
    const tempApp = initializeApp(firebaseConfig, tempAppName);
    const tempAuth = getAuth(tempApp);

    try {
        btn.disabled = true;
        btn.innerText = 'Creating account...';

        // 1. Create Auth Account using secondary instance
        try {
            const userCredential = await createUserWithEmailAndPassword(tempAuth, email, password);
            const uid = userCredential.user.uid;

            // 2. Create Firestore Profile (Immediate Activation)
            // SECURITY: Store Admins ALWAYS use their own UID as their store identity
            const profileData = {
                email: email.toLowerCase(),
                role: role,
                storeId: role === 'store_admin' ? uid : (targetStoreId || uid),
                status: 'active'
            };
            await db.createUserProfile(uid, profileData);

            // 3. If Store Admin, update store details (including limit)
            if (role === 'store_admin') {
                await db.updateStoreDetails(uid, {
                    ...storeDetails,
                    email: email.toLowerCase(),
                    staffLimit: staffLimit
                });
            }

            // Clean up secondary app
            await signOut(tempAuth);
            await deleteApp(tempApp);

            alert(`${roleLabel} account created successfully!`);
        } catch (authErr) {
            // Clean up secondary app on error too
            await deleteApp(tempApp);
            if (authErr.code === 'auth/email-already-in-use') {
                // If account exists, fall back to linking/invite system
                await db.addStaffInvite(email, role, targetStoreId, { ...storeDetails, staffLimit });
                alert(`Note: This email already has an account.\n\nWe have updated their access permissions in the cloud. They can log in with their existing password.`);
            } else {
                throw authErr;
            }
        }

        document.getElementById('staff-modal').style.display = 'none';
        renderView('login');

    } catch (err) {
        alert("Failed: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Create Account';
    }
};

window.logout = async () => {
    if (confirm("Are you sure you want to log out of this store?")) {
        await signOut(auth);
    }
};

window.showAddProductForm = () => {
    renderView('add-product');
};

window.loadDashboardStats = () => {
    try {
        // Dashboard uses both, so ensure we don't have dangling listeners
        if (window.currentState.unsubInvoices) window.currentState.unsubInvoices();
        if (window.currentState.unsubProducts) window.currentState.unsubProducts();

        // 1. Listen to Invoices (Sales Stats)
        window.currentState.unsubInvoices = db.listenToInvoices(invoices => {
            const todayStr = new Date().toDateString();

            let todayCount = 0;
            let todaySales = 0;

            invoices.forEach(inv => {
                if (new Date(inv.date).toDateString() === todayStr) {
                    todayCount++;
                    todaySales += parseFloat(inv.totalAmount || 0);
                }
            });

            const countEl = document.getElementById('stat-invoices-today');
            const salesEl = document.getElementById('stat-sales-today');

            if (countEl) countEl.innerText = todayCount;
            if (salesEl) salesEl.innerText = '₹' + todaySales.toFixed(2);
        });

        // 2. Listen to Products (Inventory Stats)
        window.currentState.unsubProducts = db.listenToProducts(products => {
            let totalItems = products.length;
            let lowStockCount = products.filter(p => p.stock < 5).length;

            const totalEl = document.getElementById('stat-total-products');
            const lowEl = document.getElementById('stat-low-stock');

            if (totalEl) totalEl.innerText = totalItems;
            if (lowEl) lowEl.innerText = lowStockCount;
        });

    } catch (err) {
        console.error("Error loading dashboard stats:", err);
    }
};

window.calculateGST = () => {
    const price = parseFloat(document.getElementById('p-retail').value) || 0;
    const slab = parseFloat(document.getElementById('p-slab').value) || 0;

    const gstAmt = (price * slab) / 100;
    const half = gstAmt / 2;

    document.getElementById('p-gst').value = gstAmt.toFixed(2);
    document.getElementById('p-cgst').value = half.toFixed(2);
    document.getElementById('p-sgst').value = half.toFixed(2);
};

// --- Super Admin Functions ---

window.loadStoreSelector = async () => {
    const stores = await db.getAllStores();
    const selector = document.getElementById('store-selector');
    if (!selector) return;

    selector.innerHTML = `<option value="">My Master ID (${window.currentState.user.uid.slice(0, 8)})</option>`;
    stores.forEach(store => {
        if (store.id !== window.currentState.user.uid) {
            selector.innerHTML += `<option value="${store.id}" ${db.profile.activeStoreId === store.id ? 'selected' : ''}>Store: ${store.email || store.id.slice(0, 8)}</option>`;
        }
    });
};

window.setActiveStore = (storeId) => {
    db.profile.activeStoreId = storeId || null;
    renderView('home'); // Refresh everything for the new store
};

// --- Reports & Charts ---

window.renderReportsDashboard = (invoices) => {
    const today = new Date().toDateString();
    const todayInvoices = invoices.filter(inv => new Date(inv.date).toDateString() === today);

    // Calculate Stats
    let totalItems = 0;
    let totalSales = 0;
    const productSales = {}; // barcode -> {name: '...', qty: 0}

    todayInvoices.forEach(inv => {
        totalSales += parseFloat(inv.totalAmount || 0);
        inv.items.forEach(item => {
            totalItems += item.qty;
            if (!productSales[item.barcode]) {
                productSales[item.barcode] = { name: item.name, qty: 0 };
            }
            productSales[item.barcode].qty += item.qty;
        });
    });

    const avgBill = todayInvoices.length > 0 ? (totalSales / todayInvoices.length) : 0;

    // Update UI
    const avgEl = document.getElementById('report-avg-bill');
    const itemsEl = document.getElementById('report-total-items');
    if (avgEl) avgEl.innerText = '₹' + avgBill.toFixed(0);
    if (itemsEl) itemsEl.innerText = totalItems;

    // Render Top Products
    const topProducts = Object.values(productSales).sort((a, b) => b.qty - a.qty).slice(0, 3);
    const topListEl = document.getElementById('top-products-list');
    if (topListEl) {
        if (topProducts.length === 0) {
            topListEl.innerHTML = '<div class="text-center text-muted">No sales today</div>';
        } else {
            topListEl.innerHTML = topProducts.map((p, i) => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: ${i < topProducts.length - 1 ? '1px solid #f1f5f9' : 'none'};">
                    <span style="font-size: 14px;">${p.name}</span>
                    <span style="font-weight: 600; color: #1e3a8a;">${p.qty} sold</span>
                </div>
            `).join('');
        }
    }

    // Hourly Sales for Chart
    const hourlySales = Array(24).fill(0);
    todayInvoices.forEach(inv => {
        const hour = new Date(inv.date).getHours();
        hourlySales[hour] += parseFloat(inv.totalAmount || 0);
    });

    renderSalesChart(hourlySales);
};

let salesChartInstance = null;
window.renderSalesChart = (hourlyData) => {
    const canvas = document.getElementById('salesChart');
    if (!canvas) return;

    // Destroy existing chart to avoid layout overlap
    if (salesChartInstance) salesChartInstance.destroy();

    const ctx = canvas.getContext('2d');
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['12am', '4am', '8am', '12pm', '4pm', '8pm', '11pm'],
            datasets: [{
                label: 'Sales (₹)',
                data: [hourlyData[0], hourlyData[4], hourlyData[8], hourlyData[12], hourlyData[16], hourlyData[20], hourlyData[23]],
                borderColor: '#1e3a8a',
                backgroundColor: 'rgba(30, 58, 138, 0.1)',
                fill: true,
                tension: 0.4,
                borderWidth: 3,
                pointRadius: 4,
                pointBackgroundColor: '#1e3a8a'
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { display: false } },
                x: { grid: { display: false } }
            }
        }
    });
};

// --- Staff Management Functions ---

window.showAddStaffModal = async () => {
    document.getElementById('staff-modal-title').innerText = 'Manage Users';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-email').disabled = false;
    document.getElementById('staff-password').value = '';

    const passwordField = document.getElementById('staff-password').parentElement;
    if (passwordField) passwordField.style.display = 'block';
    document.getElementById('staff-password').required = true;

    const submitBtn = document.querySelector('#staff-creation-form button[type="submit"]');
    submitBtn.innerText = 'Create Account';

    window.editingStaffUid = null;

    // Dynamic Role Selection: Store Admins can only create Staff
    const roleSelect = document.getElementById('staff-role');
    if (db.isSuperAdmin()) {
        roleSelect.innerHTML = `
            <option value="staff">Staff</option>
            <option value="store_admin">Store Admin</option>
        `;
    } else {
        roleSelect.innerHTML = `<option value="staff">Staff</option>`;
    }
    roleSelect.value = 'staff';
    toggleStaffFields('staff');

    // If Super Admin, populate store list
    const storeSelection = document.getElementById('staff-store-selection');
    if (db.isSuperAdmin()) {
        if (storeSelection) storeSelection.style.display = 'block';
        const storeSelect = document.getElementById('staff-store-id');
        const stores = await db.getAllStores();
        storeSelect.innerHTML = '<option value="">Select a Store...</option>' +
            stores.map(s => `<option value="${s.id}">${s.name} (${s.email})</option>`).join('');
    } else {
        if (storeSelection) storeSelection.style.display = 'none';
    }

    const limitContainer = document.getElementById('staff-limit-container');
    if (limitContainer) limitContainer.style.display = 'none';

    const modal = document.getElementById('staff-modal');
    modal.style.display = 'flex';
};

window.toggleStaffFields = (role) => {
    const adminFields = document.getElementById('store-admin-fields');
    const staffFields = document.getElementById('staff-store-selection');

    const limitContainer = document.getElementById('staff-limit-container');
    if (role === 'store_admin' && db.isSuperAdmin()) {
        if (limitContainer) limitContainer.style.display = 'block';
    } else {
        if (limitContainer) limitContainer.style.display = 'none';
    }

    if (role === 'store_admin') {
        adminFields.style.display = 'block';
        staffFields.style.display = 'none';

        // Make admin fields required
        document.getElementById('staff-store-name').required = true;
        document.getElementById('staff-store-phone').required = true;
        document.getElementById('staff-store-address').required = true;
    } else {
        adminFields.style.display = 'none';
        staffFields.style.display = 'block';

        // Remove requirement
        document.getElementById('staff-store-name').required = false;
        document.getElementById('staff-store-phone').required = false;
        document.getElementById('staff-store-address').required = false;
    }
};

window.handleStaffInvite = async (e) => {
    e.preventDefault();
    const email = document.getElementById('staff-email').value;
    const btn = e.target.querySelector('button');

    try {
        btn.disabled = true;
        btn.innerText = 'Inviting...';
        await db.addStaffInvite(email);
        alert(`Invite sent! Tell your staff to register with ${email}`);
        document.getElementById('staff-modal').style.display = 'none';
    } catch (err) {
        alert("Failed to send invite: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Send Invite';
    }
};

window.renderStaffList = (staff) => {
    const list = document.getElementById('staff-list');
    if (!list) return;

    if (staff.length === 0) {
        list.innerHTML = `<p style="text-align: center; color: #6b7280; margin-top: 30px; font-size: 14px;">No staff accounts created yet.</p>`;
        return;
    }

    list.innerHTML = staff.map(person => `
        <div class="card" style="padding: 15px; display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 10px; border-left: 4px solid ${person.status === 'pending' ? '#f59e0b' : '#10b981'};">
            <div style="display: flex; align-items: center; gap: 15px;">
                <div style="width: 40px; height: 40px; background: #eef2f6; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    <span class="material-icons-round" style="color: #1e3a8a;">${person.status === 'pending' ? 'mail_outline' : 'person'}</span>
                </div>
                <div>
                    <h4 style="margin: 0; font-size: 14px;">${person.email || 'Staff Member'}</h4>
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
                        <span style="font-size: 10px; color: #6b7280; text-transform: uppercase; font-weight: 600;">
                            ${person.role === 'store_admin' ? 'Store Admin' : person.role === 'super_admin' ? 'Super Admin' : 'Staff'}
                        </span>
                        <span style="font-size: 9px; padding: 2px 6px; border-radius: 10px; background: ${person.status === 'pending' ? '#fef3c7' : '#dcfce7'}; color: ${person.status === 'pending' ? '#92400e' : '#166534'}; text-transform: uppercase; font-weight: 700;">
                            ${person.status}
                        </span>
                    </div>
                </div>
            </div>
            ${(() => {
            const currentUser = window.currentState.user;
            const isSuper = db.profile && db.profile.role === 'super_admin';
            const isAdmin = db.profile && db.profile.role === 'store_admin';

            // Don't show manage buttons for YOURSELF
            if (person.uid === currentUser.uid) return '';

            // Super Admin can manage anyone
            if (isSuper) {
                return `
                        <div style="display: flex; gap: 10px;">
                            <button onclick="showEditStaffModal('${person.uid}', '${person.email}', '${person.role}', '${person.status}')" style="background:none; border:none; color: #1e3a8a; padding: 5px;">
                                <span class="material-icons-round" style="font-size: 20px;">edit</span>
                            </button>
                            <button onclick="confirmDeleteStaff('${person.uid}', ${person.status === 'pending'})" style="background:none; border:none; color: #ef4444; padding: 5px;">
                                <span class="material-icons-round" style="font-size: 20px;">delete_outline</span>
                            </button>
                        </div>
                    `;
            }

            // Store Admin can only manage STAFF (not other admins or super admins)
            if (isAdmin && person.role === 'staff') {
                return `
                        <div style="display: flex; gap: 10px;">
                            <button onclick="showEditStaffModal('${person.uid}', '${person.email}', '${person.role}', '${person.status}')" style="background:none; border:none; color: #1e3a8a; padding: 5px;">
                                <span class="material-icons-round" style="font-size: 20px;">edit</span>
                            </button>
                            <button onclick="confirmDeleteStaff('${person.uid}', ${person.status === 'pending'})" style="background:none; border:none; color: #ef4444; padding: 5px;">
                                <span class="material-icons-round" style="font-size: 20px;">delete_outline</span>
                            </button>
                        </div>
                    `;
            }

            return ''; // No management allowed
        })()}
        </div>
    `).join('');
};

window.showEditStaffModal = (uid, email, role, status) => {
    showAddStaffModal(); // Open the modal first to set up fields

    document.getElementById('staff-modal-title').innerText = 'Edit Staff Member';
    document.getElementById('staff-email').value = email;
    document.getElementById('staff-email').disabled = true; // Email cannot be changed
    document.getElementById('staff-role').value = role;

    // Hide password for edits
    const passwordField = document.getElementById('staff-password').parentElement;
    if (passwordField) passwordField.style.display = 'none';
    document.getElementById('staff-password').required = false;

    // Change button text
    const submitBtn = document.querySelector('#staff-creation-form button[type="submit"]');
    submitBtn.innerText = 'Update Account';

    // Store UID for the update handler
    window.editingStaffUid = uid;

    toggleStaffFields(role);
};

window.confirmDeleteStaff = async (id, isInvite) => {
    const msg = isInvite ? "Cancel this invitation?" : "Revoke access for this staff member?";
    if (confirm(msg)) {
        try {
            const success = await db.deleteStaff(id, isInvite);
            if (!success) alert("Cannot delete this user.");
        } catch (err) {
            alert("Error removing staff: " + err.message);
        }
    }
};

// --- Customer Management Functions ---

window.showAddCustomerModal = (id = null) => {
    const modal = document.getElementById('customer-modal');
    const form = document.getElementById('customer-form');
    const title = document.getElementById('customer-modal-title');

    if (!modal || !form) return;

    form.reset();
    document.getElementById('cust-modal-id').value = id || '';

    if (id) {
        title.innerText = 'Edit Customer';
        db.getCustomer(id).then(customer => {
            if (customer) {
                document.getElementById('cust-modal-name').value = customer.name;
                document.getElementById('cust-modal-phone').value = customer.phone;
                document.getElementById('cust-modal-price-type').value = customer.priceType || 'retail';
                document.getElementById('cust-modal-email').value = customer.email || '';
                document.getElementById('cust-modal-address').value = customer.address || '';
            }
        });
    } else {
        title.innerText = 'Add New Customer';
    }

    modal.style.display = 'flex';
};

window.handleSaveCustomer = async (e) => {
    e.preventDefault();
    const id = document.getElementById('cust-modal-id').value;
    const btn = e.target.querySelector('button[type="submit"]');

    const customerData = {
        name: document.getElementById('cust-modal-name').value,
        phone: document.getElementById('cust-modal-phone').value,
        priceType: document.getElementById('cust-modal-price-type').value,
        email: document.getElementById('cust-modal-email').value,
        address: document.getElementById('cust-modal-address').value
    };

    try {
        btn.disabled = true;
        btn.innerText = 'Saving...';

        if (id) {
            await db.updateCustomer(id, customerData);
        } else {
            await db.addCustomer(customerData);
        }

        document.getElementById('customer-modal').style.display = 'none';
        alert('Customer saved successfully!');
    } catch (err) {
        console.error("Failed to save customer:", err);
        alert('Error saving customer: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Customer';
    }
};

window.renderCustomerList = (customers) => {
    const list = document.getElementById('customer-list');
    if (!list) return;

    if (customers.length === 0) {
        list.innerHTML = `<div class="text-center text-muted" style="margin-top: 30px;">No customers found. Click + to add.</div>`;
        return;
    }

    list.innerHTML = customers.map(c => `
        <div class="card" style="padding: 15px; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 15px;">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: #f0fdf4; display: flex; align-items: center; justify-content: center; color: #15803d;">
                    <span class="material-icons-round">person</span>
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 700; color: #1e3a8a;">${c.name}</div>
                    <div style="font-size: 13px; color: #6b7280;">${c.phone} | <span style="text-transform: capitalize; color: #15803d; font-weight: 600;">${c.priceType} Price</span></div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="showAddCustomerModal('${c.id}')" style="background:none; border:none; padding:5px; color:#1e3a8a;">
                        <span class="material-icons-round" style="font-size: 20px;">edit</span>
                    </button>
                    <button onclick="confirmDeleteCustomer('${c.id}')" style="background:none; border:none; padding:5px; color:#ef4444;">
                        <span class="material-icons-round" style="font-size: 20px;">delete_outline</span>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
};

window.confirmDeleteCustomer = (id) => {
    if (confirm('Are you sure you want to delete this customer?')) {
        db.deleteCustomer(id).then(() => alert('Customer deleted.'));
    }
};

// --- Billing / Cart Functions ---
// These functions handle the mathematical logic for the billing screen.
// EDITING TIP: Modify 'calculateGST' if tax rules change.

// Global scanner instance
let html5QrcodeScanner = null;

// Adds a product to the cart (either object or barcode string)
window.addToCart = async (productOrBarcode) => {
    let product = productOrBarcode;

    // If string, fetch product
    if (typeof productOrBarcode === 'string') {
        product = await db.getProduct(productOrBarcode);
        if (!product) {
            alert('Product not found!');
            return;
        }
    }

    // Check if already in cart
    const existing = currentState.cart.find(item => item.barcode === product.barcode);
    if (existing) {
        existing.qty += 1;
    } else {
        currentState.cart.push({ ...product, qty: 1 });
    }

    renderCart();
};

window.updateCartQty = (barcode, delta) => {
    const item = currentState.cart.find(i => i.barcode === barcode);
    if (item) {
        item.qty += delta;
        if (item.qty <= 0) {
            if (confirm('Remove item from cart?')) {
                currentState.cart = currentState.cart.filter(i => i.barcode !== barcode);
            } else {
                item.qty = 1;
            }
        }
        renderCart();
    }
};

window.renderCart = () => {
    const list = document.getElementById('cart-list');
    const totalEl = document.getElementById('cart-total');
    const countEl = document.getElementById('cart-count');

    if (!list) return;

    countEl.innerText = currentState.cart.length;

    let total = 0;

    if (currentState.cart.length === 0) {
        list.innerHTML = `<div class="text-center text-muted" style="margin-top: 30px;">Cart is empty</div>`;
        totalEl.innerText = '₹0.00';
        return;
    }

    list.innerHTML = currentState.cart.map(item => {
        const priceField = currentState.priceType === 'wholesale' ? 'wholesalePrice' :
            currentState.priceType === 'card' ? 'cardPrice' : 'retailPrice';
        const price = item[priceField] || item.retailPrice;

        const itemTotal = (price * item.qty).toFixed(2);
        total += parseFloat(itemTotal);
        return `
            <div class="card" style="padding: 10px 15px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h3 style="color: var(--text-main); font-weight: 600;">${item.name}</h3>
                        <div style="font-size: 12px; color: var(--text-secondary);">₹${price} x ${item.qty}</div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-weight: 700; color: #1e3a8a;">₹${itemTotal}</div>
                    </div>
                </div>
                <!-- Qty Controls -->
                <div style="display: flex; justify-content: flex-end; align-items: center; gap: 15px; margin-top: 5px;">
                    <button onclick="updateCartQty('${item.barcode}', -1)" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid #ddd; background: white;">-</button>
                    <span style="font-weight: 600;">${item.qty}</span>
                    <button onclick="updateCartQty('${item.barcode}', 1)" style="width: 28px; height: 28px; border-radius: 50%; border: 1px solid #ddd; background: white;">+</button>
                </div>
            </div>
        `;
    }).join('');

    totalEl.innerText = '₹' + total.toFixed(2);
};

// --- Search Logic ---
// --- Customer Search Logic (For Invoice) ---
window.handleCustomerSearchInput = async (val) => {
    const resultsPanel = document.getElementById('cust-search-results');
    if (!val || val.length < 2) {
        resultsPanel.style.display = 'none';
        return;
    }

    // Since we don't have a specific global search method, we'll fetch others via db and filter local
    // In a large db, we'd use a Firestore query. For now, we'll use onSnapshot cached data if available
    // or fetch all (not suggested for large DBs, but okay for MVP)

    // Better: We'll use a direct query for simple name prefix
    const storeId = db.getStoreId();
    const q = query(collection(firestore, "customers"), where("storeId", "==", storeId));
    const snap = await getDocs(q);

    const matches = [];
    snap.forEach(doc => {
        const data = doc.data();
        if (data.name.toLowerCase().includes(val.toLowerCase()) || data.phone.includes(val)) {
            matches.push({ id: doc.id.replace(`${storeId}_`, ''), ...data });
        }
    });

    if (matches.length === 0) {
        resultsPanel.innerHTML = '<div style="padding: 10px; font-size:12px; color:#6b7280;">No customer found.</div>';
    } else {
        resultsPanel.innerHTML = matches.map(c => `
            <div onclick="selectCustomer('${c.id}', '${c.name.replace(/'/g, "\\'")}', '${c.phone}', '${c.priceType || 'retail'}')" 
                 style="padding: 10px; border-bottom: 1px solid #f3f4f6; cursor: pointer;">
                <div style="font-weight: 600; color: #1e3a8a; font-size:13px;">${c.name}</div>
                <div style="font-size: 11px; color: #6b7280;">${c.phone} | ${c.priceType || 'retail'} tier</div>
            </div>
        `).join('');
    }
    resultsPanel.style.display = 'block';
};

window.selectCustomer = (id, name, phone, priceType) => {
    window.currentState.selectedCustomer = { id, name, phone, priceType };
    window.currentState.priceType = priceType;

    document.getElementById('display-cust-name').innerText = name;
    document.getElementById('display-cust-phone').innerText = phone;
    document.getElementById('selected-customer-details').style.display = 'block';
    document.getElementById('cust-search-results').style.display = 'none';
    document.getElementById('cust-search').value = '';

    const badge = document.getElementById('price-tier-badge');
    if (badge) {
        badge.innerText = `${priceType} Tier`;
        badge.style.background = priceType === 'retail' ? '#dcfce7' : priceType === 'wholesale' ? '#dbeafe' : '#fef3c7';
        badge.style.color = priceType === 'retail' ? '#166534' : priceType === 'wholesale' ? '#1e40af' : '#92400e';
    }

    // Refresh cart to show new prices
    renderCart();
};

window.clearSelectedCustomer = () => {
    window.currentState.selectedCustomer = null;
    window.currentState.priceType = 'retail';

    document.getElementById('selected-customer-details').style.display = 'none';
    const badge = document.getElementById('price-tier-badge');
    if (badge) {
        badge.innerText = `Retail Tier`;
        badge.style.background = '#dcfce7';
        badge.style.color = '#166534';
    }

    renderCart();
};

window.handleSearchInput = async (val) => {
    const resultsDiv = document.getElementById('search-results');
    if (!val || val.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }

    // Basic search
    const all = await db.getAllProducts();
    const hits = all.filter(p =>
        p.name.toLowerCase().includes(val.toLowerCase()) ||
        p.barcode.includes(val)
    );

    if (hits.length > 0) {
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = hits.map(p => {
            const priceField = currentState.priceType === 'wholesale' ? 'wholesalePrice' :
                currentState.priceType === 'card' ? 'cardPrice' : 'retailPrice';
            const price = (p[priceField] !== undefined && p[priceField] !== null && p[priceField] !== 0)
                ? p[priceField] : p.retailPrice;

            return `
                <div onclick="addToCart('${p.barcode}'); document.getElementById('search-results').style.display='none'; document.getElementById('product-search').value='';" 
                    style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer;">
                    <div style="font-weight: 600;">${p.name}</div>
                    <div style="font-size: 12px; color: #666;">SKU: ${p.barcode} | ₹${price}</div>
                </div>
            `;
        }).join('');
    } else {
        resultsDiv.style.display = 'none';
    }
};

// --- Scanner Integration ---
// Uses the 'html5-qrcode' library to read barcodes from the camera.
// EDITING TIP: You can adjust 'fps' or 'qrbox' in the config variable below to tune performance.

window.startCameraScan = (resetMode = true) => {
    document.getElementById('scanner-modal').style.display = 'block';

    if (resetMode) {
        window.activeScanFieldId = null;
    }

    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("reader");
    }

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    html5QrcodeScanner.start({ facingMode: "environment" }, config, onScanSuccess)
        .catch(err => {
            console.error("Camera Start Error:", err);
            if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
                alert("CAMERA ERROR: Browser blocked camera because site is not HTTPS.\n\nSee chrome://flags or Use Localhost.");
            } else {
                alert("Camera Error: " + err);
            }
            document.getElementById('scanner-modal').style.display = 'none';
        });
};

window.stopCameraScan = () => {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('scanner-modal').style.display = 'none';
        }).catch(err => console.error(err));
    } else {
        document.getElementById('scanner-modal').style.display = 'none';
    }
};

const onScanSuccess = (decodedText, decodedResult) => {
    console.log(`Scan result: ${decodedText}`);

    // Check if we are scanning into a specific field (Add Product)
    if (window.activeScanFieldId) {
        const field = document.getElementById(window.activeScanFieldId);
        if (field) {
            field.value = decodedText;
            // Trigger events if needed
            field.dispatchEvent(new Event('input'));
        }
        window.activeScanFieldId = null; // Reset
    } else {
        // Default: Add to Cart
        addToCart(decodedText);
    }

    stopCameraScan();
};

window.startScannerForField = (fieldId) => {
    console.log("Button Clicked for:", fieldId);
    window.activeScanFieldId = fieldId;
    window.startCameraScan(false);
};

// --- Settings Logic ---
window.saveSettings = async (e) => {
    e.preventDefault();

    if (db.profile && db.profile.role === 'staff') {
        alert("Action Denied: Staff cannot modify store settings.");
        return;
    }

    const formData = new FormData(e.target);
    const settings = {
        name: formData.get('shopName'),
        gstin: formData.get('gstin'),
        address: formData.get('address'),
        phone: formData.get('phone')
    };

    try {
        await db.updateStoreDetails(null, settings);
        alert("Store Details Saved to Cloud!");
    } catch (err) {
        alert("Failed to save settings: " + err.message);
    }
};

// --- Invoicing & PDF ---
// Handles calculating totals and generating the final PDF document.
// Uses 'jsPDF' library for PDF creation.
//
// EDITING TIP: To change the PDF layout, look at the 'doc.text()' calls below.
// The coordinates are (X, Y). increasing Y moves text down.

window.generateInvoice = async () => {
    let custName = 'Guest';
    let custPhone = '';
    let custId = null;

    if (currentState.selectedCustomer) {
        custName = currentState.selectedCustomer.name;
        custPhone = currentState.selectedCustomer.phone;
        custId = currentState.selectedCustomer.id;
    } else {
        const searchInput = document.getElementById('cust-search');
        if (searchInput && searchInput.value) custName = searchInput.value;
    }

    if (currentState.cart.length === 0) {
        alert("Cart is empty!");
        return;
    }

    // 1. Calculate
    let totalTaxable = 0;
    let totalGST = 0;
    let totalAmount = 0;

    const processedItems = currentState.cart.map(item => {
        const priceField = currentState.priceType === 'wholesale' ? 'wholesalePrice' :
            currentState.priceType === 'card' ? 'cardPrice' : 'retailPrice';
        const price = (item[priceField] !== undefined && item[priceField] !== null && item[priceField] !== 0)
            ? item[priceField] : item.retailPrice;

        const slab = parseFloat(item.gstSlab) || 0;
        const gstAmountPerUnit = (price * slab) / 100;
        const itemTotal = price * item.qty;

        totalAmount += itemTotal;
        const itemTax = gstAmountPerUnit * item.qty;
        totalGST += itemTax;
        totalTaxable += (itemTotal - itemTax);

        return {
            ...item,
            wholesalePrice: item.wholesalePrice || 0,
            cardPrice: item.cardPrice || 0,
            priceUsed: price,
            gstAmount: gstAmountPerUnit, // Calculated for the price used
            cgst: gstAmountPerUnit / 2,
            sgst: gstAmountPerUnit / 2
        };
    });

    // 2. Create Object (use existing ID and Date if editing)
    const activeId = currentState.editingInvoiceId || Date.now().toString();
    const activeDate = currentState.editingInvoiceDate || new Date().toISOString();

    const invoice = {
        id: activeId,
        date: activeDate,
        customerName: custName,
        customerPhone: custPhone,
        customerId: custId,
        priceType: currentState.priceType,
        items: processedItems,
        totalAmount: totalAmount,
        totalTax: totalGST,
        totalTaxable: totalTaxable
    };

    // 3. Save Invoice
    await db.createInvoice(invoice);

    // 4. Deduct Stock for each item
    for (const item of currentState.cart) {
        db.deductStock(item.barcode, item.qty);
    }

    // 5. Set State & Clear Cart 
    currentState.currentInvoice = invoice;
    currentState.cart = [];
    currentState.editingInvoiceId = null;
    currentState.editingInvoiceDate = null;
    currentState.selectedCustomer = null;
    currentState.priceType = 'retail';

    renderView('invoice-preview');
};

// Internal function to create PDF on demand
async function getGeneratedPdfBlob() {
    const invoice = currentState.currentInvoice;
    if (!invoice) return null;

    const settings = await db.getStoreDetails() || {
        name: 'BigStore Pro',
        gstin: 'NOT SET',
        address: '',
        phone: ''
    };

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.setTextColor(30, 58, 138);
    doc.text("INVOICE", 105, 20, null, null, "center");
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text(settings.name, 105, 30, null, null, "center");
    doc.setFontSize(10);
    doc.text(`GSTIN: ${settings.gstin}`, 105, 36, null, null, "center");

    if (settings.address || settings.phone) {
        let sub = [settings.address, settings.phone ? `Ph: ${settings.phone}` : ''].filter(Boolean).join(' | ');
        doc.text(sub, 105, 41, null, null, "center");
    }

    // Info
    doc.line(10, 48, 200, 48);
    doc.setFontSize(10);
    doc.text(`Invoice #: ${invoice.id}`, 14, 56);
    doc.text(`Date: ${new Date(invoice.date).toLocaleDateString()}`, 14, 61);

    doc.setFont(undefined, 'bold');
    doc.text(`Customer: ${invoice.customerName}`, 14, 70);
    doc.setFont(undefined, 'normal');
    if (invoice.customerPhone) {
        doc.text(`Phone: ${invoice.customerPhone}`, 14, 75);
    }

    if (invoice.priceType) {
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(`Price Tier: ${invoice.priceType.toUpperCase()}`, 14, 79);
        doc.setTextColor(0);
        doc.setFontSize(10);
    }

    let y = 84; // This y is for the table header
    doc.line(10, y, 200, y); // Line before table header
    y += 10; // Move y down for table header
    doc.setFillColor(240, 240, 240);
    doc.rect(10, y - 5, 190, 8, 'F');
    doc.setFont(undefined, 'bold');
    doc.text("Item", 14, y);
    doc.text("Qty", 100, y);
    doc.text("Price", 130, y);
    doc.text("Total", 170, y);
    doc.setFont(undefined, 'normal');
    y += 10;

    invoice.items.forEach(item => {
        const price = item.priceUsed || item.retailPrice;
        const itemTotal = (price * item.qty).toFixed(2);
        doc.text(item.name.substring(0, 30), 14, y);
        doc.text(String(item.qty), 100, y);
        doc.text(String(price), 130, y);
        doc.text(String(itemTotal), 170, y);
        y += 8;
    });

    doc.line(10, y, 200, y);
    y += 10;
    doc.text("Taxable Amt:", 130, y); doc.text(invoice.totalTaxable.toFixed(2), 170, y); y += 6;
    doc.text("Total Tax (GST):", 130, y); doc.text(invoice.totalTax.toFixed(2), 170, y); y += 6;
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text("Grand Total:", 130, y + 2); doc.text(`INR ${invoice.totalAmount.toFixed(2)}`, 170, y + 2);

    return doc.output('blob');
}

window.shareInvoice = async (method, btn) => {
    const invoice = currentState.currentInvoice;
    if (!invoice) return;

    const shopSettings = await db.getStoreDetails() || { name: 'BigStore Pro' };

    // Show loading text
    const originalBtnText = btn.innerHTML;
    btn.innerHTML = 'Wait...';
    btn.disabled = true;

    try {
        const blob = await getGeneratedPdfBlob();
        const filename = `Invoice_${invoice.id}.pdf`;
        const file = new File([blob], filename, { type: 'application/pdf' });

        if (method === 'download') {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
        }
        else if (method === 'whatsapp') {
            const text = `Invoice for ${invoice.customerName}: ₹${invoice.totalAmount}.\n(Please download attachment)`;
            const cleanPhone = invoice.customerPhone ? invoice.customerPhone.replace(/\D/g, '') : '';
            const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ title: 'Invoice', text: text, files: [file] });
            } else {
                window.open(waUrl, '_blank');
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                link.click();
            }
        }
        else if (method === 'email') {
            const subject = `Invoice ${invoice.id} from ${shopSettings.name}`;
            const body = `Please find the invoice for ₹${invoice.totalAmount} attached.`;

            // Try Native Share first (allows attachments on mobile)
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        title: subject,
                        text: body,
                        files: [file]
                    });
                } catch (err) {
                    console.log("Share cancelled or failed:", err);
                }
            } else {
                // Desktop Fallback: mailto + instructions + download
                alert("Desktop detected: I've downloaded the PDF for you. Please attach it manually to your email.");
                window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                link.click();
            }
        }
        else if (method === 'print') {
            const pdfUrl = URL.createObjectURL(blob);
            const printFrame = document.createElement('iframe');
            printFrame.style.display = 'none';
            printFrame.src = pdfUrl;
            document.body.appendChild(printFrame);

            printFrame.onload = () => {
                printFrame.contentWindow.print();
                // Optional: cleanup after a delay to ensure print dialog opened
                setTimeout(() => {
                    document.body.removeChild(printFrame);
                    URL.revokeObjectURL(pdfUrl);
                }, 10000);
            };
        }
        else if (method === 'native') {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ title: 'Invoice', text: `Invoice for ${invoice.customerName}`, files: [file] });
            } else {
                alert("Native sharing not supported. Downloading.");
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                link.click();
            }
        }

    } catch (err) {
        console.error("Share Error:", err);
        alert("Error: " + err.message);
    } finally {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
    }
};

// --- DB Actions (Controller Layer) ---
// These functions act as the "glue" between the UI forms and the Database.
// They get data from High-Level inputs => Create Object => Call DB Method.

window.handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!db) { alert("Database not ready!"); return; }

    const formData = new FormData(e.target);
    const product = {
        barcode: formData.get('barcode'),
        name: formData.get('name'),
        stock: parseInt(formData.get('stock')) || 0,
        costPrice: parseFloat(formData.get('costPrice')) || 0,
        retailPrice: parseFloat(formData.get('retailPrice')) || 0,
        wholesalePrice: parseFloat(formData.get('wholesalePrice')) || 0,
        cardPrice: parseFloat(formData.get('cardPrice')) || 0,
        hsn: parseInt(formData.get('hsn')) || 0,
        pack: parseInt(formData.get('pack')) || 1,
        measure: parseFloat(formData.get('measure')) || 0,
        gstSlab: formData.get('gstSlab'),
        gstAmount: parseFloat(formData.get('gstAmount')) || 0,
        cgst: parseFloat(formData.get('cgst')) || 0,
        sgst: parseFloat(formData.get('sgst')) || 0,
    };

    if (!product.barcode || !product.name) {
        alert("Barcode and Name are required!");
        return;
    }

    try {
        await db.addProduct(product);
        if (navigator.onLine) {
            alert('Product Saved!');
        } else {
            alert('Saved Offline: Product will sync when internet returns.');
        }
        renderView('inventory');
    } catch (err) {
        alert('Error saving product: ' + (err.message || "Duplicate?"));
    }
};

window.deleteProduct = async (barcode) => {
    if (confirm('Delete this product?')) {
        await db.deleteProduct(barcode);
        loadInventory();
    }
};

window.adjustStock = async (barcode, currentStock) => {
    const newStockStr = prompt(`Adjust Stock for ${barcode} (Current: ${currentStock}):`, currentStock);
    if (newStockStr !== null) {
        const newStock = parseInt(newStockStr);
        if (isNaN(newStock)) { alert("Invalid number"); return; }

        // Fetch, Update, Save
        const product = await db.getProduct(barcode);
        if (product) {
            product.stock = newStock;
            await db.addProduct(product);
            loadInventory();
        }
    }
};

window.renderInventoryList = (products) => {
    const list = document.getElementById('inventory-list');
    if (!list) return;

    if (products.length === 0) {
        list.innerHTML = `<div style="text-align: center; margin-top: 50px; color: var(--text-muted);">No products yet</div>`;
        return;
    }

    list.innerHTML = products.map(p => `
        <div class="card" style="display: flex; justify-content: space-between; align-items: center; padding: 15px;">
            <div>
                <h3 style="color: var(--text-main); font-weight: 600; margin-bottom: 4px;">${p.name}</h3>
                <div style="font-size: 12px; color: var(--text-secondary);">SKU: ${p.barcode}</div>
                <div style="font-size: 12px; color: var(--text-secondary);">Stock: <strong>${p.stock}</strong> | Cost: ₹${p.costPrice || 0}</div>
            </div>
            <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
                <div style="color: #1e3a8a; font-weight: 700;">₹${p.retailPrice}</div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="adjustStock('${p.barcode}', ${p.stock})" style="background: #eef2f6; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; color: #1e3a8a;">Adjust</button>
                    <button onclick="deleteProduct('${p.barcode}')" style="background: none; border: none; color: #ef4444; font-size: 11px;">DELETE</button>
                </div>
            </div>
        </div>
    `).join('');
};

window.renderInvoiceList = (invoices) => {
    const list = document.getElementById('invoice-list');
    if (!list) return;

    invoices.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (invoices.length === 0) {
        list.innerHTML = `<div style="text-align: center; margin-top: 50px; color: var(--text-muted);">No invoices found</div>`;
        return;
    }

    list.innerHTML = invoices.map(inv => `
        <div class="card" style="padding: 15px; margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                 <div>
                    <h3 style="color: #1e3a8a; font-weight: 700;">₹${inv.totalAmount.toFixed(2)}</h3>
                    <div style="font-size: 14px; font-weight: 500; margin-top: 4px;">${inv.customerName}</div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                        ${new Date(inv.date).toLocaleDateString()}
                    </div>
                 </div>
                 <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                    <span style="font-size: 10px; background: #eef2f6; padding: 4px 8px; border-radius: 4px; color: #666;">#${inv.id.slice(-6)}</span>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <button onclick="editInvoice('${inv.id}')" style="background: #eef2f6; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; color: #1e3a8a;">EDIT</button>
                        <button onclick="deleteInvoice('${inv.id}')" style="background: none; border: none; color: #ef4444; font-size: 11px;">DELETE</button>
                    </div>
                 </div>
            </div>
        </div>
    `).join('');
};

window.deleteInvoice = async (id) => {
    if (confirm('Are you sure you want to delete this invoice?')) {
        try {
            await db.deleteInvoice(id);
            // UI will auto-refresh due to onSnapshot listener
        } catch (err) {
            alert("Error deleting invoice: " + err.message);
        }
    }
};

window.editInvoice = async (id) => {
    const invoice = await db.getInvoice(id);
    if (!invoice) {
        alert("Invoice not found!");
        return;
    }

    // Load invoice data into current state to edit
    window.currentState.editingInvoiceId = invoice.id;
    window.currentState.editingInvoiceDate = invoice.date;
    window.currentState.cart = [...invoice.items];

    // Switch to Scan screen
    renderView('scan');

    // Slight delay to ensure DOM is rendered before setting values
    setTimeout(() => {
        const custInput = document.getElementById('cust-name');
        const phoneInput = document.getElementById('cust-phone');
        if (custInput) custInput.value = invoice.customerName || '';
        if (phoneInput) phoneInput.value = invoice.customerPhone || '';
        renderCart();
    }, 100);
};
