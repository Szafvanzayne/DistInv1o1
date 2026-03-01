# Phase 2: Multi-Store Login Architecture

## Goal Description
The objective is to upgrade BigStore Pro from a single-user local application into a multi-tenant platform. This allows multiple distinct stores (users) to log into the same application (via the web URL or the same APK) without their inventory databases or generated invoices colliding.

## Proposed Strategy

### 1. Authentication Layer (Firebase / Supabase)
To manage user credentials securely without building a complex backend from scratch, we will integrate a Backend-as-a-Service (BaaS) provider.
- **Action**: Implement a Login/Registration screen as the very first view upon opening the app.
- **Action**: Use Email/Password or Phone Number (OTP) authentication.
- **Action**: Generate a unique `storeId` (or `userId`) for each authenticated account.

### 2. Database Restructuring (IndexedDB -> Cloud + Local Sync)
Currently, `db.js` writes directly to a local, generic IndexedDB. This must be refactored.
- **Action**: Attach the `storeId` to every product and invoice created.
- **Action**: Modify `db.js` to either:
  a) Maintain the local-first architecture (Offline capability) by creating separate IndexedDB stores per `storeId`.
  b) Transition to a cloud database (Firestore / Supabase Postgres) to allow the store owner to log in from *multiple devices* and see the same synced data.

*(Option B is highly recommended for multi-device support, which is typically expected of account-based apps).*

### 3. Application State Management
- **Action**: Update `app.js` global `currentState` to track if the user is authenticated.
- **Action**: Prevent unauthorized access to `inventory`, `scan`, and `dashboard` views until a valid token/session is present.
- **Action**: Add a "Logout" button to the Settings screen to flush the `currentState` and clear the local cache.

## Roadmap / To-Do
- [ ] Choose Authentication Provider (Firebase or Supabase).
- [ ] Build Login / Registration UI.
- [ ] Refactor `db.js` to support Cloud Synchronization or at minimum, tenant-isolated local storage.
- [ ] Protect all inner routes using a session-check wrapper.
