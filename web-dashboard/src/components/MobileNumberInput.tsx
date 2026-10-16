import type { ClipboardEvent, InputHTMLAttributes } from 'react';
import { normalizeMobileNumberInput, sanitizeMobileNumberInput } from '../lib/mobileNumber';

type MobileNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'maxLength' | 'pattern'> & {
  value: string;
  onValueChange: (value: string) => void;
};

export default function MobileNumberInput({ value, onValueChange, onPaste, ...props }: MobileNumberInputProps) {
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    onValueChange(sanitizeMobileNumberInput(event.clipboardData.getData('text')));
  };

  return <input
    {...props}
    type="tel"
    inputMode="numeric"
    autoComplete={props.autoComplete || 'tel'}
    pattern="09[0-9]{9}"
    title={props.title || 'Enter exactly 11 digits starting with 09.'}
    maxLength={11}
    value={normalizeMobileNumberInput(value)}
    onChange={(event) => onValueChange(sanitizeMobileNumberInput(event.currentTarget.value))}
    onPaste={handlePaste}
  />;
}
