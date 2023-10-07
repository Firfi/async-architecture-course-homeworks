import {
  ACCOUNTING_TOPIC_NAME,
  TASK_EVENTS_TOPIC_NAME,
} from '../../kafka-users-common/src/lib/topics';
import { pipe } from 'fp-ts/function';
import { assertExists } from '@monorepo/utils';
import * as S from '@effect/schema/Schema';
import {
  TASK_EVENT_ASSIGN,
  TASK_EVENT_COMPLETE,
  TaskEvent,
  UserAccountsCUD,
} from '@monorepo/taskos-common/schema';
import { match } from 'ts-pattern';
import { onPrice as reportPrice, onUserBalance } from './ticker';
import { consumer } from './kafka';

export const run = async () => {
  await consumer.connect();
  await consumer.subscribe({
    topics: [TASK_EVENTS_TOPIC_NAME, ACCOUNTING_TOPIC_NAME],
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (topic !== TASK_EVENTS_TOPIC_NAME && topic !== ACCOUNTING_TOPIC_NAME)
        return;
      const event = pipe(
        message.value,
        assertExists,
        (v) => v.toString(),
        JSON.parse,
        S.parseSync(S.union(TaskEvent, UserAccountsCUD))
      );
      match(event)
        .with(
          {
            type: 'UserAccountsCUD',
          },
          (cud) => {
            onUserBalance(
              cud.userId,
              BigInt(cud.current.balance),
              BigInt(cud.previous.balance),
              new Date(cud.timestamp)
            );
          }
        )
        .with({ type: TASK_EVENT_COMPLETE }, (t) => {
          reportPrice(BigInt(t.reward), new Date(t.timestamp));
        });
    },
  });
};
