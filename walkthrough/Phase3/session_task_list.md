# Task: Manage Staff and Administrative Access

- [x] Create a guide on revoking staff/admin access <!-- id: 0 -->
- [x] (Optional) Add 'Edit Role' functionality to Staff Management <!-- id: 1 -->
    - [x] Add 'Edit' button to `renderStaffList` <!-- id: 2 -->
    - [x] Create `showEditStaffModal` function <!-- id: 3 -->
    - [x] Update `handleSaveStaff` to handle role updates <!-- id: 4 -->
- [x] Fix: Missing staff member glitch for Super Admin (v3.5.1)
- [x] Security: Prevent Store Admins from seeing/editing Super Admins <!-- id: 7 -->
- [x] Security: Prevent Store Admins from seeing other Store Admins <!-- id: 11 -->
    - [x] Update `listenToStaff` with role-based filtering <!-- id: 12 -->
- [x] Fix: Store details not persisting during Data Repair <!-- id: 14 -->
    - [x] Update `fetchUserProfile` to sync `storeDetails` from invites <!-- id: 15 -->
- [x] Verify restrictions and data persistence, then push changes <!-- id: 13 -->
