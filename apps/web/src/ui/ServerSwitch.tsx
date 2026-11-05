import { useEffect, useState } from 'react';
import { useServerStore } from '../store/serverStore';
import { useWorldStore } from '../store/worldStore';
import { Button, Panel } from './components';
import { errorTextFor } from './errorText';
import { ServerCardView } from './ServerList';
import './ServerSwitch.css';

// HUD "Đổi máy chủ" (§3.5.3, M1-E5-T10). Danh sách không gồm máy chủ hiện tại; không tự chuyển.
// Chỉ có một máy chủ thì không có lựa chọn nào: hộp hiện "Chưa có máy chủ khác".
export function ServerSwitch() {
  const status = useWorldStore((s) => s.status);
  const currentId = useWorldStore((s) => s.serverId);
  const switching = useWorldStore((s) => s.switching);
  const switchError = useWorldStore((s) => s.switchError);
  const switchServer = useWorldStore((s) => s.switchServer);
  const clearSwitchError = useWorldStore((s) => s.clearSwitchError);
  const servers = useServerStore((s) => s.servers);
  const listError = useServerStore((s) => s.listError);
  const loadServers = useServerStore((s) => s.loadServers);
  const [open, setOpen] = useState(false);

  // Mỗi lần mở tải lại danh sách để có số liệu mới.
  useEffect(() => {
    if (open) void loadServers();
  }, [open, loadServers]);

  if (status !== 'joined') return null;

  if (!open) {
    return (
      <div className="hud-switch">
        <Button
          variant="secondary"
          onClick={() => {
            clearSwitchError();
            setOpen(true);
          }}
        >
          Đổi máy chủ
        </Button>
      </div>
    );
  }

  const others = (servers ?? []).filter((sv) => sv.id !== currentId);

  // Thành công thì server đã đổi, đóng hộp; thất bại thì giữ hộp để hiện lỗi.
  const onSelect = async (id: string) => {
    const ok = await switchServer(id);
    if (ok) setOpen(false);
  };

  let body;
  if (servers === null && !listError) {
    body = <p role="status">Đang tải danh sách máy chủ...</p>;
  } else if (listError) {
    body = (
      <p role="alert" className="form-error">
        {errorTextFor(listError)}
      </p>
    );
  } else if (others.length === 0) {
    body = <p className="hint">Chưa có máy chủ khác.</p>;
  } else {
    body = (
      <>
        {others.map((sv) => (
          <ServerCardView
            key={sv.id}
            server={sv}
            disabled={switching}
            actionLabel="Chuyển sang máy chủ này"
            onSelect={(id) => void onSelect(id)}
          />
        ))}
        <p className="hint">Số người online sẽ tự cập nhật khi đã kết nối tới máy chủ.</p>
      </>
    );
  }

  return (
    <div className="switch-overlay" role="dialog" aria-label="Đổi máy chủ">
      <Panel title="Đổi máy chủ">
        {switching && <p role="status">Đang chuyển máy chủ...</p>}
        {switchError !== null && (
          <p role="alert" className="form-error">
            {errorTextFor(switchError)}
          </p>
        )}
        {body}
        <Button variant="link" disabled={switching} onClick={() => setOpen(false)}>
          Đóng
        </Button>
      </Panel>
    </div>
  );
}
