# Task: Manage Staff and Administrative Access

- [x] Create a guide on revoking staff/admin access <!-- id: 0 -->
- [x] (Optional) Add 'Edit Role' functionality to Staff Management <!-- id: 1 -->
    - [x] Add 'Edit' button to `renderStaffList` <!-- id: 2 -->
    - [x] Create `showEditStaffModal` function <!-- id: 3 -->
    - [x] Update `handleSaveStaff` to handle role updates <!-- id: 4 -->
- [x] Fix: Missing staff member glitch for Super Admin (v3.5.1)
- [x] Security: Prevent Store Admins from seeing/editing Super Admins <!-- id: 7 -->
- [x] Security: Prevent Store Admins from seeing other Store Admins <!-- id: 11 -->
- [x] Security: Verify Cross-Store Isolation <!-- id: 16 -->
    - [x] Audit `db.js` for queries missing `storeId` filters <!-- id: 17 -->
    - [x] Audit `app.js` for potential data leaks in global views <!-- id: 18 -->
    - [x] Harden `getStoreId` in `db.js` <!-- id: 21 -->
- [x] Final Verification and Push <!-- id: 20 -->
