import { getOutstandingPayouts, payout } from '../db';
import { constVoid, flow, pipe } from 'fp-ts/function';
import * as A from 'fp-ts/Array';
import { UserId } from '@monorepo/kafka-users-common';
import { producer } from '../kafka';
import * as TE from 'fp-ts/TaskEither';
import { TaskEither } from 'fp-ts/TaskEither';

// simulate "cron" with derp day counter
const MS_IN_DAY = 1000 * 60 * 60 * 24;

const report = (
  userId: UserId,
  amount: bigint
): TaskEither<'reportError', void> => {
  // pretend we have transactional outbox here; TODO
  return TE.tryCatch(
    async () => {
      await producer.connect();
      // TODO producer.send() ...
    },
    (e) => {
      console.error('report error', e);
      return 'reportError';
    }
  );
};

// TODO "running" state, idempotency key and all that
const run_ = flow(
  getOutstandingPayouts,
  (o) => Object.entries(o),
  A.map(([userId, amount]) => {
    // TODO pass transaction
    payout(userId as UserId, amount);
    return report(userId as UserId, amount);
  }),
  TE.sequenceArray,
  TE.map(constVoid)
);

export const run = async () =>
  setTimeout(() => {
    run_()().then((r) => {
      console.log('cron ran', r);
    });
  }, MS_IN_DAY);
