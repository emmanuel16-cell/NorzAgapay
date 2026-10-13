import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BadgeCheck, Check, Download, Edit3, FileCheck2, FileText, MapPin, Phone, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { API_BASE, barangayAPI, reportAPI, socket } from '../lib/api';

type HotlineEntry = { purpose: string; numbers: string[] };
type Verification = {
  status?: string;
  reference_no?: string;
  punong_barangay_name?: string;
  punong_barangay_position?: string;
  position_designation?: string;
  document_url?: string | null;
  submitted_at?: string | null;
  rejection_reason?: string | null;
  correction_reason?: string | null;
  verification_history?: Array<{ action?: string; timestamp?: string; note?: string; actor?: string }>;
};

const barangayPolicies = [
  {
    title: 'Terms and Conditions',
    subtitle: 'Norz-Agapay Barangay Web Dashboard',
    paragraphs: [
      '1. Use of the Barangay Dashboard. The dashboard is for authorized barangay personnel to view public advisories and support local emergency response. Use the account and functions assigned to your role. Do not share your credentials or attempt to access another person’s account.',
      '2. Public Posts and Incident Reports. Use the reporting and posting tools for legitimate public safety and barangay response purposes. Provide accurate information, and only upload media that you are authorized to share. Do not post unlawful, misleading, abusive, or unrelated material.',
      '3. Information Handling. Access personal information and incident details only as needed for your official duties. Do not copy, disclose, or use information outside the response purpose. Follow your barangay’s records-handling and security procedures.',
      '4. Account Security. Keep your device and sign-in credentials secure. Notify your administrator if you suspect unauthorized access, loss of a device, or exposure of information.',
      '5. Service Availability. The app depends on device, network, and municipal services. Information may be delayed or unavailable during outages. Follow official emergency procedures and contact the appropriate response office directly when urgent action is required.',
      '6. Updates. These terms may be updated when app functions or applicable requirements change. Continued use after an update means you acknowledge the revised terms.',
    ],
  },
  {
    title: 'Privacy Policy',
    subtitle: 'Barangay dashboard personnel data and incident information',
    paragraphs: [
      'This notice describes how personal information is handled when you use the Norz-Agapay Barangay Web Dashboard. Processing must follow applicable requirements, including the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).',
      '1. Information Processed. Depending on the feature used, the dashboard may process account and profile details such as your name, email address, phone number, barangay, role, and sign-in status. Incident records may include descriptions, photos or videos, location coordinates, submission details, and response updates.',
      '2. Purposes. Information is used to authenticate authorized personnel, display public alerts and reports, coordinate incident response, and maintain the security and operation of the service.',
      '3. Access and Sharing. Information is available to authorized personnel according to their roles. Incident information may be shared with the relevant barangay or MDRRMO responders and other authorized public safety agencies when needed for response or required by law. The dashboard does not authorize unrelated disclosure or commercial use.',
      '4. Storage and Retention. Information is stored on municipal systems. Records should be retained and disposed of according to applicable government records and data protection requirements.',
      '5. Security. Use role-based access and reasonable device and account security practices. No electronic service can guarantee that data transmission or storage is completely risk-free. Report suspected loss, unauthorized access, or disclosure through your barangay’s established channels.',
      '6. Your Rights and Questions. Data subjects may exercise rights available under applicable privacy law, subject to its conditions and exceptions. For a privacy concern or request, contact the municipality or MDRRMO through its official channels, or contact the National Privacy Commission at privacy.gov.ph.',
    ],
  },
];

