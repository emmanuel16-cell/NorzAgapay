import { config } from '../config';

async function sendEmail(toEmail: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!config.sendGridApiKey || !config.emailFrom) {
    console.error('[EmailService] SENDGRID_API_KEY or EMAIL_FROM is not configured.');
    return false;
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.sendGridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: config.emailFrom, name: 'NorzAgapay Portal' },
        ...(config.emailReplyTo ? { reply_to: { email: config.emailReplyTo } } : {}),
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[EmailService] SendGrid rejected email to ${toEmail} (HTTP ${response.status}).`);
      return false;
    }

    console.log(`[EmailService] Email accepted by SendGrid for ${toEmail}.`);
    return true;
  } catch (err: any) {
    console.error(`[EmailService] HTTPS email request failed for ${toEmail}:`, err.message);
    return false;
  }
}

export const emailService = {
  /**
   * Send 6-digit OTP email for registration or password change
   */
  async sendOtpEmail(toEmail: string, otp: string, purpose: 'registration' | 'password_change' | 'barangay_password_change' | 'barangay_registration'): Promise<boolean> {
    const isRegistration = purpose === 'registration' || purpose === 'barangay_registration';
    const isBarangayRegistration = purpose === 'barangay_registration';
    const isBarangayPasswordChange = purpose === 'barangay_password_change';
    const subject = isRegistration
      ? 'Your NorzAgapay verification code'
      : 'Your NorzAgapay password change code';

    const actionText = isBarangayRegistration
      ? 'complete your NorzAgapay Barangay Administrator registration'
      : isRegistration
      ? 'complete your NorzAgapay citizen registration'
      : isBarangayPasswordChange
        ? 'update your NorzAgapay barangay account password'
        : 'update your resident account password';

    const html = `
      <div style="margin: 0; padding: 24px; background: #f5f7fa; color: #1f2937; font-family: Arial, Helvetica, sans-serif;">
        <div style="max-width: 480px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #dfe3e8;">
          <h1 style="margin: 0 0 20px; color: #163b5c; font-size: 22px;">NorzAgapay</h1>
          <p style="font-size: 16px; line-height: 1.5;">Your verification code is:</p>
          <p style="margin: 20px 0; color: #163b5c; font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 5px;">${otp}</p>
          <p style="font-size: 15px; line-height: 1.5;">Use this code to ${actionText}. It expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <p style="margin: 24px 0 0; color: #526171; font-size: 13px; line-height: 1.5;">If you did not request this code, you can ignore this email.</p>
        </div>
      </div>
    `;

    return sendEmail(
      toEmail,
      subject,
      html,
      `Your NorzAgapay verification code is ${otp}.\n\nUse this code to ${actionText}. It expires in 10 minutes. Do not share it with anyone.\n\nIf you did not request this code, you can ignore this email.`,
    );
  },

  /**
   * Send temporary password after OTP verification
   */
  async sendTemporaryPasswordEmail(toEmail: string, tempPass: string, fullName: string, audience: 'resident' | 'barangay' = 'resident'): Promise<boolean> {
    const subject = 'NorzAgapay - Your Temporary Login Password';

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #0c243b, #133e68, #0f5b78); padding: 24px; text-align: center; color: white;">
          <h2 style="margin: 0; font-size: 22px; font-weight: 800;">NorzAgapay</h2>
          <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Citizen Emergency &amp; Reporting Portal</p>
        </div>
        <div style="padding: 28px 24px; color: #1e293b;">
          <p style="font-size: 15px; line-height: 1.5; margin-top: 0;">Hello ${fullName || 'Resident'},</p>
          <div style="background: #f8fafc; border-left: 4px solid #1b4f72; padding: 14px 16px; border-radius: 6px; margin: 18px 0;">
            <p style="margin: 0; font-size: 14px; color: #0f172a; font-weight: 600;">
              NorzAgapay sent a temporary password. Don't share this to anyone. If it's not you that requested it, please ignore.
            </p>
          </div>
            <p style="font-size: 14px; line-height: 1.5; color: #475569;">
            Your temporary password for logging into the NorzAgapay ${audience === 'barangay' ? 'Barangay App' : 'Resident App'} is:
          </p>
          <div style="margin: 20px 0; text-align: center;">
            <div style="display: inline-block; background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 10px; padding: 12px 24px;">
              <span style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #1d4ed8; font-family: monospace;">${tempPass}</span>
            </div>
          </div>
          <p style="font-size: 13px; color: #475569; line-height: 1.5;">
            You can use this temporary password to log in. You can change your password anytime in your Profile settings.
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 11.5px; color: #94a3b8; line-height: 1.4; margin-bottom: 0;">
            NorzAgapay Incident Management &bull; Municipality of Norzagaray, Bulacan
          </p>
        </div>
      </div>
    `;

    return sendEmail(
      toEmail,
      subject,
      html,
      `NorzAgapay sent a temporary password for the NorzAgapay ${audience === 'barangay' ? 'Barangay' : 'Resident'} App: ${tempPass}. Do not share it. You can change your password in Profile settings.`,
    );
  },
};
