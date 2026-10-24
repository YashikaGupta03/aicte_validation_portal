import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const blankForm = { institutionName: '', academicYear: '', address: '', proposedIntake: '', previousApprovalRef: '' };

export default function NewApplication() {
  const [application, setApplication] = useState(null);
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/applications', { method: 'POST', body: { category: 'Extension of Approval' } })
      .then((draft) => {
        setApplication(draft);
        setForm({ ...blankForm, ...draft.form });
        return api(`/api/applications/${draft.id}`);
      })
      .then(setApplication)
      .catch((err) => setError(err.message));
  }, []);

  async function save() {
    if (!application) return;
    const saved = await api(`/api/applications/${application.id}`, {
      method: 'PATCH',
      body: { form: { ...form, proposedIntake: form.proposedIntake === '' ? undefined : Number(form.proposedIntake) } },
    });
    setApplication((current) => ({ ...current, ...saved }));
  }

  async function upload(kind, key, file) {
    if (!file || !application) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/applications/${application.id}/${kind}/${key}`, { method: 'PUT', file });
      setApplication(await api(`/api/applications/${application.id}`));
      setMessage(`${file.name} uploaded.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    setError('');
    try {
      await save();
      setMessage('Draft saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await save();
      const result = await api(`/api/applications/${application.id}/submit`, { method: 'POST', body: {} });
      setMessage(`Application ${result.code} submitted. Automated checks have been queued.`);
      setApplication(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, padding: 32, margin: '0 auto' }}>
      <header className="r" style={{ justifyContent: 'space-between' }}>
        <div><h1>New application</h1><p className="t">Complete the details and upload checklist documents.</p></div>
        <Link to="/college">Back to dashboard</Link>
      </header>
      {error && <p role="alert" className="wn">{error}</p>}
      {message && <p role="status" className="ib">{message}</p>}
      {!application && !error && <p className="t">Creating your draft…</p>}
      {application && <form onSubmit={submit}>
        <section className="c">
          <h2>Application details</h2>
          {[
            ['institutionName', 'Institution name', 'text'],
            ['academicYear', 'Academic year', 'text'],
            ['address', 'Address', 'text'],
            ['proposedIntake', 'Proposed intake', 'number'],
            ['previousApprovalRef', 'Previous approval reference', 'text'],
          ].map(([key, label, type]) => <label key={key} className="t" style={{ display: 'block', marginTop: 12 }}>
            {label}
            <input className="in" required={['institutionName', 'academicYear', 'address', 'proposedIntake'].includes(key)}
              type={type} value={form[key] ?? ''} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
          </label>)}
        </section>
        {application.checklist && <>
          <section className="c" style={{ marginTop: 16 }}>
            <h2>Required documents</h2>
            <p className="t">{application.checklist.requiredUploaded} of {application.checklist.requiredTotal} required uploaded ({application.checklist.percent}%).</p>
            {application.checklist.items.map((item) => <div key={item.key} className="r" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #e2e8f0', padding: '12px 0' }}>
              <div><b>{item.label}</b><p className="t">{item.description || item.rule || ''} · {item.filename || 'Not uploaded'}</p></div>
              <label className="btn bo">Choose file<input type="file" hidden disabled={busy} onChange={(event) => { upload('documents', item.key, event.target.files?.[0]); event.target.value = ''; }} /></label>
            </div>)}
          </section>
          <section className="c" style={{ marginTop: 16 }}>
            <h2>Infrastructure evidence</h2>
            {application.checklist.infrastructure.map((item) => <div key={item.key} className="r" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 16, borderTop: '1px solid #e2e8f0', padding: '12px 0' }}>
              <div><b>{item.label}</b><p className="t">{item.requirement} · {item.filename || 'Not uploaded'}</p></div>
              <label className="btn bo">Choose file<input type="file" hidden disabled={busy} accept="image/*,application/pdf" onChange={(event) => { upload('infrastructure', item.key, event.target.files?.[0]); event.target.value = ''; }} /></label>
            </div>)}
          </section>
        </>}
        <div className="r" style={{ justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
          <button type="button" disabled={busy} className="btn bo" onClick={saveDraft}>Save draft</button>
          <button type="submit" disabled={busy}>{busy ? 'Working…' : 'Save and submit'}</button>
        </div>
      </form>}
    </main>
  );
}
