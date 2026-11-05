// Danh sách từ cấm của chat (M1-E4-T5). PO sửa file này.
// Khớp không phân biệt hoa thường và không phân biệt dấu, và chỉ khớp nguyên cụm từ (không khớp trong từ dài hơn).
// Chỉ dùng cụm từ nhẹ, trung tính: tránh từ đơn trùng với từ thường khi bỏ dấu (ví dụ "ngủ" và "ngu").
export const BANNED_WORDS: readonly string[] = [
  "mất dạy",
  "đồ ngốc",
  "khốn nạn",
  "ngu xuẩn",
  "đần độn",
];
