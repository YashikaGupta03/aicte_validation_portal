import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';

export default function OfficerDashboard() {
  const [stage, setStage] = useState('all');
  const [queue, setQueue] = useState(null);
  const [stats, setStats] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const [queueData, statsData] = await Promise.all([
      api(`/api/officer/queue${stage === 'all' ? '' : `?stage=${stage}`}`),
      api('/api/officer/stats'),
    ]);
    setQueue(queueData);
    setStats(statsData);
  }, [stage]);

  useEffect(() => { refresh().catch((err) => setError(err.message)); }, [refresh]);

  async function openReport(id) {
    setError('');
    try { setReport(await api(`/api/officer/applications/${id}/report`)); }
    catch (err) { setError(err.message); }
  }

  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      await api(path, { method: path.includes('/flags/') ? 'PATCH' : 'POST', body });
      if (report) await openReport(report.application.id);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function decide(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await act(`/api/officer/applications/${report.application.id}/decision`, {
      outcome: fields.get('outcome'), reason: fields.get('reason'),
    });
  }

  return (
    <main style={{ padding: 32 }}>
      <header className="r" style={{ justifyContent: 'space-between' }}>
        <h1>Officer review queue</h1>
        <button className="btn bo" onClick={() => { setToken(null); navigate('/'); }}>Sign out</button>
      </header>
      {error && <p role="alert" className="wn">{error}</p>}
      {stats && <section className="g" style={{ gridTemplateColumns: 'repeat(3, 1fr)', margin: '16px 0' }}>
        <article className="c">Ready for review: <b>{stats.readyForReview}</b></article>
        <article className="c">In progress: <b>{stats.inProgress.total}</b></article>
        <article className="c">Open high-severity flags: <b>{stats.openHighFlags.count}</b></article>
      </section>}
      <section className="c">
        <div className="r" style={{ gap: 8, marginBottom: 12 }}>
          {[['all', 'All'], ['needs_review', 'Needs review'], ['in_progress', 'In progress'], ['decided', 'Decided']].map(([key, label]) =>
            <button key={key} className="btn bo" onClick={() => setStage(key)}>{label} {queue?.tabs?.[key] ?? ''}</button>)}
        </div>
        {!queue && !error && <p>Loading queue…</p>}
        {queue && <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Application</th><th>Institution</th><th>Status</th><th>Flags</th><th /></tr></thead>
          <tbody>{queue.rows.map((row) => <tr key={row.id}><td>{row.code || row.id}</td><td>{row.institution}</td><td>{row.stageLabel}</td><td>{row.flags.high} high, {row.flags.medium} medium, {row.flags.low} low</td><td><button className="btn bo" onClick={() => openReport(row.id)}>Open report</button></td></tr>)}</tbody>
        </table></div>}
      </section>
      {report && <section className="c" style={{ marginTop: 20 }}>
        <div className="r" style={{ justifyContent: 'space-between' }}>
          <div><h2>{report.application.code} — {report.application.form.institutionName}</h2><p>{report.application.stageLabel} · {report.application.category}</p></div>
          <button className="btn bo" onClick={() => setReport(null)}>Close</button>
        </div>
        <h3>Documents</h3>
        {report.documents.map((doc) => <p key={doc.id}>{doc.filename} ({doc.kind}: {doc.key})</p>)}
        <h3>Flags</h3>
        {report.flags.length === 0 && <p>No flags for this analysis.</p>}
        {report.flags.map((flag) => <div key={flag._id} style={{ borderTop: '1px solid #e2e8f0', padding: 12 }}>
          <b>{flag.severity.toUpperCase()} · {flag.type}</b> — {flag.reason}
          <p>Status: {flag.review.status}{flag.review.note ? ` — ${flag.review.note}` : ''}</p>
          {flag.review.status === 'open' && <div className="r" style={{ gap: 8 }}>
            {['acknowledged', 'resolved', 'dismissed'].map((status) => <button key={status} disabled={busy} className="btn bo" onClick={() => {
              const note = status === 'dismissed' ? window.prompt('Reason for dismissing this flag (required):') : '';
              if (status !== 'dismissed' || note?.trim()) act(`/api/officer/flags/${flag._id}`, { status, note });
            }}>{status}</button>)}
          </div>}
        </div>)}
        {['ready_for_review', 'under_review'].includes(report.application.status) && <>
          {report.application.status === 'ready_for_review' && <button disabled={busy} className="btn" onClick={() => act(`/api/officer/applications/${report.application.id}/start-review`, {})}>Start review</button>}
          <form onSubmit={decide} style={{ marginTop: 16 }}>
            <label className="t">Decision
              <select className="in" name="outcome"><option value="approve">Approve</option><option value="reject">Reject</option><option value="request_info">Request more information</option></select>
            </label>
            <label className="t">Reason (at least 10 characters)<textarea required minLength={10} className="in" name="reason" /></label>
            <button disabled={busy || !report.allFlagsReviewed} className="btn" type="submit">Record decision</button>
            {!report.allFlagsReviewed && <p className="t">Review every flag before recording a decision.</p>}
          </form>
        </>}
      </section>}
    </main>
  );
}
