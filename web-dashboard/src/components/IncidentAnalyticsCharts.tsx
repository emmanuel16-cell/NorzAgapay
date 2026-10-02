import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type IncidentRow = {
  type?: unknown;
  incident_type?: unknown;
  severity?: unknown;
  category?: unknown;
  title?: unknown;
  status?: unknown;
  barangay_response_status?: unknown;
  mdrrmo_response_status?: unknown;
  barangay_name?: unknown;
  barangays?: unknown;
  created_at?: unknown;
};

const COLORS = ['#38bdf8', '#f97316', '#22c55e', '#eab308', '#a78bfa', '#fb7185', '#14b8a6', '#94a3b8'];
const readable = (value: unknown, fallback = 'Unknown') => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : fallback;
};
const countBy = (rows: IncidentRow[], getValue: (row: IncidentRow) => unknown) => {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const label = readable(getValue(row));
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};

function buildMonthlyTrend(rows: IncidentRow[]) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
  const keys = months.map((month) => `${month.getFullYear()}-${month.getMonth()}`);
  const counts = new Map<string, number>();
  keys.forEach((key) => counts.set(key, 0));
  rows.forEach((row) => {
    if (typeof row.created_at !== 'string') return;
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return months.map((month, index) => ({
    month: month.toLocaleDateString(undefined, { month: 'short' }),
    reports: counts.get(keys[index]) || 0,
  }));
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card" style={{ minWidth: 0, padding: 18 }}>
    <div className="card-title" style={{ marginBottom: 12 }}>{title}</div>
    {children}
  </section>;
}

export default function IncidentAnalyticsCharts({ incidents }: { incidents: IncidentRow[] }) {
  const trend = buildMonthlyTrend(incidents);
  const byType = countBy(incidents, (row) => row.incident_type ?? row.category ?? row.title ?? row.type).slice(0, 8);
  const bySeverity = countBy(incidents, (row) => row.severity);
  const byStatus = countBy(incidents, (row) => {
    const overall = typeof row.status === 'string' ? row.status.toLowerCase() : '';
    if (['escalated', 'resolved', 'closed', 'verified'].includes(overall)) return overall;
    const municipal = typeof row.mdrrmo_response_status === 'string' ? row.mdrrmo_response_status.toLowerCase() : '';
    if (municipal && municipal !== 'pending') return municipal;
    return row.barangay_response_status ?? row.status ?? row.mdrrmo_response_status;
  });
  const weekdayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekdayCounts = new Map<string, number>(weekdayLabels.map((day) => [day, 0]));
  incidents.forEach((row) => {
    if (typeof row.created_at !== 'string') return;
    const date = new Date(row.created_at);
    if (!Number.isNaN(date.getTime())) {
      const day = weekdayLabels[date.getDay()];
      weekdayCounts.set(day, (weekdayCounts.get(day) || 0) + 1);
    }
  });
  const byWeekday = weekdayLabels.map((name) => ({ name: name.slice(0, 3), count: weekdayCounts.get(name) || 0 }));
  const byBarangay = countBy(incidents, (row) => {
    const relation = row.barangays;
    const relatedName = relation && typeof relation === 'object' && 'name' in relation
      ? (relation as { name?: unknown }).name
      : undefined;
    return row.barangay_name ?? relatedName;
  }).slice(0, 10);
  const axisStyle = { fill: 'var(--text-secondary)', fontSize: 11 };
  const gridColor = 'var(--border-color)';
  const tooltipStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    color: 'var(--text-primary)',
  };
  const empty = <div className="empty-state" style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}><p>No incident data available for this chart yet.</p></div>;

  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 16 }}>
    <ChartCard title="Incident reports · Last 6 months">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={trend} margin={{ top: 8, right: 14, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="4 4" />
          <XAxis dataKey="month" tick={axisStyle} />
          <YAxis allowDecimals={false} tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="reports" name="Reports" stroke="#38bdf8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>

    <ChartCard title="Reports by incident type">
      {byType.length ? <ResponsiveContainer width="100%" height={250}>
        <BarChart data={byType} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={axisStyle} />
          <YAxis type="category" dataKey="name" width={112} tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" name="Reports" fill="#14b8a6" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer> : empty}
    </ChartCard>

    <ChartCard title="Reports by severity">
      {bySeverity.length ? <ResponsiveContainer width="100%" height={250}>
        <BarChart data={bySeverity} margin={{ top: 8, right: 14, left: -18, bottom: 4 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="4 4" />
          <XAxis dataKey="name" tick={axisStyle} />
          <YAxis allowDecimals={false} tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" name="Reports" fill="#f97316" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer> : empty}
    </ChartCard>

    <ChartCard title="Reports by response status">
      {byStatus.length ? <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={byStatus} dataKey="count" nameKey="name" cx="50%" cy="46%" outerRadius={78} label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}>
            {byStatus.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
        </PieChart>
      </ResponsiveContainer> : empty}
    </ChartCard>

    <ChartCard title="Reports by day of week">
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={byWeekday} margin={{ top: 8, right: 14, left: -18, bottom: 4 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="4 4" />
          <XAxis dataKey="name" tick={axisStyle} />
          <YAxis allowDecimals={false} tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" name="Reports" fill="#a78bfa" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
    {byBarangay.length > 1 && <ChartCard title="Reports by barangay">
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={byBarangay} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={axisStyle} />
          <YAxis type="category" dataKey="name" width={112} tick={axisStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" name="Reports" fill="#38bdf8" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>}
  </div>;
}
