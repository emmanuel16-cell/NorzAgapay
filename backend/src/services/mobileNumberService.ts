/** Accept only Philippine mobile numbers in exact 09XXXXXXXXX form. */
export function normalizeMobileNumber(value: unknown): string | null {
  const phone = String(value ?? '');
  return /^09\d{9}$/.test(phone) ? phone : null;
}

export function isMobileNumberRegistryConflict(error: any): boolean {
  if (!error) return false;
  const message = [error.constraint, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return error.code === '23505' && message.includes('account_mobile_numbers');
}
