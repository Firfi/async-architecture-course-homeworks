import * as S from '@effect/schema/Schema';

const ROLE_WORKER = 'worker';
const ROLE_ADMIN = 'admin';
const ROLE_MANAGER = 'manager';
const ROLE_ACCOUNTANT = 'accountant';
const ROLES = [ROLE_WORKER, ROLE_ADMIN, ROLE_MANAGER, ROLE_ACCOUNTANT] as const;

export const Role = S.literal(...ROLES);

export const User = S.struct({
  id: S.string,
  email: S.string,
  role: Role,
});

export type User = S.From<typeof User>;

export const USER_TOPIC_NAME = 'user';
