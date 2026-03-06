# Task: Manage Staff and Administrative Access

- [x] Create a guide on revoking staff/admin access <!-- id: 0 -->
- [x] (Optional) Add 'Edit Role' functionality to Staff Management <!-- id: 1 -->
    - [x] Add 'Edit' button to `renderStaffList` <!-- id: 2 -->
    - [x] Create `showEditStaffModal` function <!-- id: 3 -->
    - [x] Update `handleSaveStaff` to handle role updates <!-- id: 4 -->
- [x] Fix: Missing staff member glitch for Super Admin (v3.5.1)
- [x] Security: Prevent Store Admins from seeing/editing Super Admins <!-- id: 7 -->
    - [x] Filter Super Admins from `listenToStaff` for non-master users <!-- id: 8 -->
    - [x] Update `renderStaffList` UI logic to hide management buttons for higher roles <!-- id: 9 -->
- [x] Verify security hardening and push changes <!-- id: 10 -->
