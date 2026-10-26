import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [officerRequests, setOfficerRequests] = useState([]);
  const [sources, setSources] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState('');
  const [reviewingRequest, setReviewingRequest] = useState('');
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const [overviewData, userData, officerRequestData, sourceData, auditData] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/users'),
      api('/api/admin/officer-verification-requests'),
      api('/api/admin/sources'),
      api('/api/admin/audit?limit=20'),
    ]);
    setOverview(overviewData);
    setUsers(userData);
    setOfficerRequests(officerRequestData);
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

  async function reviewOfficerRequest(id, decision) {
    setReviewingRequest(id);
    setError('');
    try {
      await api(`/api/admin/officer-verification-requests/${id}/${decision}`, { method: 'POST', body: {} });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewingRequest('');
    }
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
        <section className="c" style={{ marginBottom: 16 }}>
          <h2>AICTE officer verification requests</h2>
          <p className="t" style={{ margin: '6px 0 14px' }}>Review each officer signup request before granting access to the officer dashboard.</p>
          {officerRequests.length === 0
            ? <p className="t">There are no officer verification requests waiting for review.</p>
            : <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Name</th><th>Email</th><th>Institution</th><th>Requested</th><th>Action</th></tr></thead>
              <tbody>{officerRequests.map((request) => <tr key={request.id}>
                <td>{request.name}</td>
                <td>{request.email}</td>
                <td>{request.institution}</td>
                <td>{new Date(request.createdAt).toLocaleString()}</td>
                <td>
                  <div className="r" style={{ gap: 8 }}>
                    <button className="btn" disabled={reviewingRequest === request.id} onClick={() => reviewOfficerRequest(request.id, 'approve')}>Approve</button>
                    <button className="btn bo" disabled={reviewingRequest === request.id} onClick={() => reviewOfficerRequest(request.id, 'reject')}>Disapprove</button>
                  </div>
                </td>
              </tr>)}</tbody>
            </table></div>}
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
