'use client';

import { useState } from 'react';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      setError('Wrong password.');
    }
  }

  return (
    <div style={{ maxWidth: 340, margin: '15vh auto' }}>
      <div className="card">
        <h1 style={{ marginBottom: 12 }}>Sign in</h1>
        <form onSubmit={submit}>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="error mt">{error}</p>}
          <button className="primary mt" type="submit" style={{ width: '100%', marginTop: 12 }}>
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}
