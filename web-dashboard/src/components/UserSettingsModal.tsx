import { useEffect, useState, type FormEvent } from 'react';
import { FileText, KeyRound, LogOut, MailCheck, MapPin, Moon, Phone, Save, ScrollText, Settings, ShieldCheck, Sun, UserRound, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import PasswordInput from './PasswordInput';
import BarangayAdministrationPage, { type BarangaySettingsSection } from '../pages/BarangayAdministrationPage';
import BarangayTeamPage from '../pages/BarangayTeamPage';
import { authAPI, barangayAPI, reportAPI } from '../lib/api';

type UserSettingsModalProps = {
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  onClose: () => void;
  onSignOut: () => void;
};

type SettingsSection = 'general' | 'profile' | 'security' | 'management' | BarangaySettingsSection;

const emptyPasswordForm = { otp: '', currentPassword: '', newPassword: '', confirmPassword: '' };
const messageOf = (error: any, fallback: string) => error?.response?.data?.error || fallback;

export default function UserSettingsModal({ theme, onThemeChange, onClose, onSignOut }: UserSettingsModalProps) {
  const { user, updateUser, updateToken } = useAuth();
  const isBarangay = user?.account_kind === 'barangay';
  const isBarangayAdmin = isBarangay && user?.role === 'admin';
  const isResident = user?.account_kind === 'resident' && user.role === 'resident';
  const canViewHotlines = isBarangay && Boolean(user?.barangay_id);
  const hasEmailContact = Boolean(user?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email));
  const hasPhoneContact = Boolean(user?.phone && /^09\d{9}$/.test(user.phone.replace(/\D/g, '')));
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [profile, setProfile] = useState({
    full_name: user?.full_name || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });
  const [residentBarangays, setResidentBarangays] = useState<Array<{ id: string; name: string }>>([]);
  const [residentBarangay, setResidentBarangay] = useState(user?.barangay_name || '');
  const [loadingBarangays, setLoadingBarangays] = useState(false);
  const [savingBarangay, setSavingBarangay] = useState(false);
  const [barangayLoadError, setBarangayLoadError] = useState('');
  const [passwordOtpSent, setPasswordOtpSent] = useState(false);
  const [passwordDeliveryMethod, setPasswordDeliveryMethod] = useState<'email' | 'sms'>(() => user?.email ? 'email' : 'sms');
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!isResident) return;
    let active = true;
    setLoadingBarangays(true);
    setBarangayLoadError('');
    reportAPI.verifiedBarangays()
      .then(({ data }) => {
        if (!active) return;
        const choices = Array.isArray(data)
          ? data.map((item: any) => ({ id: String(item.id), name: String(item.name || '') })).filter((item) => item.id && item.name)
          : [];
        setResidentBarangays(choices);
        setResidentBarangay((current) => current || user?.barangay_name || '');
      })
      .catch((error: any) => { if (active) setBarangayLoadError(messageOf(error, 'Verified barangays could not be loaded.')); })
      .finally(() => { if (active) setLoadingBarangays(false); });
    return () => { active = false; };
  }, [isResident, user?.barangay_name]);

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
    setSavingProfile(true);
    try {
      const updates = {
        full_name: profile.full_name.trim(),
        username: profile.username.trim(),
        email: profile.email.trim() ? profile.email.trim().toLowerCase() : null,
        phone: profile.phone.trim() ? profile.phone.replace(/\D/g, '') : null,
      };
      const { data } = isResident
        ? await authAPI.updateResidentProfile(updates)
        : isBarangay
          ? await barangayAPI.updateProfile(updates)
          : await authAPI.updateProfile(updates);
      if (data.token) updateToken(data.token);
      updateUser({ full_name: data.full_name, username: data.username, email: data.email, phone: data.phone });
      setProfile({ full_name: data.full_name, username: data.username || '', email: data.email || '', phone: data.phone || '' });
      toast.success('Profile details saved.');
    } catch (error: any) {
      toast.error(messageOf(error, 'Profile details could not be saved.'));
    } finally {
      setSavingProfile(false);
    }
  };

  const saveResidentBarangay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = residentBarangays.find((barangay) => barangay.name === residentBarangay);
    if (!selected) {
      toast.error('Choose one of the verified barangays in the list.');
      return;
    }
    setSavingBarangay(true);
    try {
      const { data } = await authAPI.updateResidentProfile({ barangay_name: selected.name });
      const savedName = data.barangay_name || selected.name;
      updateUser({ barangay_name: savedName });
      setResidentBarangay(savedName);
      toast.success('Barangay preference saved.');
    } catch (error: any) {
      toast.error(messageOf(error, 'Barangay preference could not be saved.'));
    } finally {
      setSavingBarangay(false);
    }
  };

  const sendPasswordCode = async () => {
    if (!passwordForm.currentPassword) {
      toast.error('Enter your current password before requesting a verification code.');
      return;
    }
    setSavingPassword(true);
    try {
      const request = { current_password: passwordForm.currentPassword, delivery_method: passwordDeliveryMethod } as const;
      const { data } = isBarangay
        ? await barangayAPI.requestProfilePasswordOtp(request)
        : await authAPI.requestWebPasswordOtp(request);
      setPasswordOtpSent(true);
      toast.success(data.message || 'Verification code sent.');
    } catch (error: any) {
      toast.error(messageOf(error, 'Password verification code could not be sent.'));
    } finally {
      setSavingPassword(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordForm.otp.trim().length !== 6) {
      toast.error('Enter the 6-digit verification code.');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('The new passwords do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      const request = {
        otp: passwordForm.otp.trim(),
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
        delivery_method: passwordDeliveryMethod,
      } as const;
      const { data } = isBarangay
        ? await barangayAPI.changeProfilePassword(request)
        : await authAPI.changeWebPassword(request);
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
            <button type="button" className={activeSection === 'profile' ? 'active' : ''} aria-current={activeSection === 'profile' ? 'page' : undefined} onClick={() => setActiveSection('profile')}><UserRound size={17} /> Profile</button>
            <button type="button" className={activeSection === 'security' ? 'active' : ''} aria-current={activeSection === 'security' ? 'page' : undefined} onClick={() => setActiveSection('security')}><KeyRound size={17} /> Change password</button>
            {isBarangayAdmin && <button type="button" className={activeSection === 'management' ? 'active' : ''} aria-current={activeSection === 'management' ? 'page' : undefined} onClick={() => setActiveSection('management')}><Users size={17} /> Barangay Management</button>}
            {isBarangayAdmin && <button type="button" className={activeSection === 'account' ? 'active' : ''} aria-current={activeSection === 'account' ? 'page' : undefined} onClick={() => setActiveSection('account')}><FileText size={17} /> Account Request</button>}
            {canViewHotlines && <button type="button" className={activeSection === 'hotlines' ? 'active' : ''} aria-current={activeSection === 'hotlines' ? 'page' : undefined} onClick={() => setActiveSection('hotlines')}><Phone size={17} /> Barangay Hotline</button>}
            {isBarangayAdmin && <button type="button" className={activeSection === 'location' ? 'active' : ''} aria-current={activeSection === 'location' ? 'page' : undefined} onClick={() => setActiveSection('location')}><MapPin size={17} /> Command Location</button>}
            {isBarangay && <button type="button" className={activeSection === 'terms' ? 'active' : ''} aria-current={activeSection === 'terms' ? 'page' : undefined} onClick={() => setActiveSection('terms')}><ScrollText size={17} /> Terms and Conditions</button>}
            {isBarangay && <button type="button" className={activeSection === 'privacy' ? 'active' : ''} aria-current={activeSection === 'privacy' ? 'page' : undefined} onClick={() => setActiveSection('privacy')}><ShieldCheck size={17} /> Privacy Policy</button>}
          </nav>

          <div className="user-settings-panel">
          {activeSection === 'general' ? <div className="user-settings-content">
          <section className="user-settings-section user-settings-account">
            <div className="user-settings-avatar" aria-hidden="true">{initials}</div>
            <div className="user-settings-account-copy"><strong>{user?.full_name || 'Dashboard user'}</strong><span>{isResident ? user?.username ? `@${user.username}` : user?.phone || 'Resident account' : user?.email || 'No email on this account'}</span><small>{user?.role === 'logistics' ? 'Staff' : user?.role?.replace(/_/g, ' ')}{user?.account_kind === 'barangay' && user.barangay_name ? ` · ${user.barangay_name}` : ''}</small></div>
          </section>

          <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h3>Appearance</h3><p>Choose the dashboard color theme.</p></div></div>
            <div className="user-settings-theme-options" role="group" aria-label="Dashboard theme">
              <button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'selected' : ''} onClick={() => onThemeChange('dark')}><Moon size={16} /> Dark</button>
              <button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'selected' : ''} onClick={() => onThemeChange('light')}><Sun size={16} /> Light</button>
            </div>
          </section>

          {isResident && <section className="user-settings-section">
            <div className="user-settings-section-heading"><div><h3>Barangay</h3><p>Choose your barangay to personalize local updates and services.</p></div><MapPin size={18} /></div>
            <form className="user-settings-form" onSubmit={(event) => void saveResidentBarangay(event)}>
              <label className="user-settings-barangay-select">Your barangay<select required value={residentBarangay} onChange={(event) => setResidentBarangay(event.target.value)} disabled={loadingBarangays || residentBarangays.length === 0}>
                <option value="">{loadingBarangays ? 'Loading verified barangays…' : 'Select your barangay'}</option>
                {user?.barangay_name && !residentBarangays.some((barangay) => barangay.name === user.barangay_name) && <option value={user.barangay_name}>{user.barangay_name} · current</option>}
                {residentBarangays.map((barangay) => <option key={barangay.id} value={barangay.name}>{barangay.name}</option>)}
              </select></label>
              {barangayLoadError && <p className="user-settings-managed-note" role="alert">{barangayLoadError}</p>}
              {!loadingBarangays && !barangayLoadError && residentBarangays.length === 0 && <p className="user-settings-managed-note">No verified barangays are currently available.</p>}
              <div className="user-settings-form-actions"><button className="btn btn-primary" disabled={savingBarangay || loadingBarangays || residentBarangays.length === 0}><MapPin size={15} /> {savingBarangay ? 'Saving…' : 'Save barangay'}</button></div>
            </form>
          </section>}

          </div> : activeSection === 'profile' ? <div className="user-settings-content">
            <section className="user-settings-section">
              <div className="user-settings-section-heading"><div><h3>Profile</h3><p>Update the personal and contact details used on your account.</p></div><UserRound size={18} /></div>
              <form className="user-settings-form" onSubmit={(event) => void saveProfile(event)}>
                <label>Full name<input required minLength={2} maxLength={100} autoComplete="name" value={profile.full_name} onChange={(event) => setProfile((value) => ({ ...value, full_name: event.target.value }))} /></label>
                <label>Username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]{3,32}" autoComplete="username" value={profile.username} onChange={(event) => setProfile((value) => ({ ...value, username: event.target.value }))} /></label>
                <label>Gmail / email address<input type="email" maxLength={254} autoComplete="email" value={profile.email} onChange={(event) => setProfile((value) => ({ ...value, email: event.target.value }))} placeholder="name@gmail.com" /></label>
                <label>Contact number<input type="tel" inputMode="numeric" autoComplete="tel" pattern="09[0-9]{9}" title="Enter 11 digits starting with 09" maxLength={11} value={profile.phone} onChange={(event) => setProfile((value) => ({ ...value, phone: event.target.value.replace(/\D/g, '').slice(0, 11) }))} placeholder="09XXXXXXXXX" /></label>
                <label>Role<input value={user?.role === 'logistics' ? 'Staff' : user?.role?.replace(/_/g, ' ') || ''} readOnly /></label>
                <p className="user-settings-managed-note">Roles are assigned by an administrator and can’t be changed from your profile.</p>
                <div className="user-settings-form-actions"><button className="btn btn-primary" disabled={savingProfile}><Save size={15} /> {savingProfile ? 'Saving…' : 'Save profile'}</button></div>
              </form>
            </section>
          </div> : activeSection === 'security' ? <div className="user-settings-content">
            <section className="user-settings-section">
              <div className="user-settings-section-heading"><div><h3>Change password</h3><p>Confirm your current password, then choose where to receive a one-time code.</p></div><KeyRound size={18} /></div>
              {!passwordOtpSent ? <div className="user-settings-resident-security-start">
                <label>Current password<PasswordInput required autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, currentPassword: event.target.value }))} /></label>
                <label>Send code to<select value={passwordDeliveryMethod} onChange={(event) => setPasswordDeliveryMethod(event.target.value as 'email' | 'sms')}>
                  <option value="email" disabled={!hasEmailContact}>Gmail / email{hasEmailContact ? ` · ${user?.email}` : ' · add one in Profile'}</option>
                  <option value="sms" disabled={!hasPhoneContact}>Mobile number{hasPhoneContact ? ` · ${user?.phone}` : ' · add one in Profile'}</option>
                </select></label>
                {!hasEmailContact && !hasPhoneContact && <p className="user-settings-managed-note">Add a Gmail address or mobile number in Profile to receive a verification code.</p>}
                <button type="button" className="btn btn-primary" onClick={() => void sendPasswordCode()} disabled={savingPassword || !passwordForm.currentPassword || (passwordDeliveryMethod === 'email' ? !hasEmailContact : !hasPhoneContact)}>
                  {passwordDeliveryMethod === 'email' ? <MailCheck size={15} /> : <Phone size={15} />}
                  {savingPassword ? 'Sending code…' : 'Verify and send code'}
                </button>
              </div> : <form className="user-settings-form" onSubmit={(event) => void changePassword(event)}>
                <p className="user-settings-sms-note" role="status">A 6-digit code was sent to your {passwordDeliveryMethod === 'email' ? 'email address' : 'mobile number'}.</p>
                <label>Current password<PasswordInput required autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, currentPassword: event.target.value }))} /></label>
                <label>Verification code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={passwordForm.otp} onChange={(event) => setPasswordForm((value) => ({ ...value, otp: event.target.value.replace(/\D/g, '').slice(0, 6) }))} /></label>
                <label>New password<PasswordInput required minLength={8} autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, newPassword: event.target.value }))} /></label>
                <label>Confirm new password<PasswordInput required minLength={8} autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((value) => ({ ...value, confirmPassword: event.target.value }))} /></label>
                <div className="user-settings-form-actions"><button className="btn btn-primary" disabled={savingPassword}><KeyRound size={15} /> Update password</button><button type="button" className="workspace-secondary-action" disabled={savingPassword} onClick={() => { setPasswordOtpSent(false); setPasswordForm(emptyPasswordForm); }}>Cancel</button><button type="button" className="workspace-secondary-action" disabled={savingPassword} onClick={() => void sendPasswordCode()}>Send a new code</button></div>
              </form>}
            </section>
          </div> : activeSection === 'management' ? <div className="user-settings-content user-settings-content-barangay"><BarangayTeamPage embedded /></div> : <div className="user-settings-content user-settings-content-barangay"><BarangayAdministrationPage embedded section={activeSection as BarangaySettingsSection} /></div>}
          </div>
        </div>

        <footer className="user-settings-footer">
          <button type="button" className="user-settings-signout" onClick={onSignOut}><LogOut size={17} /> Sign Out</button>
          <span>Changes apply to this signed-in account.</span>
          <button type="button" className="workspace-secondary-action" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}
