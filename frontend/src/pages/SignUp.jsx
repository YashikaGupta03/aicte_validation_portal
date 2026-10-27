import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';

const roles = [
  { value: 'college', label: 'Student', description: 'Submit applications, upload documents and track progress.' },
  { value: 'officer', label: 'AICTE officer', description: 'Review applications, evidence and validation results.' },
  { value: 'admin', label: 'Administrator', description: 'Manage users, checklists and platform settings.' },
];
const demoAccounts = {
  college: { email: 'college@demo.local', password: 'College@12345' },
  officer: { email: 'officer@demo.local', password: 'Officer@12345' },
  admin: { email: 'admin@demo.local', password: 'Admin@12345' },
};
const rolePaths = { college: '/college', officer: '/officer', admin: '/admin' };

export default function SignUp() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('college');
  const [form, setForm] = useState({ name: '', institution: '', email: '', password: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedRole = roles.find((option) => option.value === role);

  function update(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  function fillDemo() {
    setForm((current) => ({ ...current, ...demoAccounts[role] }));
    setError('');
    setMessage(`Demo ${selectedRole?.label} credentials filled in. Press Sign in to continue.`);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = mode === 'login'
        ? await api('/api/auth/login', { method: 'POST', body: { email: form.email, password: form.password } })
        : await api('/api/auth/signup', { method: 'POST', body: { ...form, role } });

      if (!result.token) {
        setMessage(result.message || 'Your account was created and is waiting for administrator approval.');
        setMode('login');
        return;
      }

      if (result.user.role !== role) {
        setError(`This account is registered as ${roles.find((option) => option.value === result.user.role)?.label || result.user.role}. Select that role to sign in.`);
        return;
      }

      setToken(result.token);
      navigate(rolePaths[result.user.role] || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <a className="auth-brand" href="#/">
          <span className="auth-brand-icon" aria-hidden="true">✓</span>
          <span>Approval Validation Platform</span>
        </a>
        <div className="auth-pitch">
          <h1>Documents checked with evidence. Decisions made by people.</h1>
          <p>Colleges upload an application once. The platform reads the documents, checks them against rules and records, and shows an officer exactly what needs a closer look.</p>
        </div>
        <ul className="auth-assurances">
          <li>AI results are advisory. Officers make every final decision.</li>
          <li>Every flag links to the page and region it came from.</li>
          <li>An append-only audit trail records rules applied, records checked and actions taken.</li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <h2>{mode === 'login' ? 'Sign in' : 'Create an account'}</h2>
          <p className="auth-subtitle">Choose how you use the platform. What you see depends on your role.</p>

          {error && <p role="alert" className="wn auth-notice">{error}</p>}
          {message && <p role="status" className="ib auth-notice">{message}</p>}

          <form onSubmit={submit}>
            <fieldset className="auth-role-field">
              <legend>Role</legend>
              <div className="auth-role-options">
                {roles.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`auth-role-option${role === option.value ? ' selected' : ''}`}
                    aria-pressed={role === option.value}
                    onClick={() => setRole(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="auth-role-description">{selectedRole?.description}</p>
            </fieldset>

            {mode === 'signup' && (
              <>
                <label className="auth-label" htmlFor="name">Full name</label>
                <input required minLength="2" id="name" name="name" className="in auth-input" value={form.name} onChange={update} autoComplete="name" />
                <label className="auth-label" htmlFor="institution">Institution</label>
                <input required minLength="2" id="institution" name="institution" className="in auth-input" value={form.institution} onChange={update} autoComplete="organization" />
              </>
            )}

            <label className="auth-label" htmlFor="email">Work email</label>
            <input required type="email" id="email" name="email" className="in auth-input" value={form.email} onChange={update} autoComplete="username" placeholder="name@institution.edu" />
            <label className="auth-label" htmlFor="password">Password</label>
            <input required minLength={mode === 'signup' ? 10 : 1} type="password" id="password" name="password" className="in auth-input" value={form.password} onChange={update} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Enter your password" />

            {mode === 'login' && (
              <button type="button" className="bo auth-demo" onClick={fillDemo}>
                Use demo {selectedRole?.label} credentials
              </button>
            )}

            <button disabled={busy} type="submit" className="btn auth-submit">
              {busy ? 'Please wait…' : mode === 'login' ? `Sign in as ${selectedRole?.label}` : 'Create account'}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'login' ? 'Need an account?' : 'Already registered?'}{' '}
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}>
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
          <div className="auth-security-note">
            Access is role-based and every action is recorded. Sessions end automatically after a period of inactivity.
          </div>
        </div>
      </section>
    </main>
  );
}
