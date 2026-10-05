/**
 * Each person's payslip PDF password, remembered in this browser only. It is
 * never sent anywhere. Storage can be blocked or empty; then nothing is
 * remembered and the box starts blank.
 */

const key = (userId: number) => `payslip-password:${userId}`;

export function loadPassword(userId: number): string {
  try { return localStorage.getItem(key(userId)) ?? ""; } catch { return ""; }
}

export function savePassword(userId: number, password: string): void {
  try {
    if (password) localStorage.setItem(key(userId), password);
    else localStorage.removeItem(key(userId));
  } catch { /* storage blocked */ }
}

export function forgetPassword(userId: number): void {
  try { localStorage.removeItem(key(userId)); } catch { /* storage blocked */ }
}
