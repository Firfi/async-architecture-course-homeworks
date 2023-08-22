import { getOutstandingPayouts, payout } from '../db';
import { constVoid, flow, pipe } from 'fp-ts/function';
import * as A from 'fp-ts/Array';
import { producer } from '../kafka';
import * as TE from 'fp-ts/TaskEither';
import { TaskEither } from 'fp-ts/TaskEither';
import { UserId } from '@monorepo/utils';

// simulate "cron" with derp day counter
const MS_IN_DAY = 1000 * 60 * 60 * 24;

// TODO pull by notification task etc
const payoutNotifyQueue: [UserId, bigint][] = [];

const notify =
  (userId: UserId, amount: bigint) =>
  (tx: 'transaction todo'): TaskEither<'reportError', void> => {
    // pretend we have transactional outbox here;
    return TE.tryCatch(
      async () => {
        payoutNotifyQueue.push([userId, amount]);
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
    const tx = 'transaction todo';
    // really: queue payout in a separate account; then queue the payout event into kafka and handle it moving the 'queued' funds to 'paid out'
    const aggregate = payout(userId as UserId, amount)(tx);
    return notify(userId as UserId, amount)(tx);
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
