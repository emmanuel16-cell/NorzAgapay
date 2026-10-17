/** Normalize supported Philippine mobile numbers to local 09XXXXXXXXX form. */
export function normalizeMobileNumber(value: unknown): string | null {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('639') && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith('9') && digits.length === 10) digits = `0${digits}`;
  return /^09\d{9}$/.test(digits) ? digits : null;
}

export function isMobileNumberRegistryConflict(error: any): boolean {
  if (!error) return false;
  const message = [error.constraint, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return error.code === '23505' && message.includes('account_mobile_numbers');
}
