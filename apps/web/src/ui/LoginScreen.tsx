import { useRef, useState, type FormEvent } from 'react';
import { useAuthStore } from '../store/authStore';
import { Button, Field, Panel } from './components';
import { errorTextFor } from './errorText';

export function LoginScreen({ onBack }: { onBack: () => void }) {
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await login({ username, password });
    } catch (err) {
      setError(errorTextFor(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Panel title="Đăng nhập">
      <form className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <Field id="login-username" label="Tên đăng nhập">
          <input
            id="login-username"
            name="username"
            className="input"
            type="text"
            autoComplete="username"
            maxLength={20}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field id="login-password" label="Mật khẩu">
          <input
            id="login-password"
            name="password"
            className="input"
            type="password"
            autoComplete="current-password"
            maxLength={72}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </Button>
      </form>
      <p className="hint">Quên mật khẩu thì nhờ admin đặt lại.</p>
      <Button variant="link" onClick={onBack}>
        Quay lại vào quán
      </Button>
    </Panel>
  );
}
