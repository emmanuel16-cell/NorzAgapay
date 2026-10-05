import { config } from '../config';

function toPhilippineInternationalNumber(phoneNumber: string): string | null {
  const digits = phoneNumber.replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return null;
}

export const smsService = {
  async sendRegistrationOtp(phoneNumber: string, otp: string): Promise<boolean> {
    return sendSms(
      phoneNumber,
      `Your NorzAgapay verification code is ${otp}. It expires in 10 minutes. Do not share this code.`,
      'registration OTP',
    );
  },

  async sendTemporaryPasswordSms(phoneNumber: string, temporaryPassword: string): Promise<boolean> {
    return sendSms(
      phoneNumber,
      `Your NorzAgapay temporary password is ${temporaryPassword}. Sign in and change it after logging in. Do not share it.`,
      'temporary password',
    );
  },
};

async function sendSms(phoneNumber: string, message: string, purpose: string): Promise<boolean> {
  if (!config.smsApiKey) {
    console.error('[SmsService] SMS_API_KEY is not configured.');
    return false;
  }

  const recipient = toPhilippineInternationalNumber(phoneNumber);
  if (!recipient) {
    console.error(`[SmsService] ${purpose} recipient is not a valid Philippine mobile number.`);
    return false;
  }

  try {
    const response = await fetch(`${config.smsApiBaseUrl}/send/sms`, {
      method: 'POST',
      headers: {
        'x-api-key': config.smsApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient,
        message,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const result = await response.json().catch(() => null) as { success?: boolean; error?: string; message?: string } | null;
    if (!response.ok || result?.success === false) {
      console.error(`[SmsService] SMS API rejected the ${purpose} request (HTTP ${response.status}).`);
      return false;
    }

    console.log(`[SmsService] ${purpose} accepted by SMS API.`);
    return true;
  } catch (err: any) {
    console.error(`[SmsService] SMS API ${purpose} request failed:`, err.message);
    return false;
  }
}
