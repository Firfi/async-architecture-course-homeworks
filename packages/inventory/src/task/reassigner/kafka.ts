import * as S from '@effect/schema/Schema';
import { Producer } from 'kafkajs';
import * as TE from 'fp-ts/TaskEither';
import { TaskId } from '@monorepo/inventory-common/schema';

export const ReassignEvent = S.struct({
  taskId: TaskId,
  // strategy: Random,
  timestamp: S.number.pipe(S.int(), S.nonNegative()),
});

export type ReassignEvent = S.To<typeof ReassignEvent>;
export const REASSIGN_TOPIC_NAME = 'reassign' as const;

export type ReportReassignError = 'ReportReassignError';

export const makeReportReassign =
  (producer: Producer) => (es: ReassignEvent[]) =>
    TE.tryCatch(
      async () => {
        void (await producer.send({
          topic: REASSIGN_TOPIC_NAME,
          messages: es.map((e) => ({
            key: e.taskId, // TODO retryable?
            value: JSON.stringify(e),
          })),
        }));
      },
      (e) => {
        console.error('reportReassign', e);
        return 'ReportReassignError' as const;
      }
    );

export type ReportReassign = ReturnType<typeof makeReportReassign>;
