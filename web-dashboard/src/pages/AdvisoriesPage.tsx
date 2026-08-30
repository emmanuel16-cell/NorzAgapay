import { useEffect, useState } from 'react';
import { weatherAPI } from '../lib/api';

const getLevelColor = (level: string) => {
  switch (level) {
    case 'critical': return 'var(--severity-critical)';
    case 'warning': return 'var(--severity-high)';
    default: return 'var(--severity-low)';
  }
};

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'weather': return '🌤️';
    case 'flood': return '🌊';
    case 'earthquake': return '🌋';
    case 'dam': return '🏗️';
    default: return '⚠️';
  }
};

export default function AdvisoriesPage() {
  const [advisories, setAdvisories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAdvisories = async () => {
    try {
      const response = await weatherAPI.getAdvisories();
      if (response.data.success) {
        setAdvisories(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching advisories:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdvisories();
    const interval = setInterval(fetchAdvisories, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  // Sort advisories: critical first, then warning, then normal, and filter out river/dam level alerts
  const sortedAdvisories = [...advisories]
    .filter(advisory => !advisory.title?.includes('River Level Alert') && !advisory.title?.includes('Dam Level Alert'))
    .sort((a, b) => {
      const priority = { critical: 0, warning: 1, normal: 2 };
      return (priority[a.level as keyof typeof priority] || 2) - (priority[b.level as keyof typeof priority] || 2);
    });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Weather Advisories</h1>
      </div>

      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
          {sortedAdvisories.map((advisory) => (
            <div
              key={advisory.id}
              className="card"
              style={{ borderLeft: `4px solid ${getLevelColor(advisory.level)}` }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: '36px' }}>{getTypeIcon(advisory.type)}</div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '18px', color: 'var(--text-primary)' }}>{advisory.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {advisory.source} • {new Date(advisory.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <span className="badge" style={{ backgroundColor: `${getLevelColor(advisory.level)}20`, color: getLevelColor(advisory.level), border: `1px solid ${getLevelColor(advisory.level)}30` }}>
                  {advisory.level}
                </span>
              </div>

              <div style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                {advisory.message}
              </div>

              {advisory.expires_at && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Expires: {new Date(advisory.expires_at).toLocaleString()}
                </div>
              )}
            </div>
          ))}
        </div>

        {sortedAdvisories.length === 0 && (
          <div className="empty-state">
            <p style={{ color: 'var(--text-muted)' }}>No advisories at this time</p>
          </div>
        )}
      </div>
    </div>
  );
}
