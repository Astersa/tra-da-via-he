import type { ErrorCode } from '@tdvh/shared';
import { ApiError } from '../api/client';

// Mọi ErrorCode phải có văn bản: thiếu mã thì TypeScript báo lỗi.
export const ERROR_TEXT: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Bạn cần vào quán lại để tiếp tục.',
  SESSION_STALE: 'Phiên chơi đã cũ. Vui lòng tải lại trang.',
  VALIDATION_FAILED: 'Thông tin nhập chưa đúng. Kiểm tra lại rồi thử lần nữa.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Chờ một chút rồi thử lại.',
  INTERNAL_ERROR: 'Có lỗi ở quán. Thử lại sau ít phút.',
  SERVER_NOT_FOUND: 'Không tìm thấy máy chủ này.',
  SERVER_NOT_ACTIVE: 'Máy chủ này đang tạm đóng.',
  SERVER_FULL: 'Máy chủ đã đầy. Thử máy chủ khác.',
  ALREADY_IN_SERVER: 'Bạn đang ở một máy chủ khác.',
  SEAT_NOT_FOUND: 'Không tìm thấy chỗ ngồi này.',
  SEAT_TAKEN: 'Chỗ này đã có người ngồi.',
  TOO_FAR: 'Bạn đứng quá xa để làm việc này.',
  CHAT_MUTED: 'Bạn đang bị cấm chat tạm thời.',
  SHOP_NOT_FOUND: 'Không tìm thấy quán này.',
  SHOP_NOT_HIRING: 'Quán này hiện không tuyển người.',
  SHOP_FULL: 'Quán đã đủ nhân viên.',
  ALREADY_EMPLOYED: 'Bạn đang làm việc ở một quán khác.',
  ALREADY_APPLIED: 'Bạn đã nộp đơn vào quán này rồi.',
  OWNER_CANNOT_APPLY: 'Chủ quán không thể nộp đơn vào quán của mình.',
  TOO_MANY_APPLICATIONS: 'Bạn đang có quá nhiều đơn xin việc. Chờ bớt rồi thử lại.',
  APPLICATION_NOT_FOUND: 'Không tìm thấy đơn xin việc này.',
  APPLICATION_NOT_PENDING: 'Đơn này đã được xử lý rồi.',
  APPLICANT_ALREADY_EMPLOYED: 'Người này đã có việc ở quán khác.',
  FORBIDDEN: 'Bạn không có quyền làm việc này.',
  SHOP_NOT_ACCEPTING: 'Quán đang tạm không nhận đơn.',
  MENU_ITEM_UNAVAILABLE: 'Món này hiện không bán.',
  INSUFFICIENT_FUNDS: 'Bạn không đủ xu để mua.',
  SELF_PURCHASE_FORBIDDEN: 'Bạn không thể tự mua món của mình.',
  TOO_MANY_OPEN_ORDERS: 'Bạn đang có quá nhiều đơn chưa xong.',
  IDEMPOTENCY_CONFLICT: 'Yêu cầu này trùng với một yêu cầu trước nhưng khác nội dung.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn này.',
  ORDER_INVALID_STATE: 'Đơn không ở trạng thái để làm bước này.',
  ORDER_ALREADY_TAKEN: 'Đơn này đã có người nhận.',
  TOO_MANY_ACTIVE_ORDERS: 'Bạn đang giữ quá nhiều đơn cùng lúc.',
  ORDER_NOT_HANDLER: 'Bạn không phải người phụ trách đơn này.',
  ORDER_TOO_EARLY: 'Chưa tới lúc làm đơn này.',
  ORDER_ACCEPT_EXPIRED: 'Đơn đã quá hạn nhận.',
  TOKEN_EXPIRED: 'Phiên đăng nhập đã hết hạn.',
  INVALID_CREDENTIALS: 'Sai tên đăng nhập hoặc mật khẩu.',
  USERNAME_TAKEN: 'Tên đăng nhập này đã có người dùng.',
  ALREADY_REGISTERED: 'Tài khoản này đã được đăng ký rồi.',
  ACCOUNT_REQUIRED: 'Cần có tài khoản để làm việc này.',
  DISPLAY_NAME_TAKEN: 'Tên này đã có người dùng. Chọn tên khác nhé.',
  DISPLAY_NAME_INVALID: 'Tên không hợp lệ. Dùng 3 đến 20 chữ cái hoặc số.',
  NOT_FOUND: 'Không tìm thấy nội dung này.',
  PLOT_NOT_FOUND: 'Không tìm thấy mặt bằng này.',
  PLOT_TAKEN: 'Mặt bằng này đã có quán.',
  PLOT_NOT_PURCHASABLE: 'Mặt bằng này chưa mở bán.',
  SHOP_LIMIT_REACHED: 'Bạn đã đạt số quán tối đa.',
  PRICE_OUT_OF_RANGE: 'Giá nằm ngoài khoảng cho phép.',
  TREASURY_INSUFFICIENT: 'Quỹ quán không đủ tiền.',
  AMOUNT_INVALID: 'Số tiền không hợp lệ.',
  NOT_EMPLOYED: 'Bạn chưa làm việc ở quán nào.',
  TOPUP_NOT_ELIGIBLE: 'Hôm nay chưa đủ điều kiện nhận bù xu.',
};

export const NETWORK_ERROR_TEXT = 'Không kết nối được tới quán. Kiểm tra mạng rồi thử lại.';

// Chuyển lỗi thành câu tiếng Việt để hiện cho người chơi.
export function errorTextFor(err: unknown): string {
  if (err instanceof ApiError) return ERROR_TEXT[err.code];
  return NETWORK_ERROR_TEXT;
}
