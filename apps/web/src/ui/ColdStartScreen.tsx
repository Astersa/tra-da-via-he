import { useEffect } from 'react';
import { waitUntilAwake } from '../api/awake';
import { useConnectivityStore } from '../store/connectivityStore';
import { Button, Panel } from './components';
import './ColdStartScreen.css';

// Màn chờ khi service đang ngủ hoặc khởi động lại (§3.10.6). Hiện khi status === 'waking'.
// Tự chờ service thức (waitUntilAwake dùng chung một vòng chờ); quá 180 giây thì hiện nút "Thử lại".
// Giới hạn đã biết: tab tải mới khi service đang ngủ thì trang do Render phục vụ, chưa có JS nào của ta chạy nên màn này không hiện được.
export function ColdStartScreen() {
  const gaveUp = useConnectivityStore((s) => s.gaveUp);

  useEffect(() => {
    void waitUntilAwake();
  }, []);

  return (
    <div className="cold-start" role="status">
      <Panel title="Trà Đá Vỉa Hè">
        <p>Quán đang mở cửa, chờ khoảng 1 phút</p>
        {gaveUp && <Button onClick={() => void waitUntilAwake()}>Thử lại</Button>}
      </Panel>
    </div>
  );
}
