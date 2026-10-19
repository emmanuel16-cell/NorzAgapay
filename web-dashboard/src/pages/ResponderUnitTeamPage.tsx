import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, Users } from 'lucide-react';
import { respondUnitAPI } from '../lib/api';
import { formatMobileNumber } from '../lib/mobileNumber';

type UnitMember = {
  id: string;
  unit_member_id?: string;
  name?: string;
  member_role?: string;
  role_label?: string;
  phone?: string | null;
  is_active?: boolean;
};

type RespondUnit = {
  unit_name?: string;
  unit_type?: string;
  is_active?: boolean;
  can_dispatch?: boolean;
};

export default function ResponderUnitTeamPage() {
  const [unit, setUnit] = useState<RespondUnit | null>(null);
  const [members, setMembers] = useState<UnitMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await respondUnitAPI.myUnit();
      setUnit(data?.unit || null);
      setMembers(Array.isArray(data?.members) ? data.members.filter((member: UnitMember) => member.is_active !== false && member.member_role !== 'unassigned') : []);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || 'Your MDRRMO response unit could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="barangay-console-page">
      <header className="barangay-console-header">
        <div>
          <span className="workspace-eyebrow">MDRRMO FIELD RESPONSE</span>
          <h1>Response unit</h1>
          <p>View your municipal response unit and the crew assigned to it.</p>
        </div>
        <div className="barangay-console-header-actions">
          <button className="workspace-secondary-action" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'workspace-spinning' : ''} /> Refresh
          </button>
        </div>
      </header>

      {error && <div className="workspace-message workspace-message-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}

      <section className="barangay-console-stat-grid barangay-console-stat-grid-compact" aria-label="Response unit summary">
        <article><span>Response unit</span><strong>{unit?.unit_name || 'Not assigned'}</strong><Users size={20} /></article>
        <article><span>Active crew</span><strong>{members.length}</strong><Users size={20} /></article>
        <article><span>Deployment status</span><strong>{unit?.can_dispatch ? 'Ready' : unit?.is_active ? 'Standby' : 'Not active'}</strong><ShieldAlert size={20} /></article>
      </section>

      <section className="barangay-console-panel">
        <header><div><h2><Users size={19} /> {unit?.unit_name || 'Unit roster'}</h2><p>{unit?.unit_type ? `${unit.unit_type.replaceAll('_', ' ')} · ` : ''}Crew assigned to your responder account.</p></div></header>
        {loading ? <p className="barangay-console-muted">Loading your unit roster…</p> : members.length === 0 ? (
          <div className="barangay-console-empty"><ShieldAlert size={24} /><strong>No unit roster available</strong><span>Ask MDRRMO logistics staff to assign your responder account to a response unit.</span></div>
        ) : <div className="barangay-team-grid">
          {members.map((member) => {
            const name = member.name || 'Unit member';
            const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
            return <article className="barangay-team-card" key={member.unit_member_id || member.id}>
              <div className="barangay-team-card-avatar">{initials}</div>
              <div className="barangay-team-card-info">
                <strong>{name}</strong>
                <span className="barangay-console-status active">{member.role_label || member.member_role?.replaceAll('_', ' ') || 'Responder'}</span>
                <small>{member.phone ? formatMobileNumber(member.phone) : 'MDRRMO response crew'}</small>
              </div>
            </article>;
          })}
        </div>}
      </section>
    </div>
  );
}
