import { useState, type FormEvent } from 'react';
import { useApp } from '../ctx';

/** One-time password prompt for a device that is not syncing yet. */
export function SignIn({ why }: { why: string }) {
  const { sync } = useApp();
  const [value, setValue] = useState('');
  if (!sync.available || sync.signedIn) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value) void sync.signIn(value);
  };

  return (
    <form className="signin" onSubmit={submit}>
      <label htmlFor="sync-password">{why}</label>
      <div className="signin-row">
        <input
          id="sync-password"
          type="password"
          autoComplete="current-password"
          placeholder="同步密碼"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="primary" disabled={sync.busy || !value}>
          {sync.busy ? '登入中…' : '登入這台裝置'}
        </button>
      </div>
      {sync.error && (
        <p className="form-error" role="alert">
          {sync.error}
        </p>
      )}
    </form>
  );
}
