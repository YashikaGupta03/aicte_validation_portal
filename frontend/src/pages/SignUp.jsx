import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api.js';

const rolePaths = { college: '/college', officer: '/officer', admin: '/admin' };

export default function SignUp() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('college');
  const [form, setForm] = useState({ name: '', institution: '', email: '', password: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
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
      setToken(result.token);
      navigate(rolePaths[result.user.role] || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 520, margin: '48px auto', padding: 24 }}>
      <section className="c">
        <h1>{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
        <p className="t">Use the same account that is registered with the validation portal.</p>
        {error && <p role="alert" className="wn">{error}</p>}
        {message && <p role="status" className="ib">{message}</p>}
        <form onSubmit={submit}>
          {mode === 'signup' && <>
            <label className="t" htmlFor="role">Account type</label>
            <select id="role" className="in" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="college">College</option>
              <option value="officer">AICTE officer (requires approval)</option>
              <option value="admin">Administrator (requires approval)</option>
            </select>
            <label className="t" htmlFor="name">Full name</label>
            <input required minLength="2" id="name" name="name" className="in" value={form.name} onChange={update} />
            <label className="t" htmlFor="institution">Institution</label>
            <input required minLength="2" id="institution" name="institution" className="in" value={form.institution} onChange={update} />
          </>}
          <label className="t" htmlFor="email">Email</label>
          <input required type="email" id="email" name="email" className="in" value={form.email} onChange={update} />
          <label className="t" htmlFor="password">Password</label>
          <input required minLength={mode === 'signup' ? 10 : 1} type="password" id="password" name="password" className="in" value={form.password} onChange={update} />
          <button disabled={busy} type="submit" className="btn" style={{ marginTop: 18 }}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="t" style={{ marginTop: 16 }}>
          {mode === 'login' ? 'New here?' : 'Already registered?'}{' '}
          <button className="btn bo" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  );
}
