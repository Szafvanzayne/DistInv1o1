/**
 * BigStore Pro - Database Module
 * Uses IndexedDB via 'idb' library (loaded in index.html)
 */

const DB_NAME = 'invoicer-pro-db';
const DB_VERSION = 1;

export const db = {
    async open() {
        return idb.openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                // Products Store
                if (!db.objectStoreNames.contains('products')) {
                    const productStore = db.createObjectStore('products', { keyPath: 'barcode' });
                    productStore.createIndex('name', 'name', { unique: false });
                }

                // Invoices Store
                if (!db.objectStoreNames.contains('invoices')) {
                    const invoiceStore = db.createObjectStore('invoices', { keyPath: 'id' });
                    invoiceStore.createIndex('date', 'date', { unique: false });
                }
            },
        });
    },

    // --- Products ---

    async addProduct(product) {
        const dbPromise = await this.open();
        return dbPromise.put('products', product);
    },

    async getProduct(barcode) {
        const dbPromise = await this.open();
        return dbPromise.get('products', barcode);
    },

    async getAllProducts() {
        const dbPromise = await this.open();
        return dbPromise.getAll('products');
    },

    async deleteProduct(barcode) {
        const dbPromise = await this.open();
        return dbPromise.delete('products', barcode);
    },

    // --- Invoices ---

    async createInvoice(invoice) {
        const dbPromise = await this.open();
        return dbPromise.put('invoices', invoice);
    },

    async getAllInvoices() {
        const dbPromise = await this.open();
        return dbPromise.getAll('invoices');
    },

    async getInvoice(id) {
        const dbPromise = await this.open();
        return dbPromise.get('invoices', id);
    }
};
