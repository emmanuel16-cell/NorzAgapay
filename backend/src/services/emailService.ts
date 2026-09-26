import nodemailer from 'nodemailer';
import { config } from '../config';

// Create Nodemailer Gmail Transporter using GMAILUSER and GMAILPASS
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAILUSER || config.gmailUser || 'emmanuelnabus16@gmail.com',
    pass: process.env.GMAILPASS || config.gmailPass || 'jeopajehxbflnsow',
  },
});

export const emailService = {
  /**
   * Send 6-digit OTP email for registration or password change
   */
  async sendOtpEmail(toEmail: string, otp: string, purpose: 'registration' | 'password_change'): Promise<boolean> {
    const isRegistration = purpose === 'registration';
    const subject = isRegistration
      ? 'NorzAgapay - Citizen Account Verification Code'
      : 'NorzAgapay - Password Change OTP Code';

    const actionText = isRegistration
      ? 'complete your NorzAgapay citizen registration'
      : 'update your resident account password';

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #0c243b, #133e68, #0f5b78); padding: 24px; text-align: center; color: white;">
          <h2 style="margin: 0; font-size: 22px; font-weight: 800;">NorzAgapay</h2>
          <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Municipality of Norzagaray • MDRRMO & Barangay Portal</p>
        </div>
        <div style="padding: 28px 24px; color: #1e293b;">
          <p style="font-size: 15px; line-height: 1.5; margin-top: 0;">Hello,</p>
          <p style="font-size: 14px; line-height: 1.5; color: #475569;">
            Use the 6-digit verification code below to ${actionText}:
          </p>
          <div style="margin: 24px 0; text-align: center;">
            <div style="display: inline-block; background: #f0fdf4; border: 2px dashed #22c55e; border-radius: 12px; padding: 14px 28px;">
              <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #15803d; font-family: monospace;">${otp}</span>
            </div>
          </div>
          <p style="font-size: 12.5px; color: #64748b; line-height: 1.5;">
            ⏰ This code will expire in <strong>10 minutes</strong>. For your security, do not share this code with anyone.
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="font-size: 11.5px; color: #94a3b8; line-height: 1.4; margin-bottom: 0;">
            If you did not request this verification code, please ignore this email.
          </p>
        </div>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: `"NorzAgapay Portal" <${process.env.GMAILUSER || 'emmanuelnabus16@gmail.com'}>`,
        to: toEmail,
        subject,
        html,
        text: `Your NorzAgapay verification code is ${otp}. It will expire in 10 minutes. If you did not request this, please ignore.`,
      });
      console.log(`[EmailService] OTP sent successfully to ${toEmail}`);
      return true;
    } catch (err: any) {
      console.error(`[EmailService] Failed to send OTP to ${toEmail}:`, err.message);
      return false;
    }
  },

  /**
   * Send temporary password after OTP verification
   */
  async sendTemporaryPasswordEmail(toEmail: string, tempPass: string, fullName: string): Promise<boolean> {
    const subject = 'NorzAgapay - Your Temporary Login Password';

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #0c243b, #133e68, #0f5b78); padding: 24px; text-align: center; color: white;">
          <h2 style="margin: 0; font-size: 22px; font-weight: 800;">NorzAgapay</h2>
          <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Citizen Emergency & Reporting Portal</p>
        </div>
        <div style="padding: 28px 24px; color: #1e293b;">
          <p style="font-size: 15px; line-height: 1.5; margin-top: 0;">Hello ${fullName || 'Resident'},</p>
          <div style="background: #f8fafc; border-left: 4px solid #1b4f72; padding: 14px 16px; border-radius: 6px; margin: 18px 0;">
            <p style="margin: 0; font-size: 14px; color: #0f172a; font-weight: 600;">
              NorzAgapay sent a temporary password. Don't share this to anyone. If it's not you that requested it, please ignore.
            </p>
          </div>
          <p style="font-size: 14px; line-height: 1.5; color: #475569;">
            Your temporary password for logging into the NorzAgapay Resident App is:
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
            NorzAgapay Incident Management • Municipality of Norzagaray, Bulacan
          </p>
        </div>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: `"NorzAgapay Portal" <${process.env.GMAILUSER || 'emmanuelnabus16@gmail.com'}>`,
        to: toEmail,
        subject,
        html,
        text: `NorzAgapay sent a temporary password: ${tempPass}. Don't share this to anyone. If it's not you that requested it, please ignore. You can use this temporary password to login and change your password in Profile settings.`,
      });
      console.log(`[EmailService] Temporary password sent successfully to ${toEmail}`);
      return true;
    } catch (err: any) {
      console.error(`[EmailService] Failed to send temporary password to ${toEmail}:`, err.message);
      return false;
    }
  },
};
