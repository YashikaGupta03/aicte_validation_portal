import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';

export default function CollegeDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    api('/api/applications/dashboard').then(setData).catch((err) => setError(err.message));
  }, []);

  return (
    <main className="page">
      <header className="r page-head">
        <h1>College dashboard</h1>
        <div className="r row-wrap" style={{ gap: 12 }}>
          <Link className="btn" to="/new-application">New application</Link>
          <button className="btn bo" onClick={() => { setToken(null); navigate('/'); }}>Sign out</button>
        </div>
      </header>
      {error && <p role="alert" className="wn">{error}</p>}
      {!data && !error && <p className="t">Loading applications…</p>}
      {data && <>
        <section className="g grid-4" style={{ margin: '24px 0' }}>
          {Object.entries({ Drafts: data.stats.drafts, 'In validation': data.stats.inValidation, 'More information requested': data.stats.infoRequested, Approved: data.stats.approved }).map(([label, value]) =>
            <article className="c" key={label}><p className="k">{label}</p><p className="n">{value}</p></article>)}
        </section>
        <section className="c">
          <h2>My applications</h2>
          {data.applications.length === 0 ? <p className="t">No applications yet. Start by creating a draft.</p> :
            <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Application</th><th>Category</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>{data.applications.map((app) => <tr key={app.id}><td>{app.code || 'Draft'}</td><td>{app.category}</td><td>{app.statusLabel}</td><td>{app.savedAt ? new Date(app.savedAt).toLocaleString() : '—'}</td></tr>)}</tbody>
            </table></div>}
        </section>
        {data.checklistProgress && <p className="t">Current checklist: {data.checklistProgress.requiredUploaded} of {data.checklistProgress.requiredTotal} required documents uploaded ({data.checklistProgress.percent}%).</p>}
        {data.notifications?.length > 0 && <section className="c"><h2>Notifications</h2>{data.notifications.map((item) => <p key={item._id}><b>{item.title}</b> — {item.body}</p>)}</section>}
      </>}
    </main>
  );
}
