import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@tdvh/shared';
import { useWorldStore } from '../store/worldStore';
import { ChatPanel } from './ChatPanel';
import { ERROR_TEXT } from './errorText';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function msg(id: string, displayName: string, text: string): ChatMessage {
  return { id, userId: '00000000-0000-4000-8000-000000000001', displayName, text, at: '2026-11-06T00:00:00.000Z' };
}

const sendChat = vi.fn(async (_text: string, _clientMsgId: string) => true);

beforeEach(() => {
  sendChat.mockReset();
  sendChat.mockResolvedValue(true);
  useWorldStore.setState({ status: 'joined', recentChat: [], chatError: null, sendChat });
});

afterEach(() => {
  cleanup();
  useWorldStore.getState().disconnectWorld();
});

describe('ChatPanel: hiển thị tin', () => {
  it('<script> trong tin hiện đúng dạng chữ, không tạo phần tử script', () => {
    const text = '<script>alert("x")</script> chào';
    useWorldStore.setState({ recentChat: [msg('00000000-0000-4000-8000-0000000000a1', 'Lan', text)] });
    const { container } = render(<ChatPanel />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });

  it('tiếng Việt có dấu hiển thị đúng', () => {
    useWorldStore.setState({
      recentChat: [msg('00000000-0000-4000-8000-0000000000a2', 'Thủy Tiên', 'Cảm ơn quán, trà đá ngon quá!')],
    });
    render(<ChatPanel />);
    expect(screen.getByText('Thủy Tiên')).toBeTruthy();
    expect(screen.getByText('Cảm ơn quán, trà đá ngon quá!')).toBeTruthy();
  });

  it('danh sách có role log và ô nhập có aria-label', () => {
    render(<ChatPanel />);
    expect(screen.getByRole('log', { name: 'Tin nhắn' })).toBeTruthy();
    expect(screen.getByLabelText('Nhập tin nhắn')).toBeTruthy();
  });
});

describe('ChatPanel: gửi tin', () => {
  it('Enter gửi nội dung đã cắt khoảng trắng với clientMsgId dạng UUID, xóa ô và giữ focus', async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    const input = screen.getByLabelText('Nhập tin nhắn') as HTMLInputElement;
    await user.type(input, '  Chào bạn  {enter}');
    await waitFor(() => expect(input.value).toBe(''));
    expect(sendChat).toHaveBeenCalledTimes(1);
    const [text, clientMsgId] = sendChat.mock.calls[0]!;
    expect(text).toBe('Chào bạn');
    expect(clientMsgId).toMatch(UUID);
    expect(document.activeElement).toBe(input);
  });

  it('nút Gửi bị khóa khi ô trống hoặc chỉ có khoảng trắng', async () => {
    const user = userEvent.setup();
    render(<ChatPanel />);
    const button = screen.getByRole('button', { name: 'Gửi' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText('Nhập tin nhắn'), '   ');
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText('Nhập tin nhắn'), '{enter}');
    expect(sendChat).not.toHaveBeenCalled();
  });

  it('ô nhập giới hạn 200 ký tự theo schema server', () => {
    render(<ChatPanel />);
    expect((screen.getByLabelText('Nhập tin nhắn') as HTMLInputElement).maxLength).toBe(200);
  });

  it('khi chưa vào world thì ô nhập bị khóa', () => {
    useWorldStore.setState({ status: 'reconnecting' });
    render(<ChatPanel />);
    expect((screen.getByLabelText('Nhập tin nhắn') as HTMLInputElement).disabled).toBe(true);
  });

  it('RATE_LIMITED hiện thông báo và giữ nội dung đang gõ', async () => {
    const user = userEvent.setup();
    sendChat.mockImplementation(async () => {
      useWorldStore.setState({ chatError: { code: 'RATE_LIMITED', message: 'quá nhanh' } });
      return false;
    });
    render(<ChatPanel />);
    const input = screen.getByLabelText('Nhập tin nhắn') as HTMLInputElement;
    await user.type(input, 'thử lại{enter}');
    expect((await screen.findByRole('alert')).textContent).toBe(ERROR_TEXT.RATE_LIMITED);
    expect(input.value).toBe('thử lại');
  });

  it('CHAT_MUTED hiện thông báo tiếng Việt và giữ nội dung', async () => {
    const user = userEvent.setup();
    sendChat.mockImplementation(async () => {
      useWorldStore.setState({ chatError: { code: 'CHAT_MUTED', message: 'muted' } });
      return false;
    });
    render(<ChatPanel />);
    const input = screen.getByLabelText('Nhập tin nhắn') as HTMLInputElement;
    await user.type(input, 'xin chào{enter}');
    expect((await screen.findByRole('alert')).textContent).toBe(ERROR_TEXT.CHAT_MUTED);
    expect(input.value).toBe('xin chào');
  });
});
