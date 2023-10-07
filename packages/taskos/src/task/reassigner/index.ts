import { flow, pipe } from 'fp-ts/function';
import { DbReadError, GetTask, listAssigned, SetTask } from '../db';
import * as TE from 'fp-ts/TaskEither';
import * as A from 'fp-ts/Array';
import { ReaderTaskEither } from 'fp-ts/ReaderTaskEither';
import {
  REASSIGN_TOPIC_NAME,
  ReassignEvent,
  ReportReassign,
  ReportReassignError,
} from './kafka';
import { Consumer } from 'kafkajs';
import { assertExists } from '@monorepo/utils';
import * as S from '@effect/schema/Schema';
import { assign, ReportTaskEvent } from '../fsm';
import { isLeft } from 'fp-ts/Either';
import { shuffleStrategy } from './strategy';

export type ReassignError = ReportReassignError | DbReadError;

// TODO mutex it
export const reassign = (({ listAssigned, reportReassign }) =>
  pipe(
    listAssigned(),
    TE.chainW(
      flow(
        A.map(
          (t) =>
            ({
              taskId: t.id,
              timestamp: Date.now(),
            } satisfies ReassignEvent)
        ),
        reportReassign
      )
    )
  )) satisfies ReaderTaskEither<
  {
    listAssigned: typeof listAssigned;
    reportReassign: ReportReassign;
  },
  ReassignError,
  void
>;

export const listen =
  (deps: { get: GetTask; set: SetTask; report: ReportTaskEvent }) =>
  async (consumer: Consumer) => {
    // handle it as a queue
    await consumer.subscribe({ topic: REASSIGN_TOPIC_NAME });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        if (topic !== REASSIGN_TOPIC_NAME) return;
        const event = pipe(
          message.value,
          assertExists,
          (v) => v.toString(),
          JSON.parse,
          S.parseSync(ReassignEvent)
        );
        const [assignee, finalize] = shuffleStrategy();
        const r = await assign(event.taskId, assignee.id)(deps)();
        if (isLeft(r)) {
          console.error(
            `error on reassign ${event.taskId} to ${assignee.id}`,
            r.left
          );
          return;
        } else {
          finalize();
          console.log(`Reassigned ${event.taskId} to ${assignee.id}`);
        }
      },
    });
  };
