import { TASK_EVENTS_TOPIC_NAME } from '../../kafka-users-common/src/lib/topics';
import { pipe } from 'fp-ts/function';
import { assertExists } from '@monorepo/utils';
import * as S from '@effect/schema/Schema';
import {
  TASK_EVENT_ASSIGN,
  TASK_EVENT_COMPLETE,
  TaskEvent,
} from '@monorepo/inventory-common/schema';
import { match } from 'ts-pattern';
import { penalty, reward } from './db';
import { consumer } from './kafka';

export const run = async () => {
  await consumer.connect();
  await consumer.subscribe({
    topic: TASK_EVENTS_TOPIC_NAME,
    fromBeginning: true,
  });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (topic !== TASK_EVENTS_TOPIC_NAME) return;
      const event = pipe(
        message.value,
        assertExists,
        (v) => v.toString(),
        JSON.parse,
        S.parseSync(TaskEvent)
      );
      match(event)
        .with({ type: TASK_EVENT_ASSIGN }, (t) => {
          // TODO idempotency key from the message (key?)
          penalty(t.assignee, t.taskId, BigInt(t.price));
        })
        .with({ type: TASK_EVENT_COMPLETE }, (t) => {
          reward(t.userId, t.taskId, BigInt(t.reward));
        });
    },
  });
};
