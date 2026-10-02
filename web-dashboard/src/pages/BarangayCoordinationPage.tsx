import { useEffect, useState } from 'react';
import { Check, Download, FileCheck2, RefreshCw, UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';
import { barangayAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface CoordinationRecord {
  status?: string;
  document_url?: string | null;
  rejection_reason?: string | null;
  punong_barangay_name?: string | null;
  punong_barangay_position?: string | null;
  position_designation?: string | null;
  submitted_at?: string | null;
}

export default function BarangayCoordinationPage() {
  const { user } = useAuth();
  const [record, setRecord] = useState<CoordinationRecord | null>(null);
  const [configured, setConfigured] = useState(false);
  const [officialName, setOfficialName] = useState('');
  const [officialPosition, setOfficialPosition] = useState('');
  const [designation, setDesignation] = useState(user?.position_designation || '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const isBarangayAdmin = user?.role === 'admin';

  const loadRequest = async () => {
    setBusy(true);
    try {
      const [request, status] = await Promise.all([
        barangayAPI.coordinationRequest(),
        barangayAPI.coordinationStatus(),
      ]);
      const verification = request.data?.verification || status.data?.verification || null;
      setRecord(verification);
      setConfigured(request.data?.configured === true || Boolean(verification));
      setOfficialName(verification?.punong_barangay_name || '');
      setOfficialPosition(verification?.punong_barangay_position || '');
      setDesignation(verification?.position_designation || user?.position_designation || '');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not load the coordination request');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (isBarangayAdmin) void loadRequest(); }, [isBarangayAdmin]);

  const saveAuthorization = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await barangayAPI.submitCoordinationRequest({
        official_name: officialName.trim(),
        official_position: officialPosition.trim(),
        position_designation: designation.trim(),
      });
      setRecord(result.data.verification || null);
      setConfigured(true);
      toast.success('Authorization details saved');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not save authorization details');
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const response = await barangayAPI.authorizationPdf();
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Barangay_Account_Request.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not download the request PDF');
    } finally {
      setBusy(false);
    }
  };

  const uploadDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return toast.error('Choose the signed and sealed request file first');
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      const response = await barangayAPI.uploadCoordinationDocument(body);
      setRecord(response.data.verification || null);
      setFile(null);
      toast.success('Signed request sent to MDRRMO for review');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not submit the signed request');
    } finally {
      setBusy(false);
    }
  };

  const requestActivation = async () => {
    setBusy(true);
    try {
      await barangayAPI.requestCoordinationActivation({});
      toast.success('Activation request sent to MDRRMO');
      await loadRequest();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Could not request activation');
    } finally {
      setBusy(false);
    }
  };

  const status = record?.status || 'not_submitted';
  const approved = status === 'verified' && !user?.coordination_verified;
  const waiting = status === 'under_review' || status === 'activation_pending' || status === 'pending_verification';

  if (!isBarangayAdmin) {
    return <div className="page-content" style={{ maxWidth: 940, margin: '0 auto' }}>
      <div className="page-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div><div className="eyebrow">Barangay access</div><h1 className="page-title">Coordination Request</h1><p className="page-subtitle">The barangay administrator manages the coordination request for all accounts.</p></div>
      </div>
      <div className="card" style={{ padding: 22 }}><div className="card-title">Shared barangay access</div><p style={{ color: 'var(--text-muted)' }}>MDRRMO activates access for every account in {user?.barangay_name || 'your barangay'} after approving the administrator’s coordination request.</p><div className="status-badge" style={{ color: user?.coordination_verified ? '#34d399' : '#fbbf24' }}>{user?.coordination_verified ? 'Active' : 'Waiting for administrator coordination'}</div></div>
    </div>;
  }

  return (
    <div className="page-content" style={{ maxWidth: 940, margin: '0 auto' }}>
      <div className="page-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div>
          <div className="eyebrow">Barangay access</div>
          <h1 className="page-title">Coordination Request</h1>
          <p className="page-subtitle">MDRRMO activation controls access for every user in {user?.barangay_name || 'your barangay'}.</p>
        </div>
        <button className="btn btn-outline" onClick={loadRequest} disabled={busy}><RefreshCw size={16} /> Refresh status</button>
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', background: approved ? 'rgba(16,185,129,.14)' : 'rgba(14,165,233,.12)', color: approved ? '#34d399' : '#38bdf8' }}>
          {approved ? <Check size={22} /> : <FileCheck2 size={22} />}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{approved ? 'Previously approved — activation required' : waiting ? 'Request is under MDRRMO review' : 'Prepare the barangay coordination request'}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            {approved ? 'Ask MDRRMO to restore access for all active barangay accounts.' : waiting ? `Current status: ${status.replaceAll('_', ' ')}` : 'Complete the authorization details, sign the generated request, then submit it for review.'}
          </div>
        </div>
        {approved && <button className="btn btn-primary" onClick={requestActivation} disabled={busy}>Request activation</button>}
      </div>

      {!approved && !waiting && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
          <form className="card" onSubmit={saveAuthorization} style={{ padding: 22 }}>
            <div className="card-title">1. Authorization details</div>
            <label className="form-label" htmlFor="pb-name">Authorizing official</label>
            <input id="pb-name" className="form-input" value={officialName} onChange={(e) => setOfficialName(e.target.value)} required />
            <label className="form-label" htmlFor="pb-position" style={{ marginTop: 12 }}>Official position</label>
            <input id="pb-position" className="form-input" value={officialPosition} onChange={(e) => setOfficialPosition(e.target.value)} placeholder="Punong Barangay" required />
            <label className="form-label" htmlFor="admin-designation" style={{ marginTop: 12 }}>Your designation</label>
            <input id="admin-designation" className="form-input" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Barangay Administrator" />
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 18 }} disabled={busy}>Save details</button>
          </form>

          <div className="card" style={{ padding: 22 }}>
            <div className="card-title">2. Sign and submit</div>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, fontSize: 13 }}>Download the prefilled request, print and sign/seal it, then upload a photo or PDF of the signed copy.</p>
            <button className="btn btn-outline" style={{ width: '100%', margin: '8px 0 18px' }} onClick={downloadPdf} disabled={busy || !configured}><Download size={16} /> Download request PDF</button>
            <form onSubmit={uploadDocument}>
              <label className="form-label" htmlFor="coordination-file">Signed and sealed request</label>
              <input id="coordination-file" className="form-input" type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={busy || !configured || !file}><UploadCloud size={16} /> Submit for review</button>
            </form>
            {record?.rejection_reason && <div className="alert alert-danger" style={{ marginTop: 14 }}>{record.rejection_reason}</div>}
          </div>
        </div>
      )}

      {waiting && record?.document_url && <div className="card" style={{ padding: 22 }}><div className="card-title">Submitted request</div><a href={record.document_url} target="_blank" rel="noreferrer">Open signed request</a>{record.submitted_at && <div className="field-help" style={{ marginTop: 8 }}>Submitted {new Date(record.submitted_at).toLocaleString()}</div>}</div>}
    </div>
  );
}