function messageOf(error: any, fallback: string) {
  return error?.response?.data?.error || fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export type BarangaySettingsSection = 'all' | 'account' | 'location' | 'hotlines' | 'terms' | 'privacy';

type BarangayAdministrationPageProps = { embedded?: boolean; section?: BarangaySettingsSection };

export default function BarangayAdministrationPage({ embedded = false, section = 'all' }: BarangayAdministrationPageProps) {
  const { user, updateUser } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManageHotlines = user?.role === 'admin' || user?.role === 'staff';
  const canViewHotlines = Boolean(user?.barangay_id);
  const active = Boolean(user?.coordination_verified);
  const [official, setOfficial] = useState({ official_name: '', official_position: '', position_designation: user?.position_designation || '' });
  const [verification, setVerification] = useState<Verification | null>(null);
  const [location, setLocation] = useState({ latitude: '', longitude: '', address: '' });
  const [hotlines, setHotlines] = useState<HotlineEntry[]>([]);
  const [editingHotlineIndex, setEditingHotlineIndex] = useState<number | null>(null);
  const [selectedHotlinePhones, setSelectedHotlinePhones] = useState<Record<number, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const tasks: Promise<any>[] = [];
      if (isAdmin) tasks.push(barangayAPI.accountRequest());
      if (active && isAdmin) tasks.push(reportAPI.barangayLocation());
      if (active && canViewHotlines && user?.barangay_id) {
        tasks.push(canManageHotlines ? barangayAPI.hotlineSettings() : barangayAPI.publishedHotlines(user.barangay_id));
      }
      const results = await Promise.all(tasks);
      let index = 0;
      if (isAdmin) {
        const response = results[index++];
        const record = response.data?.verification || null;
        setVerification(record);
        updateUser({
          coordination_verified: Boolean(response.data?.coordination_verified),
          verification_status: record?.status || user?.verification_status || 'pending_document',
        });
        setOfficial({
          official_name: record?.punong_barangay_name || '',
          official_position: record?.punong_barangay_position || '',
          position_designation: record?.position_designation || user?.position_designation || '',
        });
      }
      if (active && isAdmin) {
        const barangay = results[index++]?.data?.barangay;
        setLocation({
          latitude: barangay?.location_latitude == null ? '' : String(barangay.location_latitude),
          longitude: barangay?.location_longitude == null ? '' : String(barangay.location_longitude),
          address: barangay?.location_address || '',
        });
      }
      if (active && canViewHotlines) {
        const entries = results[index]?.data?.entries;
        setHotlines(Array.isArray(entries) ? entries.map((entry: any) => ({
          purpose: String(entry.purpose || ''),
          numbers: Array.isArray(entry.numbers) ? entry.numbers.map(String) : [''],
        })) : []);
      }
    } catch (loadError: any) {
      setError(messageOf(loadError, 'Barangay account settings could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [active, canManageHotlines, canViewHotlines, isAdmin, updateUser, user?.barangay_id, user?.position_designation, user?.verification_status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    socket.on('hotlines:updated', load);
    socket.on('command:locations_updated', load);
    socket.on('barangay:account_access_changed', load);
    socket.on('dispatcher:coordination_access_changed', load);
    return () => {
      socket.off('hotlines:updated', load);
      socket.off('command:locations_updated', load);
      socket.off('barangay:account_access_changed', load);
      socket.off('dispatcher:coordination_access_changed', load);
    };
  }, [load]);

  const status = String(verification?.status || user?.verification_status || 'pending_document').toLowerCase();
  const statusLabel = useMemo(() => status.replaceAll('_', ' '), [status]);
  const submittedDocumentUrl = verification?.document_url
    ? (/^https?:\/\//i.test(verification.document_url) ? verification.document_url : `${API_BASE.replace(/\/api\/?$/, '')}${verification.document_url}`)
    : null;

  const saveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    try {
      const { data } = await barangayAPI.saveAccountRequest(official);
      setVerification(data.verification || null);
      toast.success('Barangay Account Request details saved.');
    } catch (saveError: any) { toast.error(messageOf(saveError, 'Account request details could not be saved.')); }
    finally { setSaving(false); }
  };

  const downloadTemplate = async () => {
    try {
      const { data } = await barangayAPI.certificateTemplate(true);
      downloadBlob(data, `Barangay_Account_Request_${(user?.barangay_name || 'Barangay').replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    } catch (downloadError: any) { toast.error(messageOf(downloadError, 'The account request PDF could not be generated.')); }
  };

  const uploadCertificate = async (file?: File) => {
    if (!file) return;
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) { toast.error('Upload a signed PDF, PNG, or JPG file.'); return; }
    setSaving(true);
    try {
      const { data } = await barangayAPI.submitCertificate(file);
      setVerification(data.verification || verification);
      toast.success('Signed account request sent to MDRRMO for review.');
    } catch (uploadError: any) { toast.error(messageOf(uploadError, 'The signed document could not be uploaded.')); }
    finally { setSaving(false); }
  };

  const requestActivation = async () => {
    setSaving(true);
    try { const { data } = await barangayAPI.requestActivation(); setVerification(data.verification || verification); toast.success(data.message || 'Activation request sent.'); await load(); }
    catch (requestError: any) { toast.error(messageOf(requestError, 'Activation request could not be sent.')); }
    finally { setSaving(false); }
  };

  const resubmit = async () => {
    setSaving(true);
    try { const { data } = await barangayAPI.resubmitAccountRequest(); setVerification(data.verification || verification); toast.success(data.message || 'Resubmission started. Upload the corrected signed request.'); }
    catch (requestError: any) { toast.error(messageOf(requestError, 'The request could not be reopened for resubmission.')); }
    finally { setSaving(false); }
  };

  const saveLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    try {
      const latitude = Number(location.latitude); const longitude = Number(location.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { toast.error('Enter valid latitude and longitude values.'); return; }
      await reportAPI.saveBarangayLocation({ latitude, longitude, address: location.address.trim() || null });
      toast.success('Barangay command location saved.');
    } catch (saveError: any) { toast.error(messageOf(saveError, 'Barangay location could not be saved.')); }
    finally { setSaving(false); }
  };

  const saveHotlines = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true);
    const cleanEntries = hotlines.map((entry) => ({
      purpose: entry.purpose.trim(),
      numbers: entry.numbers.map((number) => number.trim()).filter(Boolean),
    }));
    if (cleanEntries.some((entry) => !entry.purpose || entry.numbers.length === 0)) {
      toast.error('Each hotline needs a purpose and at least one phone number.'); setSaving(false); return;
    }
    try { const { data } = await barangayAPI.saveHotlines(cleanEntries); setHotlines(data.entries || []); setEditingHotlineIndex(null); setSelectedHotlinePhones({}); toast.success('Barangay hotline directory saved.'); }
    catch (saveError: any) { toast.error(messageOf(saveError, 'Barangay hotlines could not be saved.')); }
    finally { setSaving(false); }
  };

  const updateHotline = (index: number, patch: Partial<HotlineEntry>) => setHotlines((entries) => entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry));
  const addHotline = () => {
    const nextIndex = hotlines.length;
    setHotlines((entries) => [...entries, { purpose: '', numbers: [''] }]);
    setEditingHotlineIndex(nextIndex);
  };
  const removeHotline = (index: number) => {
    setHotlines((entries) => entries.filter((_, entryIndex) => entryIndex !== index));
    setEditingHotlineIndex((current) => current === index ? null : current !== null && current > index ? current - 1 : current);
    setSelectedHotlinePhones((selected) => {
      const next: Record<number, number[]> = {};
      Object.entries(selected).forEach(([entryIndex, numbers]) => {
        const parsedIndex = Number(entryIndex);
        if (parsedIndex < index) next[parsedIndex] = numbers;
        if (parsedIndex > index) next[parsedIndex - 1] = numbers;
      });
      return next;
    });
  };
  const updateHotlinePhone = (index: number, phoneIndex: number, value: string) => setHotlines((entries) => entries.map((entry, entryIndex) => entryIndex === index
    ? { ...entry, numbers: entry.numbers.map((number, currentPhoneIndex) => currentPhoneIndex === phoneIndex ? value : number) }
    : entry));
  const removeHotlinePhone = (index: number, phoneIndex: number) => {
    setHotlines((entries) => entries.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, numbers: entry.numbers.filter((_, currentPhoneIndex) => currentPhoneIndex !== phoneIndex) }
      : entry));
    setSelectedHotlinePhones((selected) => ({ ...selected, [index]: [] }));
  };
  const toggleHotlinePhoneSelection = (index: number, phoneIndex: number) => setSelectedHotlinePhones((selected) => {
    const current = selected[index] || [];
    return { ...selected, [index]: current.includes(phoneIndex) ? current.filter((item) => item !== phoneIndex) : [...current, phoneIndex] };
  });
  const removeSelectedHotlinePhones = (index: number) => {
    const selected = selectedHotlinePhones[index] || [];
    if (!selected.length) return;
    setHotlines((entries) => entries.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, numbers: entry.numbers.filter((_, phoneIndex) => !selected.includes(phoneIndex)) }
      : entry));
    setSelectedHotlinePhones((current) => ({ ...current, [index]: [] }));
  };

  const showAll = section === 'all';
  const showAccount = showAll || section === 'account';
  const showLocation = showAll || section === 'location';
  const showHotlines = showAll || section === 'hotlines';
  const policies = barangayPolicies.filter((policy) => {
    if (showAll) return true;
    if (section === 'terms') return policy.title === 'Terms and Conditions';
    if (section === 'privacy') return policy.title === 'Privacy Policy';
    return false;
  });

  return (
    <div className={`barangay-console-page${embedded ? ' barangay-console-page-embedded' : ''}`}>
      {showAll && <header className="barangay-console-header"><div><span className="workspace-eyebrow">BARANGAY ADMINISTRATION · {user?.barangay_name || 'YOUR BARANGAY'}</span><h1>Barangay settings</h1><p>Manage coordination setup, official response location, and the hotline directory shared with residents.</p></div><button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}><FileCheck2 size={16} /> Refresh</button></header>}
      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}
      {!active && isAdmin && <div className="barangay-console-message"><ShieldAlert /><div><strong>Barangay coordination access: {statusLabel}</strong><p>Operational team, location, and hotline settings become available after MDRRMO activates this barangay. You can prepare or update the account request below.</p></div></div>}
      {loading && <p className="barangay-console-muted">Loading account settings…</p>}

      {showAccount && isAdmin && <section className="barangay-console-panel"><header><div><h2>Barangay Account Request</h2><p>Prepare the authorization, submit the signed document, and follow MDRRMO review.</p></div><span className={`barangay-console-status ${active ? 'active' : status}`}>{active ? 'Active' : statusLabel}</span></header>
        {verification?.reference_no && <div className="barangay-account-reference"><span>Request reference</span><strong>{verification.reference_no}</strong>{verification.submitted_at && <small>Submitted {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(verification.submitted_at))}</small>}</div>}
        {(verification?.rejection_reason || verification?.correction_reason) && <div className="barangay-account-review-note"><strong>MDRRMO feedback</strong><p>{verification.correction_reason || verification.rejection_reason}</p></div>}
        <form className="barangay-console-form-grid" onSubmit={(event) => void saveAccount(event)}>
          <label>Administrator designation<input maxLength={120} value={official.position_designation} onChange={(event) => setOfficial((value) => ({ ...value, position_designation: event.target.value }))} placeholder="e.g. Barangay Administrator" /></label>
          <label>Authorizing official name<input required minLength={2} maxLength={120} value={official.official_name} onChange={(event) => setOfficial((value) => ({ ...value, official_name: event.target.value }))} /></label>
          <label>Authorizing official position<input required minLength={2} maxLength={120} value={official.official_position} onChange={(event) => setOfficial((value) => ({ ...value, official_position: event.target.value }))} placeholder="Punong Barangay" /></label>
          <div className="barangay-console-form-actions"><button className="btn btn-primary" disabled={saving}><Save size={16} /> Save request details</button><button className="workspace-secondary-action" type="button" onClick={() => void downloadTemplate()}><Download size={16} /> Download authorization PDF</button></div>
        </form>
        {!active && <div className="barangay-account-upload"><FileText size={20} /><div><strong>Signed and sealed request</strong><p>Upload a PDF or clear image of the authorization document after it has been signed.</p>{submittedDocumentUrl && <a href={submittedDocumentUrl} target="_blank" rel="noreferrer">Open previously submitted document</a>}</div><label className="btn btn-outline">{saving ? 'Uploading…' : 'Upload signed document'}<input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" disabled={saving} onChange={(event) => { void uploadCertificate(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label></div>}
        {status === 'rejected' && <div className="barangay-account-actions"><p>After correcting the issues listed above, reopen the request and upload the revised signed document.</p><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void resubmit()}>Start resubmission</button></div>}
        {!active && status === 'verified' && <div className="barangay-account-actions"><p>This barangay was approved before and its access was later deactivated. Send MDRRMO a request to reactivate the existing account.</p><button className="btn btn-primary" type="button" disabled={saving} onClick={() => void requestActivation()}>Request activation</button></div>}
        {!active && status === 'activation_pending' && <div className="barangay-console-message"><BadgeCheck /><div><strong>Activation request is with MDRRMO</strong><p>Your barangay access will return after an administrator reviews this request.</p></div></div>}
        {Array.isArray(verification?.verification_history) && verification!.verification_history!.length > 0 && <div className="barangay-account-history"><h3>Review history</h3>{[...verification!.verification_history!].reverse().map((item, index) => <article key={`${item.timestamp || item.action}-${index}`}><span>{String(item.action || 'Update').replaceAll('_', ' ')}</span><p>{item.note || item.actor || 'Status updated'}</p><time>{item.timestamp ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.timestamp)) : ''}</time></article>)}</div>}
      </section>}

      {showLocation && isAdmin && active && <section className="barangay-console-panel"><header><div><h2>Barangay command location</h2><p>Used as the barangay operations location in command maps.</p></div></header><form className="barangay-console-form-grid" onSubmit={(event) => void saveLocation(event)}>
        <label>Latitude<input required type="number" min={-90} max={90} step="any" value={location.latitude} onChange={(event) => setLocation((value) => ({ ...value, latitude: event.target.value }))} /></label>
        <label>Longitude<input required type="number" min={-180} max={180} step="any" value={location.longitude} onChange={(event) => setLocation((value) => ({ ...value, longitude: event.target.value }))} /></label>
        <label className="barangay-console-form-wide">Address or landmark<input maxLength={240} value={location.address} onChange={(event) => setLocation((value) => ({ ...value, address: event.target.value }))} placeholder="Barangay hall or response post" /></label>
        <div className="barangay-console-form-actions"><button className="btn btn-primary" disabled={saving}><MapPin size={16} /> Save command location</button>{location.latitude && location.longitude && <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}>View coordinates on map</a>}</div>
      </form></section>}

      {showHotlines && active && canViewHotlines && <section className="barangay-console-panel"><header><div><h2>Public hotline directory</h2><p>{canManageHotlines ? 'These entries are shown to residents for your barangay.' : 'Published hotline numbers for your barangay.'}</p></div>{canManageHotlines && <button className="workspace-secondary-action" type="button" onClick={addHotline}><Plus size={16} /> Add hotline</button>}</header>
        {canManageHotlines ? <form onSubmit={(event) => void saveHotlines(event)}>
          {hotlines.length === 0 ? <p className="barangay-console-muted">No public hotline entries yet. Add one to make it available in the resident directory.</p> : <div className="barangay-hotline-list">{hotlines.map((entry, index) => {
            const isEditing = editingHotlineIndex === index;
            const selectedPhones = selectedHotlinePhones[index] || [];
            return <article className={`barangay-hotline-card${isEditing ? ' is-editing' : ''}`} key={`hotline-${index}`}>
              <div className="barangay-hotline-card-heading"><span className="barangay-hotline-card-icon"><Phone size={18} /></span><div><small>PUBLIC HOTLINE</small><h3>{entry.purpose || 'New hotline'}</h3></div></div>
              {isEditing ? <div className="barangay-hotline-editor">
                <label className="barangay-hotline-purpose">Purpose<input required maxLength={100} value={entry.purpose} onChange={(event) => updateHotline(index, { purpose: event.target.value })} placeholder="Emergency response" /></label>
                <div className="barangay-hotline-editor-label"><strong>Phone numbers</strong><span>Select numbers to remove several at once.</span></div>
                {entry.numbers.map((number, phoneIndex) => <div className="barangay-hotline-phone-row" key={phoneIndex}>
                  <input type="checkbox" checked={selectedPhones.includes(phoneIndex)} onChange={() => toggleHotlinePhoneSelection(index, phoneIndex)} aria-label={`Select phone number ${phoneIndex + 1} for removal`} />
                  <input type="tel" value={number} onChange={(event) => updateHotlinePhone(index, phoneIndex, event.target.value)} placeholder="09XXXXXXXXX" aria-label={`Phone number ${phoneIndex + 1}`} />
                  <button type="button" title="Remove phone number" aria-label={`Remove phone number ${phoneIndex + 1}`} onClick={() => removeHotlinePhone(index, phoneIndex)}><Trash2 size={16} /></button>
                </div>)}
                <div className="barangay-hotline-editor-actions"><button type="button" className="barangay-hotline-add-phone" onClick={() => updateHotline(index, { numbers: [...entry.numbers, ''] })}><Plus size={15} /> Add phone</button>{selectedPhones.length > 0 && <button type="button" className="barangay-hotline-remove-selected" onClick={() => removeSelectedHotlinePhones(index)}><Trash2 size={15} /> Remove selected ({selectedPhones.length})</button>}</div>
              </div> : <div className="barangay-hotline-card-phones"><span>Phone numbers</span>{entry.numbers.filter(Boolean).length > 0 ? <div>{entry.numbers.filter(Boolean).map((number, phoneIndex) => <a href={`tel:${number}`} key={`${number}-${phoneIndex}`}><Phone size={14} />{number}</a>)}</div> : <p>No phone numbers added.</p>}</div>}
              {canManageHotlines && <footer className="barangay-hotline-card-actions"><button type="button" onClick={() => { setEditingHotlineIndex(isEditing ? null : index); setSelectedHotlinePhones((selected) => ({ ...selected, [index]: [] })); }}>{isEditing ? <><Check size={15} /> Done</> : <><Edit3 size={15} /> Edit</>}</button><button type="button" className="danger" onClick={() => removeHotline(index)}><Trash2 size={15} /> Remove hotline</button></footer>}
            </article>;
          })}</div>}
          <div className="barangay-console-form-actions"><button className="btn btn-primary" disabled={saving || hotlines.length === 0}><Save size={16} /> {saving ? 'Saving…' : 'Save hotline directory'}</button></div>
        </form> : hotlines.length === 0 ? <p className="barangay-console-muted">No public hotline entries have been published for this barangay.</p> : <div className="barangay-hotline-list">{hotlines.map((entry, index) => <article className="barangay-hotline-card" key={`${entry.purpose}-${index}`}><div className="barangay-hotline-card-heading"><span className="barangay-hotline-card-icon"><Phone size={18} /></span><div><small>PUBLIC HOTLINE</small><h3>{entry.purpose || 'Emergency hotline'}</h3></div></div><div className="barangay-hotline-card-phones"><span>Phone numbers</span><div>{entry.numbers.filter(Boolean).map((number, phoneIndex) => <a key={`${number}-${phoneIndex}`} href={`tel:${number}`}><Phone size={14} />{number}</a>)}</div></div></article>)}</div>}
      </section>}

      {policies.length > 0 && <section className="barangay-console-panel">{showAll ? <><header><div><h2>Terms and privacy</h2><p>Review the policies shown in the mobile app.</p></div></header>
        {policies.map((policy) => <details key={policy.title} className="barangay-policy-details"><summary><strong>{policy.title}</strong><span>{policy.subtitle}</span></summary><div>{policy.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></details>)}
      </> : <><header><div><h2>{policies[0].title}</h2><p>{policies[0].subtitle}</p></div></header>
        <div className="barangay-policy-details-open">{policies[0].paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
      </>}</section>}
    </div>
  );
}
