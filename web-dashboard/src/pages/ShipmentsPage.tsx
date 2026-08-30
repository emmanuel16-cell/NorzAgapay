import { useEffect, useState } from 'react';
import { inventoryAPI } from '../lib/api';
import toast from 'react-hot-toast';

interface Shipment {
  id: string; quantity_sent: number; origin: string; destination: string;
  qr_code: string; status: string; created_at: string; delivered_at?: string;
  inventory?: { item_name: string; unit: string; };
  driver?: { full_name: string; latitude?: number; longitude?: number; };
}

const statusColors: Record<string,string> = { loading:'badge-pending', in_transit:'badge-open', delivered:'badge-resolved' };

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const fetchShipments = () => {
    setLoading(true);
    inventoryAPI.shipments(filter ? { status: filter } : undefined)
      .then(r => setShipments(r.data.shipments || []))
      .catch(() => toast.error('Failed to load shipments'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchShipments(); }, [filter]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Shipment Tracker</h1>
        <select className="form-select" style={{width:'auto'}} value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="">All</option>
          <option value="loading">Loading</option>
          <option value="in_transit">In Transit</option>
          <option value="delivered">Delivered</option>
        </select>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-overlay"><div className="spinner"/></div>
        ) : shipments.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">🚚</div><p>No shipments found</p></div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:'16px'}}>
            {shipments.map(s => (
              <div key={s.id} className="card">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
                  <span style={{fontWeight:700,fontSize:'15px'}}>{s.inventory?.item_name || 'Unknown Item'}</span>
                  <span className={`badge ${statusColors[s.status]}`}>{s.status.replace('_',' ')}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',fontSize:'13px',color:'var(--text-secondary)'}}>
                  <div><span style={{color:'var(--text-muted)'}}>Qty:</span> {s.quantity_sent} {s.inventory?.unit}</div>
                  <div><span style={{color:'var(--text-muted)'}}>Driver:</span> {s.driver?.full_name || 'Unassigned'}</div>
                  <div><span style={{color:'var(--text-muted)'}}>From:</span> {s.origin}</div>
                  <div><span style={{color:'var(--text-muted)'}}>To:</span> {s.destination}</div>
                </div>
                {s.delivered_at && (
                  <div style={{fontSize:'12px',color:'var(--success)',marginTop:'8px'}}>
                    ✅ Delivered: {new Date(s.delivered_at).toLocaleString()}
                  </div>
                )}
                <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'8px',fontFamily:'monospace'}}>
                  QR: {s.qr_code.slice(0,30)}...
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
