# IPIQuoting
A tool to allow partners to create quotes and check price lists. 

## Admin auth migration (local unlock ➜ Microsoft SSO)

The current **Unlock Admin** password flow is an interim local control only. It should be treated as temporary until centralized authentication is completed.

### Planned migration path
1. **Introduce Microsoft identity sign-in** (Microsoft Entra ID / Azure AD) for user authentication.
2. **Map admin capabilities to SSO claims/groups** (for example, an `ipi-quoting-admin` group) and enforce those claims in the app.
3. **Replace local unlock state** (`localStorage` expiry + local password verification) with session/identity-based authorization checks.
4. **Remove local password fallback constants and UI text** once SSO admin access is live.
5. **Validate audit behavior** so admin actions continue to be captured after migration.

### Suggested rollout
- Run the SSO path in parallel behind a feature flag first.
- Verify existing admin workflows (catalogue updates, baseline replace, audit review).
- Remove the interim local unlock path only after SSO parity is confirmed.
