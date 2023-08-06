import * as S from '@effect/schema/Schema';
import { UserId } from '@monorepo/kafka-users-common';
import { match, P } from 'ts-pattern';
import * as O from 'fp-ts/Option';
import { TaskEither } from 'fp-ts/TaskEither';
import * as TE from 'fp-ts/TaskEither';
import * as E from 'fp-ts/Either';
import { v4 } from 'uuid';
import { flow, pipe } from 'fp-ts/function';
import { Either } from 'fp-ts/Either';

export const TASK_EVENT_ASSIGN = 'Assign' as const;
export const TASK_EVENT_COMPLETE = 'Complete' as const;

export const TASK_EVENTS = [TASK_EVENT_ASSIGN, TASK_EVENT_COMPLETE] as const;

export type TaskEvent = (typeof TASK_EVENTS)[number];

export const TASK_STATE_NEW = 'new' as const;
export const TASK_STATE_ASSIGNED = 'assigned' as const;
export const TASK_STATE_COMPLETED = 'completed' as const;

export const TASK_STATES = [
  TASK_STATE_NEW,
  TASK_STATE_ASSIGNED,
  TASK_STATE_COMPLETED,
] as const;

export type TaskState = (typeof TASK_STATES)[number];

const TaskIdBrand = Symbol.for('TaskId');
const TaskId = S.string.pipe(S.brand(TaskIdBrand));
export type TaskId = S.To<typeof TaskId>;

export const WithId = S.struct({
  id: TaskId,
});

export type WithId = S.To<typeof WithId>;

const WithDescription = S.struct({
  description: S.string,
});

const TaskCommons = WithId.pipe(S.extend(WithDescription));

const NewTask = TaskCommons.pipe(
  S.extend(
    S.struct({
      state: S.literal(TASK_STATE_NEW),
    })
  )
);

type NewTask = S.To<typeof NewTask>;

const AssignedTask = TaskCommons.pipe(
  S.extend(
    S.struct({
      state: S.literal(TASK_STATE_ASSIGNED),
      assignee: UserId,
    })
  )
);

type AssignedTask = S.To<typeof AssignedTask>;

const CompletedTask = TaskCommons.pipe(
  S.extend(
    S.struct({
      state: S.literal(TASK_STATE_COMPLETED),
      assignee: UserId,
    })
  )
);

type CompletedTask = S.To<typeof CompletedTask>;

const Task = S.union(NewTask, AssignedTask, CompletedTask);
export type Task = S.To<typeof Task>;

type AssignableTask = NewTask | AssignedTask /*allowed to reassign*/;
type CompletableTask = AssignedTask;

const tasksStorage: Map<TaskId, Task> = new Map();

type DbWriteError = 'DbWriteError';

export type WriteNewError = DbWriteError;

type WriteNewResponse = readonly [Task, 'Ok' | 'AlreadyExists'];

// TODO use a real db
// reaction to a new task; not master data
const writeNew = (t: NewTask): TaskEither<WriteNewError, WriteNewResponse> =>
  pipe(
    tasksStorage.get(t.id),
    O.fromNullable,
    O.foldW(
      () =>
        TE.tryCatch(
          async () => {
            tasksStorage.set(t.id, t);
            return [t, 'Ok' as const] as const;
          },
          (e) => {
            console.error('error writing new task', e);
            return 'DbWriteError' as const;
          }
        ),
      (t) => TE.of([t, 'AlreadyExists' as const] as const)
    )
  );

type SendEventError = 'SendEventError';

type SendCreateEventError = SendEventError;

// TODO send to kafka
const sendCreateEvent = (
  t: NewTask
): TaskEither<SendCreateEventError, NewTask> => TE.of(t);

type CreateError = WriteNewError | SendCreateEventError;

// TODO actor?
export const create = (
  description: string
): TaskEither<CreateError, WriteNewResponse> =>
  pipe(
    v4(),
    S.parseSync(TaskId),
    (id) =>
      ({
        id,
        state: TASK_STATE_NEW,
        description,
      } satisfies NewTask),
    sendCreateEvent /*TODO don't care if writeNew fails?*/,
    TE.chainW(writeNew)
  );

type SendAssignEventError = SendEventError;

// just task id is enough
const sendAssignEvent = <T extends WithId>(
  t: T
): TaskEither<SendAssignEventError, T> => TE.of(t);

type WriteAssignError = DbWriteError;
type TaskNotFoundError = 'TaskNotFound';
type AssignError =
  | WriteAssignError
  | TaskNotFoundError
  | SendAssignEventError
  | TaskNotAssignableError;

const writeAssignedTask = (assignee: UserId) =>
  TE.tryCatchK(
    async (t: AssignableTask) => {
      const updated = {
        ...t,
        state: TASK_STATE_ASSIGNED,
        assignee,
      } satisfies AssignedTask;
      tasksStorage.set(t.id, updated);

      return updated;
    },
    (e) => {
      console.error('error writing assigned task', e);
      return 'DbWriteError' as const;
    }
  );

type TaskNotAssignableError = 'TaskNotAssignable';

const assertTaskAssignable = (
  t: Task
): Either<TaskNotAssignableError, AssignableTask> =>
  match(t)
    .with({ state: TASK_STATE_COMPLETED }, (t) =>
      E.left('TaskNotAssignable' as const)
    )
    .otherwise(E.right);

// TODO actor?
// TODO state machine validation
export const assign = (
  taskId: TaskId,
  assignee: UserId
): TaskEither<AssignError, AssignedTask> =>
  pipe(
    tasksStorage.get(taskId),
    O.fromNullable,
    O.foldW(
      () => TE.left('TaskNotFound' as const),
      flow(
        assertTaskAssignable,
        TE.fromEither,
        /*we CAN assign again*/ TE.chainW(
          sendAssignEvent
        ) /*don't care about write past this point*/,
        TE.chainW(writeAssignedTask(assignee))
      )
    )
  );

type SendCompleteEventError = SendEventError;

const sendCompleteEvent = <T extends WithId>(
  t: T
): TaskEither<SendCompleteEventError, T> => TE.of(t);

type WriteCompleteError = DbWriteError;

// TODO state machine validation
// TODO actor?
const writeCompletedTask = TE.tryCatchK(
  async (t: CompletableTask) => {
    const updated = {
      ...t,
      state: TASK_STATE_COMPLETED,
    } satisfies CompletedTask;
    tasksStorage.set(t.id, updated);

    return updated;
  },
  (e) => {
    console.error('error writing completed task', e);
    return 'DbWriteError' as const;
  }
);

type TaskNotCompletableError = 'TaskNotCompletableError';
type CompleteError =
  | WriteCompleteError
  | TaskNotFoundError
  | SendCompleteEventError
  | TaskNotCompletableError;

const assertCompletable = (
  t: Task
): Either<TaskNotCompletableError, CompletableTask> =>
  match(t)
    .with({ state: TASK_STATE_NEW }, () =>
      E.left('TaskNotCompletableError' as const)
    )
    .with({ state: TASK_STATE_COMPLETED }, () =>
      E.left('TaskNotCompletableError' as const)
    )
    .otherwise(E.right);

export const complete = (
  taskId: TaskId
): TaskEither<CompleteError, CompletedTask> =>
  pipe(
    tasksStorage.get(taskId),
    O.fromNullable,
    O.foldW(
      () => TE.left('TaskNotFound' as const),
      flow(
        assertCompletable,
        TE.fromEither,
        TE.chainW(sendCompleteEvent) /*don't care about write past this point*/,
        TE.chainW(writeCompletedTask)
      )
    )
  );
