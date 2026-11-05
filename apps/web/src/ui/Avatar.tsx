// Spritesheet avatar: 4 hàng × 4 cột, khung 32×48 (public/assets/manifest.json). Hiển thị khung đầu.
export const AVATAR_IDS = ['avatar_01', 'avatar_02', 'avatar_03', 'avatar_04'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export const AVATAR_FRAME = { width: 32, height: 48, columns: 4, rows: 4 } as const;

export const AVATAR_OPTIONS: { id: AvatarId; label: string; url: string }[] = AVATAR_IDS.map(
  (id, i) => ({ id, label: `Nhân vật ${i + 1}`, url: `/assets/${id}.png` }),
);

export function AvatarFrame({ id, scale = 1.5 }: { id: AvatarId; scale?: number }) {
  const option = AVATAR_OPTIONS.find((o) => o.id === id);
  const w = AVATAR_FRAME.width * scale;
  const h = AVATAR_FRAME.height * scale;
  return (
    <div
      role="img"
      aria-label={option?.label ?? 'Nhân vật'}
      className="avatar-frame"
      style={{
        width: w,
        height: h,
        backgroundImage: `url(${option?.url ?? ''})`,
        backgroundSize: `${AVATAR_FRAME.columns * w}px ${AVATAR_FRAME.rows * h}px`,
        backgroundPosition: '0 0',
      }}
    />
  );
}
