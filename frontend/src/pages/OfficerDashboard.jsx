import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, setToken } from '../api.js';
import StatusBadge, { COLORS } from '../components/StatusBadge.jsx';
import EvidenceViewer from '../components/EvidenceViewer.jsx';

function Chart({ title, data }) {
  return (
    <article className="c">
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>{title}</h3>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
              {data.map((d) => <Cell key={d.key} fill={COLORS[d.key] || '#1d4ed8'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

const label = (k) => k.replace(/_/g, ' ');

export default function OfficerDashboard() {
  const [stage, setStage] = useState('all');
  const [queue, setQueue] = useState(null);
  const [stats, setStats] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null); // { docId, page, flagId }
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
    try {
      const data = await api(`/api/officer/applications/${id}/report`);
      setReport(data);
      setView((v) => (v && data.documents.some((d) => d.id === v.docId) ? v : null));
    }
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

  function showEvidence(flag) {
    const doc = report.documents.find((d) => d.id === flag.document)
      || report.documents.find((d) => d.filename === flag.evidence?.document);
    if (!doc) return;
    setView({ docId: doc.id, page: flag.evidence?.page || 1, flagId: flag._id });
    setTimeout(() => document.getElementById('evidence-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function decide(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await act(`/api/officer/applications/${report.application.id}/decision`, {
      outcome: fields.get('outcome'), reason: fields.get('reason'),
    });
  }

  return (
    <main className="page">
      <header className="r page-head">
        <h1>Officer review queue</h1>
        <button className="btn bo" onClick={() => { setToken(null); navigate('/'); }}>Sign out</button>
      </header>
      {error && <p role="alert" className="wn">{error}</p>}
      {stats && <section className="g grid-3" style={{ margin: '16px 0' }}>
        <article className="c">Ready for review: <b>{stats.readyForReview}</b></article>
        <article className="c">In progress: <b>{stats.inProgress.total}</b></article>
        <article className="c">Open high-severity flags: <b>{stats.openHighFlags.count}</b></article>
      </section>}
      {stats && <section className="g grid-2" style={{ marginBottom: 16 }}>
        <Chart title="Open flags by severity" data={Object.entries(stats.openFlagsBySeverity).map(([key, value]) => ({ key, label: label(key), value }))} />
        <Chart title="Verification status (most urgent per application)" data={Object.entries(stats.verificationByApplication).map(([key, value]) => ({ key, label: label(key), value }))} />
      </section>}
      <section className="c">
        <div className="r row-wrap" style={{ gap: 8, marginBottom: 12 }}>
          {[['all', 'All'], ['needs_review', 'Needs review'], ['in_progress', 'In progress'], ['decided', 'Decided']].map(([key, label]) =>
            <button key={key} className="btn bo" onClick={() => setStage(key)}>{label} {queue?.tabs?.[key] ?? ''}</button>)}
        </div>
        {!queue && !error && <p>Loading queue…</p>}
        {queue && <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Application</th><th>Institution</th><th>Status</th><th>Flags</th><th /></tr></thead>
          <tbody>{queue.rows.map((row) => <tr key={row.id}><td>{row.code || row.id}</td><td>{row.institution}</td><td>{row.stageLabel}</td><td>{row.flags.high} high, {row.flags.medium} medium, {row.flags.low} low</td><td><button className="btn bo" onClick={() => openReport(row.id)}>Open report</button></td></tr>)}</tbody>
        </table></div>}
      </section>
      {report && <section className="c" style={{ marginTop: 20 }}>
        <div className="r page-head">
          <div><h2>{report.application.code} — {report.application.form.institutionName}</h2><p>{report.application.stageLabel} · {report.application.category}</p></div>
          <button className="btn bo" onClick={() => setReport(null)}>Close</button>
        </div>
        <h3>Documents and verification</h3>
        {report.documents.map((doc) => {
          const vers = report.verifications.filter((v) => v.document === doc.id);
          const infra = report.infrastructure.filter((i) => i.document === doc.id);
          return <div key={doc.id} style={{ borderTop: '1px solid #e2e8f0', padding: '10px 0' }}>
            <div className="r" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{doc.filename}</b> <span className="t">({doc.kind}: {doc.key})</span>
              {vers.map((v) => <StatusBadge key={v._id} value={v.status} />)}
              {vers.length === 0 && doc.kind !== 'infrastructure' && <span className="p sl">Not verified</span>}
              <button className="btn bo" style={{ marginLeft: 'auto', padding: '6px 12px' }} onClick={() => setView({ docId: doc.id, page: 1, flagId: null })}>View document</button>
            </div>
            {vers.map((v) => <p key={v._id} className="t" style={{ marginTop: 4 }}>
              Source: {v.source || 'n/a'} · Checked {v.checkedAt ? new Date(v.checkedAt).toLocaleString() : 'n/a'}
              {v.details?.reason ? ` · ${v.details.reason}` : ''}
            </p>)}
            {infra.map((i) => <div key={i._id} className="r" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <StatusBadge value={i.result} />
              <span><b>{i.requirement || i.requirementKey}</b> — <span className="t">{i.visible || 'Nothing identified'}</span></span>
              {typeof i.confidence === 'number' && <span className="t">{Math.round(i.confidence * 100)}% confidence</span>}
            </div>)}
          </div>;
        })}
        {view && (() => {
          const doc = report.documents.find((d) => d.id === view.docId);
          if (!doc) return null;
          const highlights = report.flags
            .filter((f) => f.document === doc.id || f.evidence?.document === doc.filename)
            .map((f) => ({ id: f._id, page: f.evidence?.page, bbox: f.evidence?.bbox, severity: f.severity, label: `${f.severity} · ${f.type}` }));
          return <div id="evidence-viewer" style={{ marginTop: 16 }}>
            <div className="r" style={{ justifyContent: 'space-between' }}>
              <h3>Evidence</h3>
              <button className="btn bo" onClick={() => setView(null)}>Hide</button>
            </div>
            <EvidenceViewer doc={doc} highlights={highlights} activeId={view.flagId} page={view.page} onPage={(p) => setView({ ...view, page: p })} />
          </div>;
        })()}
        <h3>Flags</h3>
        {report.flags.length === 0 && <p>No flags for this analysis.</p>}
        {report.flags.map((flag) => <div key={flag._id} style={{ borderTop: '1px solid #e2e8f0', padding: 12 }}>
          <StatusBadge value={flag.severity} /> <b>{flag.type}</b> — {flag.reason}
          {(flag.document || flag.evidence?.document) && <button className="btn bo" style={{ marginLeft: 8, padding: '4px 10px' }} onClick={() => showEvidence(flag)}>
            {Array.isArray(flag.evidence?.bbox) ? `Show on document (p. ${flag.evidence.page || 1})` : 'Open document'}
          </button>}
          <p>Status: {flag.review.status}{flag.review.note ? ` — ${flag.review.note}` : ''}</p>
          {flag.review.status === 'open' && <div className="r row-wrap" style={{ gap: 8 }}>
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
