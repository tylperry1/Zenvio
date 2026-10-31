import { redirect } from 'next/navigation';
import { session, ApiError } from './server';
import { adminSession, type StaffPermission } from './admin';
// admin: true = master admin only; a permission (or list) also admits employees holding it.
export async function requirePageSession(admin: boolean | StaffPermission | StaffPermission[] = false) {
  try {
    if (admin === false) return await session();
    return await adminSession(admin === true ? undefined : admin);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/sign-in');
    if (e instanceof ApiError && e.status === 403) redirect(admin === false || admin === true ? '/app' : '/admin');
    throw e;
  }
}
export async function requireAdminPage(permission?: StaffPermission | StaffPermission[]) {
  try {
    return await adminSession(permission);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/sign-in');
    if (e instanceof ApiError && e.status === 403) redirect(permission ? '/admin' : '/app');
    throw e;
  }
}
