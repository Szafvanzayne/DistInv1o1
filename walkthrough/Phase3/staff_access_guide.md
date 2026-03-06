# Guide: Managing Staff & Administrative Access

In **BigStore Pro**, access is managed through **Role-Based Access Control (RBAC)**. This guide teaches you how to remove administrative access from any user and how to understand our permission system.

## 1. Understanding Roles

| Role | Access Level | Description |
| :--- | :--- | :--- |
| **Super Admin** | Full Global Access | Can see all stores, manage all users, and change global settings. |
| **Store Admin** | Full Store Access | Can see reports, manage inventory, and invite staff for their specific store. |
| **Staff** | Limited Access | Can only perform billing and view stock. Cannot see Reports or Staff management. |

---

## 2. How to "Remove Access"

### Scenario A: Completely Remove a Staff Member
To revoke all access for a staff member (e.g., if they leave the company):
1.  Log in as a **Store Admin** or **Super Admin**.
2.  Navigate to **Settings** > **Staff**.
3.  Find the staff member in the list.
4.  Click the **Delete** (Trash) icon.
5.  Confirm the action. The user will be immediately logged out and blocked.

### Scenario B: Revoke Administrative Privileges (Demote)
If a user is currently a **Store Admin** and you want them to be just **Staff**:
1.  Open the **Staff** tab.
2.  (Existing Workflow): Delete the user and re-invite them with the **Staff** role.
3.  (New Workflow - *In Progress*): Use the **Edit** icon next to their name to change their role from "Store Admin" to "Staff".

---

## 3. How Security Works (Under the Hood)

Administrative access is restricted in two ways:

1.  **Frontend Layout (`app.js`)**:
    The system checks the user's role and hides the "Management" and "Settings" tabs if they are not an admin.
    ```javascript
    function updateNavVisibility(role) {
        if (target === 'management' || target === 'settings') {
            item.style.display = (role === 'super_admin' || role === 'store_admin') ? 'flex' : 'none';
        }
    }
    ```

2.  **Database Firestore Rules**:
    Access to the `reports` and `users` collections is protected by the user's role stored in their cloud profile.

---

## 4. Troubleshooting
*   **"My staff can still see the Reports tab!"**: Ensure their role is set to `staff` in the Staff list. If it says `store_admin`, they have full access.
*   **"I deleted them but they are still logged in!"**: Firebase will maintain the session until the next token refresh, but all database calls will be blocked immediately as their ID is removed from the permitted users list.
