// Khai báo cho import JSON trong spec (tsconfig không bật resolveJsonModule). Chỉ dùng cho test.
declare module "*.json" {
  const value: unknown;
  export default value;
}
