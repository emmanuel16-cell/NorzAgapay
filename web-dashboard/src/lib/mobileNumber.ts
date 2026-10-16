/** Convert an entered value to a local Philippine mobile number while typing. */
export function sanitizeMobileNumberInput(value: string): string {
  let digits = String(value || '').replace(/\D/g, '');

  // Support pasting the international form of a Philippine mobile number.
  if (digits.startsWith('639')) digits = `0${digits.slice(2)}`;
  if (!digits) return '';
  if (digits[0] !== '0') return '';
  if (digits.length > 1 && digits[1] !== '9') return '0';
  return digits.slice(0, 11);
}

/** Normalize an existing stored value for a local mobile-number input. */
export function normalizeMobileNumberInput(value?: string | null): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('639')) digits = `0${digits.slice(2)}`;
  return sanitizeMobileNumberInput(digits);
}

export function isValidMobileNumber(value?: string | null): boolean {
  return /^09\d{9}$/.test(normalizeMobileNumberInput(value));
}

/** Format valid Philippine mobile numbers for display; preserve short codes and landlines. */
export function formatMobileNumber(value?: string | null): string {
  const original = String(value || '').trim();
  let digits = original.replace(/\D/g, '');
  if (digits.startsWith('639')) digits = `0${digits.slice(2)}`;
  if (!/^09\d{9}$/.test(digits)) return original;
  return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
}
