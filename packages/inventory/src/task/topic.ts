import { Producer } from 'kafkajs';
import * as TE from 'fp-ts/TaskEither';
import { pipe } from 'fp-ts/function';
import {
  TASK_EVENT_CURRENT_VERSIONS,
  TaskEvent,
} from '@monorepo/inventory-common/schema';

export const TASK_EVENTS_TOPIC_NAME = 'task-events'; // not CUD

export type TaskReportError = 'TaskReportError';

export const report = (producer: Producer) => (e: TaskEvent) =>
  pipe(
    TE.tryCatch(
      async () => {
        // TODO compile-time
        if (e.version !== TASK_EVENT_CURRENT_VERSIONS[e.type]) {
          throw new Error(
            `TaskEvent version mismatch. Expected ${
              TASK_EVENT_CURRENT_VERSIONS[e.type]
            } but got ${e.version}`
          );
        }
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
