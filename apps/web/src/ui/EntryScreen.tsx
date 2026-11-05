import { useRef, useState, type FormEvent } from 'react';
import { useAuthStore } from '../store/authStore';
import { AVATAR_OPTIONS, AvatarFrame, type AvatarId } from './Avatar';
import { Button, Field, Panel } from './components';
import { errorTextFor } from './errorText';

export function EntryScreen({ onLogin }: { onLogin: () => void }) {
  const enterAsGuest = useAuthStore((s) => s.enterAsGuest);
  const [name, setName] = useState('');
  const [avatarId, setAvatarId] = useState<AvatarId>('avatar_01');
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
      await enterAsGuest({ displayName: name, avatarId });
    } catch (err) {
      setError(errorTextFor(err));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Panel title="Trà Đá Vỉa Hè">
      <p className="intro">Chọn một nhân vật và đặt tên để vào quán.</p>
      <form className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <fieldset className="avatar-fieldset">
          <legend>Chọn nhân vật</legend>
          <div className="avatar-grid">
            {AVATAR_OPTIONS.map((opt) => (
              <label key={opt.id} className="avatar-choice">
                <input
                  type="radio"
                  name="avatar"
                  value={opt.id}
                  checked={avatarId === opt.id}
                  onChange={() => setAvatarId(opt.id)}
                  className="visually-hidden"
                />
                <AvatarFrame id={opt.id} />
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="entry-name" label="Tên của bạn">
          <input
            id="entry-name"
            name="displayName"
            className="input"
            type="text"
            autoComplete="nickname"
            maxLength={20}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Đang vào...' : 'Vào uống trà đá'}
        </Button>
      </form>
      <Button variant="link" onClick={onLogin}>
        Đã có tài khoản? Đăng nhập
      </Button>
    </Panel>
  );
}
