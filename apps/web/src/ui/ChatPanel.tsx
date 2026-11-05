import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ErrorCode } from '@tdvh/shared';
import { useWorldStore } from '../store/worldStore';
import { ERROR_TEXT } from './errorText';
import './ChatPanel.css';

// Khớp ChatSendReqSchema (text tối đa 200 ký tự).
const MAX_LEN = 200;

// Panel chat: danh sách tin (text React thuần, không HTML) và ô nhập. Enter gửi, focus giữ ở ô nhập.
export function ChatPanel() {
  const recentChat = useWorldStore((s) => s.recentChat);
  const status = useWorldStore((s) => s.status);
  const chatError = useWorldStore((s) => s.chatError);
  const sendChat = useWorldStore((s) => s.sendChat);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const joined = status === 'joined';
  const trimmed = draft.trim();

  // Tin mới thì cuộn xuống cuối.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [recentChat]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (trimmed === '' || sending || !joined) return;
    setSending(true);
    const ok = await sendChat(trimmed, crypto.randomUUID());
    setSending(false);
    // Chỉ xóa khi gửi được và người chơi chưa gõ thêm trong lúc chờ. Lỗi thì giữ nguyên nội dung.
    if (ok) setDraft((cur) => (cur.trim() === trimmed ? '' : cur));
    inputRef.current?.focus();
  }

  const errorMessage = chatError ? (ERROR_TEXT[chatError.code as ErrorCode] ?? chatError.message) : null;

  return (
    <section className="chat-panel" aria-label="Trò chuyện">
      <div className="chat-log" role="log" aria-label="Tin nhắn" ref={logRef}>
        {recentChat.map((m) => (
          <p key={m.id} className="chat-line">
            <span className="chat-name">{m.displayName}</span>
            <span className="chat-text">{m.text}</span>
          </p>
        ))}
      </div>
      {errorMessage !== null && (
        <p className="chat-error" role="alert">
          {errorMessage}
        </p>
      )}
      <form className="chat-form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          className="chat-input"
          type="text"
          aria-label="Nhập tin nhắn"
          placeholder="Nói gì đó..."
          autoComplete="off"
          maxLength={MAX_LEN}
          value={draft}
          disabled={!joined}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="chat-send" disabled={!joined || trimmed === ''}>
          Gửi
        </button>
      </form>
    </section>
  );
}
