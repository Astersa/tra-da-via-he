import { useEffect } from 'react';
import { useServerStore, type ServerCard } from '../store/serverStore';
import { Button, Panel } from './components';
import { errorTextFor } from './errorText';
import './ServerList.css';

const LOAD_TEXT: Record<ServerCard['load'], string> = {
  LOW: 'Vắng',
  MEDIUM: 'Vừa',
  HIGH: 'Đông',
};

function ServerCardView({
  server,
  disabled,
  onSelect,
}: {
  server: ServerCard;
  disabled: boolean;
  onSelect: (serverId: string) => void;
}) {
  return (
    <article className="server-card">
      <h2 className="server-name">{server.name}</h2>
      <dl className="server-stats">
        <div>
          <dt>Đang online</dt>
          <dd>{server.online}</dd>
        </div>
        <div>
          <dt>Quán hoạt động</dt>
          <dd>{server.activeShops}</dd>
        </div>
        <div>
          <dt>Plot trống</dt>
          <dd>{server.freePlots}</dd>
        </div>
        <div>
          <dt>Mức tải</dt>
          <dd>{LOAD_TEXT[server.load]}</dd>
        </div>
        <div>
          <dt>Ping</dt>
          <dd aria-label="Ping chưa đo được">—</dd>
        </div>
      </dl>
      <Button variant="secondary" disabled={disabled} onClick={() => onSelect(server.id)}>
        Vào máy chủ này
      </Button>
    </article>
  );
}

export function ServerList() {
  const servers = useServerStore((s) => s.servers);
  const loading = useServerStore((s) => s.loading);
  const listError = useServerStore((s) => s.listError);
  const joining = useServerStore((s) => s.joining);
  const joinError = useServerStore((s) => s.joinError);
  const serverId = useServerStore((s) => s.serverId);
  const loadServers = useServerStore((s) => s.loadServers);
  const quickJoin = useServerStore((s) => s.quickJoin);
  const selectServer = useServerStore((s) => s.selectServer);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const selected = serverId ? servers?.find((s) => s.id === serverId) : undefined;
  const busy = joining;

  let body;
  if (loading && servers === null) {
    body = <p role="status">Đang tải danh sách máy chủ...</p>;
  } else if (listError) {
    body = (
      <>
        <p role="alert" className="form-error">
          {errorTextFor(listError)}
        </p>
        <Button variant="secondary" onClick={() => void loadServers()} disabled={loading}>
          Thử lại
        </Button>
      </>
    );
  } else if (servers && servers.length === 0) {
    body = <p className="hint">Chưa có máy chủ nào đang mở.</p>;
  } else if (servers) {
    body = servers.map((server) => (
      <ServerCardView key={server.id} server={server} disabled={busy} onSelect={selectServer} />
    ));
  }

  return (
    <Panel title="Chọn máy chủ">
      <Button onClick={() => void quickJoin()} disabled={busy || !servers || servers.length === 0}>
        {joining ? 'Đang tìm...' : 'Vào nhanh (Quick Join)'}
      </Button>
      {joinError !== null && (
        <p role="alert" className="form-error">
          {errorTextFor(joinError)}
        </p>
      )}
      {body}
      {serverId && (
        <section className="server-temp" aria-label="Vùng tạm">
          <p role="status">
            {selected ? `Đã chọn ${selected.name}.` : 'Đã chọn máy chủ.'} Màn game sẽ mở ở bước sau.
          </p>
        </section>
      )}
      <p className="hint">Số người online sẽ tự cập nhật khi đã kết nối tới máy chủ.</p>
    </Panel>
  );
}
