import { MeResSchema } from '@tdvh/shared';

// Kiểu suy từ schema shared (shared không export kiểu UserView/ProfileView).
type MeRes = ReturnType<typeof MeResSchema.parse>;
export type UserView = MeRes['user'];
export type ProfileView = MeRes['profile'];
