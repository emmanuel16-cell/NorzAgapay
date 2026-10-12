import { useEffect, useState, type FormEvent } from 'react';
import { Building2, KeyRound, MailCheck, Moon, Save, Settings, Sun, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import PasswordInput from './PasswordInput';
import BarangayAdministrationPage from '../pages/BarangayAdministrationPage';
import { authAPI, barangayAPI } from '../lib/api';

type UserSettingsModalProps = {
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  onClose: () => void;
};

const emptyPasswordForm = { otp: '', currentPassword: '', newPassword: '', confirmPassword: '' };
const messageOf = (error: any, fallback: string) => error?.response?.data?.error || fallback;

export default function UserSettingsModal({ theme, onThemeChange, onClose }: UserSettingsModalProps) {
  const { user, updateUser } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const [activeSection, setActiveSection] = useState<'general' | 'barangay'>('general');
  const [profile, setProfile] = useState({ full_name: user?.full_name || '', phone: user?.phone || '' });
  const [passwordOtpSent, setPasswordOtpSent] = useState(false);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isBarangay) return;
    setSavingProfile(true);
    try {
      const { data } = await barangayAPI.updateProfile({ full_name: profile.full_name.trim(), phone: profile.phone.trim() });
      updateUser({ full_name: data.full_name, phone: data.phone });
      toast.success('Profile details saved.');
    } catch (error: any) {
      toast.error(messageOf(error, 'Profile details could not be saved.'));
    } finally {
      setSavingProfile(false);
    }
  };

  const sendPasswordCode = async () => {
    if (!user?.email) {
      toast.error('This account has no email address for verification.');
      return;
    }
    setSavingPassword(true);
    try {
      const { data } = await authAPI.sendBarangayPasswordOtp(user.email);
      setPasswordOtpSent(true);
      toast.success(data.message || `Verification code sent to ${user.email}.`);
    } catch (error: any) {
      toast.error(messageOf(error, 'Password verification code could not be sent.'));
    } finally {
      setSavingPassword(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isBarangay) return;
    if (passwordForm.otp.trim().length !== 6) {
      toast.error('Enter the 6-digit email verification code.');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('The new passwords do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      const { data } = await authAPI.changeBarangayPassword({
        email: user?.email || '',
        otp: passwordForm.otp.trim(),
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
      });
      setPasswordForm(emptyPasswordForm);
      setPasswordOtpSent(false);
      toast.success(data.message || 'Password updated successfully.');
    } catch (error: any) {
      toast.error(messageOf(error, 'Password could not be updated.'));
    } finally {
      setSavingPassword(false);
    }
  };

  const initials = user?.full_name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').toUpperCase().slice(0, 2) || 'NA';

  return (
    <div className="user-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="user-settings-modal" role="dialog" aria-modal="true" aria-labelledby="user-settings-title">
        <header className="user-settings-header">
          <div className="user-settings-heading-icon"><Settings size={19} /></div>
          <div><h2 id="user-settings-title">Settings</h2><p>Manage your account and dashboard preferences.</p></div>
          <button type="button" className="user-settings-close" onClick={onClose} aria-label="Close settings"><X size={19} /></button>
        </header>

        <div className="user-settings-layout">
          <nav className="user-settings-nav" aria-label="Settings sections">
            <button type="button" className={activeSection === 'general' ? 'active' : ''} aria-current={activeSection === 'general' ? 'page' : undefined} onClick={() => setActiveSection('general')}><UserRound size={17} /> General</button>
            {isBarangay && <button type="button" className={activeSection === 'barangay' ? 'active' : ''} aria-current={activeSection === 'barangay' ? 'page' : undefined} onClick={() => setActiveSection('barangay')}><Building2 size={17} /> Barangay Settings</button>}
          </nav>

          <div className="user-settings-panel">
          {activeSection === 'general' ? <div className="user-settings-content">
          <section className="user-settings-section user-settings-account">
            <div className="user-settings-avatar" aria-hidden="true">{initials}</div>
            <div className="user-settings-account-copy"><strong>{user?.full_name || 'Dashboard user'}</strong><span>{user?.email || 'No email on this account'}</span><small>{user?.role === 'logistics' ? 'Staff' : user?.role?.replace(/_/g, ' ')}{user?.account_kind === 'barangay' && user.barangay_name ? ` · ${user.barangay_name}` : ''}</small></div>
          </section>

          <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h3>Appearance</h3><p>Choose the dashboard color theme.</p></div></div>
            <div className="user-settings-theme-options" role="group" aria-label="Dashboard theme">
              <button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'selected' : ''} onClick={() => onThemeChange('dark')}><Moon size={16} /> Dark</button>
              <button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'selected' : ''} onClick={() => onThemeChange('light')}><Sun size={16} /> Light</button>
            </div>
          </section>

          {isBarangay && <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h3>Profile</h3><p>Update the name and mobile number on your barangay account.</p></div></div>
            <form className="user-settings-form" onSubmit={(event) => void saveProfile(event)}>
              <label>Full name<input required minLength={2} maxLength={100} value={profile.full_name} onChange={(event) => setProfile((value) => ({ ...value, full_name: event.target.value }))} /></label>
              <label>Mobile number<input required type="tel" pattern="09[0-9]{9}" title="Enter 11 digits starting with 09" maxLength={11} value={profile.phone} onChange={(event) => setProfile((value) => ({ ...value, phone: event.target.value.replace(/\D/g, '').slice(0, 11) }))} placeholder="09XXXXXXXXX" /></label>
              <div className="user-settings-form-actions"><button className="btn btn-primary" disabled={savingProfile}><Save size={15} /> Save profile</button></div>
            </form>
          </section>}

          {isBarangay && <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h3>Security</h3><p>Verify your email and current password before changing it.</p></div><KeyRound size={18} /></div>
            {!passwordOtpSent ? <div className="user-settings-security-start"><span>{user?.email || 'No email address is set for this account.'}</span><button type="button" className="workspace-secondary-action" onClick={() => void sendPasswordCode()} disabled={savingPassword || !user?.email}><MailCheck size={15} /> Send code</button></div> : <form className="user-settings-form" onSubmit={(event) => void changePassword(event)}>
              <label>Email verification code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={passwordForm.otp} onChange={(event) => setPasswordForm((value) => ({ ...value, otp: event.target.value.replace(/\D/g, '').slice(0, 6) }))} /></label>
              <label>Current password<PasswordInput required autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, currentPassword: event.target.value }))} /></label>
              <label>New password<PasswordInput required minLength={6} autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, newPassword: event.target.value }))} /></label>
              <label>Confirm new password<PasswordInput required minLength={6} autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, confirmPassword: event.target.value }))} /></label>
              <div className="user-settings-form-actions"><button className="btn btn-primary" disabled={savingPassword}><KeyRound size={15} /> Update password</button><button type="button" className="workspace-secondary-action" disabled={savingPassword} onClick={() => { setPasswordOtpSent(false); setPasswordForm(emptyPasswordForm); }}>Cancel</button><button type="button" className="workspace-secondary-action" disabled={savingPassword} onClick={() => void sendPasswordCode()}>Send a new code</button></div>
            </form>}
          </section>}

          {!isBarangay && <p className="user-settings-managed-note">Official account details are managed by your system administrator.</p>}
          </div> : <div className="user-settings-content user-settings-content-barangay"><BarangayAdministrationPage embedded /></div>}
          </div>
        </div>

        <footer className="user-settings-footer"><span>Changes apply to this signed-in account.</span><button type="button" className="workspace-secondary-action" onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
}
