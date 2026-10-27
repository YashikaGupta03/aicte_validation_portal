import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { api, setToken } from '../api.js';

const PALETTE = ['#1d4ed8', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];
const count = (items, key) => Object.entries(items.reduce((acc, i) => ((acc[i[key]] = (acc[i[key]] || 0) + 1), acc), {})).map(([name, value]) => ({ name, value }));

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [sources, setSources] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const [overviewData, userData, sourceData, auditData] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/users'),
      api('/api/admin/sources'),
      api('/api/admin/audit?limit=20'),
    ]);
    setOverview(overviewData);
    setUsers(userData);
    setSources(sourceData);
    setAudit(auditData.items);
  }, []);

  useEffect(() => { refresh().catch((err) => setError(err.message)); }, [refresh]);

  async function approve(id) {
    try {
      await api(`/api/admin/users/${id}/approve`, { method: 'POST', body: {} });
      await refresh();
    } catch (err) { setError(err.message); }
  }

  async function toggleSource(source) {
    try {
      await api(`/api/admin/sources/${source.key}`, { method: 'PATCH', body: { available: !source.available } });
      await refresh();
    } catch (err) { setError(err.message); }
  }

  return (
    <main style={{ padding: 32 }}>
      <header className="r" style={{ justifyContent: 'space-between' }}>
        <div><h1>Administration</h1><p className="t">Live account, service and audit information.</p></div>
        <button className="btn bo" onClick={() => { setToken(null); navigate('/'); }}>Sign out</button>
      </header>
      {error && <p role="alert" className="wn">{error}</p>}
      {!overview && !error && <p>Loading administration data…</p>}
      {overview && <>
        <section className="g" style={{ gridTemplateColumns: 'repeat(4, 1fr)', margin: '16px 0' }}>
          <article className="c">Active users <b>{overview.activeUsers}</b></article>
          <article className="c">Pending sign-ups <b>{overview.pendingSignups}</b></article>
          <article className="c">Jobs in queue <b>{overview.jobsInQueue}</b></article>
          <article className="c">Sources reachable <b>{overview.sourcesReachable.reachable}/{overview.sourcesReachable.total}</b></article>
        </section>
        <section className="g" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
          <article className="c"><h3 style={{ fontSize: 14 }}>Users by role</h3>
            <div style={{ height: 200 }}><ResponsiveContainer width="100%" height="100%">
              <PieChart><Pie data={count(users, 'role')} dataKey="value" nameKey="name" outerRadius={70} label>
                {count(users, 'role').map((d, i) => <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie><Tooltip /><Legend /></PieChart>
            </ResponsiveContainer></div></article>
          <article className="c"><h3 style={{ fontSize: 14 }}>Users by status</h3>
            <div style={{ height: 200 }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={count(users, 'status')} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip />
                <Bar dataKey="value" name="Users" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer></div></article>
          <article className="c"><h3 style={{ fontSize: 14 }}>Recent audit events by action</h3>
            <div style={{ height: 200 }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={count(audit, 'action')} layout="vertical" margin={{ top: 8, right: 8, left: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} /><Tooltip />
                <Bar dataKey="value" name="Events" fill="#0891b2" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer></div></article>
        </section>
        <section className="c">
          <h2>Users</h2>
          <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Name</th><th>Email</th><th>Institution</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>{user.institution}</td><td>{user.role}</td><td>{user.status}</td><td>{user.status === 'pending' && <button className="btn" onClick={() => approve(user.id)}>Approve</button>}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section className="c" style={{ marginTop: 16 }}>
          <h2>Services and verification sources</h2>
          <p>AI service: {overview.health.aiService} · Job queue: {overview.health.jobQueue}</p>
          {sources.map((source) => <p key={source.key} className="r" style={{ justifyContent: 'space-between' }}>
            <span>{source.name}: {source.available ? 'Enabled' : 'Disabled'} ({source.records} records)</span>
            <button className="btn bo" onClick={() => toggleSource(source)}>{source.available ? 'Disable' : 'Enable'}</button>
          </p>)}
        </section>
        <section className="c" style={{ marginTop: 16 }}>
          <h2>Recent audit events</h2>
          {audit.map((entry) => <p key={entry._id}>{new Date(entry.createdAt).toLocaleString()} · {entry.action} · {entry.entityType}</p>)}
        </section>
      </>}
    </main>
  );
}
