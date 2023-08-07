import { TaskEvent } from './model';
import { Producer } from 'kafkajs';
import * as TE from 'fp-ts/TaskEither';
import { pipe } from 'fp-ts/function';

export const TASK_EVENTS_TOPIC_NAME = 'task-events'; // not CUD

export type TaskReportError = 'TaskReportError';

export const report = (producer: Producer) => (e: TaskEvent) =>
  pipe(
    TE.tryCatch(
      async () => {
        await producer.send({
          topic: TASK_EVENTS_TOPIC_NAME,
          messages: [
            {
              key: `${e.taskId}-${e.type}-${e.timestamp}`,
              value: JSON.stringify(e),
            },
          ],
        });
      },
      (e) => {
        console.error('error reporting task event', e);
        return 'TaskReportError' as const;
      }
    ),
    TE.map(() => e)
  );
