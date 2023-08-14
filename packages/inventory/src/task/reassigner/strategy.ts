// TODO persist; raise question about determinism
import { uniformIntDistribution, xoroshiro128plus } from 'pure-rand';
import { pipe } from 'fp-ts/function';
import { users } from '../../user/db';
import * as A from 'fp-ts/Array';
import { ROLE_WORKER } from '@monorepo/kafka-users-common';
import { none, some } from 'fp-ts/Option';

let rand = xoroshiro128plus(69);

export const shuffleStrategy = () => {
  const assignees = pipe(
    Array.from(users.values()),
    A.filterMap((u) => (u.role === ROLE_WORKER ? some(u) : none))
  );
  const d = uniformIntDistribution(0, assignees.length - 1);
  const [i, rand1] = d(rand);
  const assignee = assignees[i];
  return [
    assignee,
    () => {
      rand = rand1;
    },
  ] as const;
};
