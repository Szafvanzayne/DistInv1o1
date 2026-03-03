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

import { db, auth } from './db.js?v=2.3';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

window.currentState = {
    view: 'home',            // Current visible screen
    inventory: [],           // List of products (cached)
    cart: [],                // Items currently in the bill
    currentInvoice: null,    // The invoice being generated
    currentPdfBlob: null,    // The PDF file data
    unsubProducts: null,     // Firebase snapshot listener functions
    unsubInvoices: null,
    editingInvoiceId: null,
    editingInvoiceDate: null
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
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log("User logged in:", user.uid);
            window.currentState.user = user;
            // Show lower navigation tools
            const nav = document.querySelector('.bottom-nav');
            if (nav) nav.style.display = 'flex';

            // Re-render current view or go home if on login
            if (window.currentState.view === 'login' || !window.currentState.view) {
                renderView('home');
            } else {
                renderView(window.currentState.view);
            }
        } else {
            console.log("User logged out");
            window.currentState.user = null;
            // Hide navigation items so user cannot access inventory without login
            const nav = document.querySelector('.bottom-nav');
            if (nav) nav.style.display = 'none';

            renderView('login');
        }
    });
});

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

window.renderView = (viewName) => {
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
                        <button type="submit" name="action" value="register" onclick="this.form.submitedBtn='register'" class="btn-secondary">Register New Store Account</button>
                    </form>
                </div>
            `;
            break;

        case 'home':
            app.innerHTML = `
                <div class="screen active" style="padding: 0;">
                    <div class="wave-header"></div>
                    <div style="position: relative; z-index: 2; padding: 20px;">
                        <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; margin-top: 10px;">
                            <div>
                                <h1 style="color: white; margin-bottom: 5px;">Dashboard</h1>
                                <p style="color: rgba(255,255,255,0.8); font-size: 14px;">Welcome Back</p>
                            </div>
                            <div style="width: 48px; height: 48px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                                <span class="material-icons-round" style="color: #1e3a8a;">person</span>
                            </div>
                        </header>

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
                        <div style="display: grid; gap: 15px;">
                             <button class="btn-primary" onclick="document.querySelector('[data-target=scan]').click()">
                                <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                                    <span class="material-icons-round">qr_code_scanner</span> 
                                    <span>Create Invoice</span>
                                </div>
                            </button>
                            
                            <button class="btn-secondary" onclick="document.querySelector('[data-target=inventory]').click()">
                                <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                                    <span class="material-icons-round">add_circle_outline</span> 
                                    <span>Add Product</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            loadDashboardStats();
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
                        <label>Customer Name</label>
                        <input type="text" id="cust-name" placeholder="Walk-in Customer" style="margin-bottom: 0;">
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
            break;

        case 'invoice-preview':
            // Expects currentState.currentInvoice to be set
            const inv = currentState.currentInvoice;
            if (!inv) { renderView('home'); return; }

            const shopSettings = JSON.parse(localStorage.getItem('shopSettings')) || {
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
                            </div>
                            <div style="text-align: right;">
                                <div style="color: #94a3b8; font-size: 11px; text-transform: uppercase;">Date</div>
                                <div style="font-weight: 600;">${new Date(inv.date).toLocaleDateString()}</div>
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
                                        <td style="padding: 8px 0; text-align: right;">₹${(item.retailPrice * item.qty).toFixed(2)}</td>
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

        case 'invoices':
            app.innerHTML = `
                <div class="screen active">
                    <h1>History</h1>
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
            const settings = JSON.parse(localStorage.getItem('shopSettings')) || {
                name: 'BigStore Pro',
                gstin: '29ABCDE1234F1Z5',
                address: 'Kerala, India',
                phone: '9876543210'
            };

            app.innerHTML = `
                <div class="screen active">
                    <h1>Settings</h1>
                    
                    <div class="card" style="margin-top: 20px;">
                        <h3 class="mb-2">Store Details</h3>
                        <p style="color: var(--text-secondary); font-size: 12px; margin-bottom: 15px;">These details will appear on your invoices.</p>
                        
                        <form onsubmit="saveSettings(event)">
                            <div style="margin-bottom: 15px;">
                                <label>Shop Name</label>
                                <input type="text" name="shopName" value="${settings.name}" required>
                            </div>
                            <div style="margin-bottom: 15px;">
                                <label>GSTIN</label>
                                <input type="text" name="gstin" value="${settings.gstin}">
                            </div>
                             <div style="margin-bottom: 15px;">
                                <label>Address</label>
                                <input type="text" name="address" value="${settings.address}">
                            </div>
                            <div style="margin-bottom: 15px;">
                                <label>Phone</label>
                                <input type="text" name="phone" value="${settings.phone}">
                            </div>
                            <button type="submit" class="btn-primary">Save Details</button>
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
                        <p>App Version: <strong>v2.9.0 (Cloud Sync Active)</strong></p>
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
    errorDiv.style.display = 'none';

    try {
        if (action === 'register') {
            await createUserWithEmailAndPassword(auth, email, password);
        } else {
            await signInWithEmailAndPassword(auth, email, password);
        }
    } catch (err) {
        errorDiv.innerText = err.message.replace('Firebase: ', '');
        errorDiv.style.display = 'block';
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
        const itemTotal = (item.retailPrice * item.qty).toFixed(2);
        total += parseFloat(itemTotal);
        return `
            <div class="card" style="padding: 10px 15px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h3 style="color: var(--text-main); font-weight: 600;">${item.name}</h3>
                        <div style="font-size: 12px; color: var(--text-secondary);">₹${item.retailPrice} x ${item.qty}</div>
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
        resultsDiv.innerHTML = hits.map(p => `
            <div onclick="addToCart('${p.barcode}'); document.getElementById('search-results').style.display='none'; document.getElementById('product-search').value='';" 
                style="padding: 10px; border-bottom: 1px solid #eee; cursor: pointer;">
                <div style="font-weight: 600;">${p.name}</div>
                <div style="font-size: 12px; color: #666;">SKU: ${p.barcode} | ₹${p.retailPrice}</div>
            </div>
        `).join('');
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
window.saveSettings = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const settings = {
        name: formData.get('shopName'),
        gstin: formData.get('gstin'),
        address: formData.get('address'),
        phone: formData.get('phone')
    };
    localStorage.setItem('shopSettings', JSON.stringify(settings));
    alert("Store Details Saved!");
};

// --- Invoicing & PDF ---
// Handles calculating totals and generating the final PDF document.
// Uses 'jsPDF' library for PDF creation.
//
// EDITING TIP: To change the PDF layout, look at the 'doc.text()' calls below.
// The coordinates are (X, Y). increasing Y moves text down.

window.generateInvoice = async () => {
    const custName = document.getElementById('cust-name').value || 'Guest';
    if (currentState.cart.length === 0) {
        alert("Cart is empty!");
        return;
    }

    // 1. Calculate
    let totalTaxable = 0;
    let totalGST = 0;
    let totalAmount = 0;

    currentState.cart.forEach(item => {
        const itemTotal = item.retailPrice * item.qty;
        totalAmount += itemTotal;
        const itemTax = (item.gstAmount || 0) * item.qty;
        totalGST += itemTax;
        totalTaxable += (itemTotal - itemTax);
    });

    // 2. Create Object (use existing ID and Date if editing)
    const activeId = currentState.editingInvoiceId || Date.now().toString();
    const activeDate = currentState.editingInvoiceDate || new Date().toISOString();

    const invoice = {
        id: activeId,
        date: activeDate,
        customerName: custName,
        items: [...currentState.cart],
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

    renderView('invoice-preview');
};

// Internal function to create PDF on demand
async function getGeneratedPdfBlob() {
    const invoice = currentState.currentInvoice;
    if (!invoice) return null;

    const settings = JSON.parse(localStorage.getItem('shopSettings')) || {
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
    doc.text(`Invoice #: ${invoice.id}`, 14, 56);
    doc.text(`Date: ${new Date(invoice.date).toLocaleDateString()}`, 14, 62);
    doc.text(`Customer: ${invoice.customerName}`, 14, 68);

    // Table
    let y = 80;
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
        const itemTotal = (item.retailPrice * item.qty).toFixed(2);
        doc.text(item.name.substring(0, 30), 14, y);
        doc.text(String(item.qty), 100, y);
        doc.text(String(item.retailPrice), 130, y);
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

    const shopSettings = JSON.parse(localStorage.getItem('shopSettings')) || { name: 'BigStore Pro' };

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
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ title: 'Invoice', text: text, files: [file] });
            } else {
                window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
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

    // Slight delay to ensure DOM is rendered before setting value
    setTimeout(() => {
        const custInput = document.getElementById('cust-name');
        if (custInput) custInput.value = invoice.customerName || '';
        renderCart();
    }, 100);
};
