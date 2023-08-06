import * as S from '@effect/schema/Schema';

const ROLE_WORKER = 'worker';
const ROLE_ADMIN = 'admin';
const ROLE_MANAGER = 'manager';
const ROLE_ACCOUNTANT = 'accountant';
const ROLES = [ROLE_WORKER, ROLE_ADMIN, ROLE_MANAGER, ROLE_ACCOUNTANT] as const;

export const Role = S.literal(...ROLES);

const UserIdBrand = Symbol.for('UserId');
export const UserId = S.string.pipe(S.brand(UserIdBrand));
export type UserId = S.To<typeof UserId>;

export const User = S.struct({
  id: UserId,
  email: S.string,
  role: Role,
});

export type User = S.From<typeof User>;

export const USER_TOPIC_NAME = 'user';
