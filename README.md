# Trà Đá Vỉa Hè

Dự án MVP Trà Đá Vỉa Hè (monorepo pnpm).

Kế hoạch triển khai và task card: [TRA-DA-VIA-HE-MVP-DOCS/IMPLEMENTATION-PLAN.md](TRA-DA-VIA-HE-MVP-DOCS/IMPLEMENTATION-PLAN.md).
Thiết kế kỹ thuật: [TRA-DA-VIA-HE-MVP-DOCS/TRA-DA-VIA-HE-MVP-TECHNICAL-PLAN.md](TRA-DA-VIA-HE-MVP-DOCS/TRA-DA-VIA-HE-MVP-TECHNICAL-PLAN.md).

Lệnh chính (theo plan §4.1):

```bash
pnpm test:db:up   # khởi động PostgreSQL test trên port 5433, chạy một lần mỗi phiên
pnpm verify       # build, lint, kiểm tra boundary và tiền, test toàn bộ package
```
