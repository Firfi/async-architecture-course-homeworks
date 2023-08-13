import * as S from '@effect/schema/Schema';

export const ROLE_WORKER = 'worker';
export const ROLE_ADMIN = 'admin';
export const ROLE_MANAGER = 'manager';
export const ROLE_ACCOUNTANT = 'accountant';
export const ROLES = [
  ROLE_WORKER,
  ROLE_ADMIN,
  ROLE_MANAGER,
  ROLE_ACCOUNTANT,
] as const;

export const Role = S.literal(...ROLES);

export const UserIdBrand = Symbol.for('UserId');
export const UserId = S.string.pipe(S.brand(UserIdBrand));
export type UserId = S.To<typeof UserId>;

export const User = S.struct({
  id: UserId,
  email: S.string,
  role: Role,
});

export type User = S.To<typeof User>;

export const USER_TOPIC_NAME = 'user';

export const FiefUserFields = S.struct({
  role: Role,
});

export const FiefUser = S.struct({
  sub: UserId,
  fields: FiefUserFields,
});
