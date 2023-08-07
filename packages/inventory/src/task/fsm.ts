import * as S from '@effect/schema/Schema';
import { UserId } from '@monorepo/kafka-users-common';
import { match } from 'ts-pattern';
import * as O from 'fp-ts/Option';
import * as TE from 'fp-ts/TaskEither';
import * as RTE from 'fp-ts/ReaderTaskEither';
import { TaskEither } from 'fp-ts/TaskEither';
import * as E from 'fp-ts/Either';
import * as Reader from 'fp-ts/Reader';
import { Either } from 'fp-ts/Either';
import { v4 } from 'uuid';
import { flow, pipe } from 'fp-ts/function';
import {
  tasksStorage,
  get as getFromDb,
  set as setInDb,
  DbWriteError,
  TaskDbReadError,
  GetTask,
  SetTask,
  DbReadError,
} from './db';
import {
  AssignableTask,
  AssignedTask,
  CompletableTask,
  CompletedTask,
  NewTask,
  Task,
  TASK_EVENT_ASSIGN,
  TASK_EVENT_COMPLETE,
  TASK_EVENT_CREATE,
  TASK_STATE_ASSIGNED,
  TASK_STATE_COMPLETED,
  TASK_STATE_NEW,
  TaskEvent,
  TaskEventAssign,
  TaskEventComplete,
  TaskEventCreate,
  TaskId,
  WithId,
} from './model';
import { Option, some } from 'fp-ts/Option';
import { apply } from 'fp-ts/function';
import {
  chainFirstTaskEitherKW,
  ReaderTaskEither,
} from 'fp-ts/ReaderTaskEither';
import { TaskReportError } from './topic';

export type AlreadyExistsError = 'AlreadyExistsError';
export type WriteNewError = DbWriteError | AlreadyExistsError | TaskDbReadError;

// reaction to a new task; not master data
const writeNewTask = (
  e: TaskEventCreate
): RTE.ReaderTaskEither<
  { get: GetTask; set: SetTask },
  WriteNewError,
  NewTask
> =>
  Reader.asks((deps) =>
    pipe(
      deps.get(e.taskId),
      TE.chainW(
        O.foldW(
          () => {
            const t = {
              state: TASK_STATE_NEW,
              description: e.description,
              id: e.taskId,
            } satisfies NewTask;
            return pipe(
              t,
              deps.set,
              TE.map(() => t)
            );
          },
          () => TE.left('AlreadyExistsError' as const)
        )
      )
    )
  );

type SendEventError = TaskReportError;

type SendCreateEventError = SendEventError;

type CreateError = WriteNewError | SendCreateEventError;

// TODO actor?
export const create = (
  description: string
): RTE.ReaderTaskEither<
  { get: GetTask; set: SetTask; report: ReportTaskEvent },
  CreateError,
  NewTask
> =>
  pipe(
    // create event
    v4(), // assume unique
    S.parseSync(TaskId),
    (id) =>
      ({
        taskId: id,
        type: TASK_EVENT_CREATE,
        description,
        timestamp: Date.now(),
      } satisfies TaskEventCreate),
    sendTaskEvent /* TODO don't care if writeNewTask fails afterwards */,
    RTE.chainW(writeNewTask)
  );

type SendAssignEventError = SendEventError;
type WriteAssignError =
  | DbReadError
  | DbWriteError
  | TaskNotFoundError
  | TaskNotAssignableError;
type TaskNotFoundError = 'TaskNotFoundError';
type AssignError =
  | WriteAssignError
  | TaskNotFoundError
  | SendAssignEventError
  | TaskNotAssignableError;

const writeAssignedTask = (
  e: TaskEventAssign
): RTE.ReaderTaskEither<
  { get: GetTask; set: SetTask },
  WriteAssignError,
  AssignedTask
> =>
  Reader.asks((deps) =>
    pipe(
      deps.get(e.taskId),
      TE.chainW(
        O.foldW(
          () => TE.left('TaskNotFoundError' as const),
          flow(
            assertTaskAssignable,
            TE.fromEither,
            TE.chainW((t) => {
              const updated = {
                ...t,
                state: TASK_STATE_ASSIGNED,
                assignee: e.assignee,
              } satisfies AssignedTask;
              return pipe(
                updated,
                deps.set,
                TE.map(() => updated)
              );
            })
          )
        )
      )
    )
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
export const assign =
  (
    taskId: TaskId,
    assignee: UserId
  ): ReaderTaskEither<
    { get: GetTask; set: SetTask; report: ReportTaskEvent },
    AssignError,
    AssignedTask
  > =>
  (deps) =>
    pipe(
      taskId,
      deps.get,
      TE.chainW(
        O.foldW(
          () => TE.left('TaskNotFoundError' as const),
          flow(
            assertTaskAssignable,
            TE.fromEither,
            TE.chainW((t) => {
              const e = {
                type: TASK_EVENT_ASSIGN,
                taskId: t.id,
                assignee,
                timestamp: Date.now(),
              } satisfies TaskEventAssign;
              return pipe(
                sendTaskEvent(e),
                apply(deps),
                TE.map((e) => ({ e, t }))
              );
            }) /*don't care about write past this point*/,
            TE.chainW(({ e, t }) =>
              pipe(
                e,
                writeAssignedTask,
                apply({
                  get: () => TE.of(some(t)), // cached and in full sync now
                  set: deps.set,
                })
              )
            )
          )
        )
      )
    );
type SendCompleteEventError = SendEventError;

export type ReportTaskEvent = (
  e: TaskEvent
) => TaskEither<SendEventError, typeof e>;

const sendTaskEvent = <E extends TaskEvent>(
  e: E
): ReaderTaskEither<{ report: ReportTaskEvent }, SendCompleteEventError, E> =>
  Reader.asks((deps) =>
    pipe(
      deps.report(e),
      TE.map(() => e)
    )
  );

type WriteCompleteError =
  | DbWriteError
  | TaskDbReadError
  | TaskNotFoundError
  | TaskNotCompletableError;

// TODO actor?
const writeCompletedTask = (
  e: TaskEventComplete
): RTE.ReaderTaskEither<
  { get: GetTask; set: SetTask },
  WriteCompleteError,
  CompletedTask
> =>
  Reader.asks((deps) =>
    pipe(
      deps.get(e.taskId),
      TE.chainW(
        O.foldW(
          () => TE.left('TaskNotFoundError' as const),
          flow(
            assertTaskCompletable,
            TE.fromEither,
            TE.chainW((t) => {
              const updated = {
                ...t,
                state: TASK_STATE_COMPLETED,
              } satisfies CompletedTask;
              return pipe(
                updated,
                deps.set,
                TE.map(() => updated)
              );
            })
          )
        )
      )
    )
  );

TE.tryCatchK(
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
  | TaskNotCompletableError
  | TaskCompletePermissionError;

const assertTaskCompletable = (
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

type TaskCompletePermissionError = 'TaskCompletePermissionError';

const assertCanComplete =
  (actor: UserId) =>
  (
    task: CompletableTask
  ): Either<TaskCompletePermissionError, CompletableTask> => {
    if (task.assignee === actor) {
      return E.right(task);
    }
    return E.left('TaskCompletePermissionError' as const);
  };

export const complete =
  (
    actor: UserId,
    taskId: TaskId
  ): ReaderTaskEither<
    { get: GetTask; set: SetTask; report: ReportTaskEvent },
    CompleteError,
    CompletedTask
  > =>
  (deps) =>
    pipe(
      taskId,
      deps.get,
      TE.chainW(
        O.foldW(
          () => TE.left('TaskNotFoundError' as const),
          flow(
            assertTaskCompletable,
            E.chainW(assertCanComplete(actor)),
            TE.fromEither,
            TE.chainW((t: CompletableTask) => {
              const e = {
                type: TASK_EVENT_COMPLETE,
                taskId: t.id,
                timestamp: Date.now(),
              } satisfies TaskEventComplete;
              return pipe(
                sendTaskEvent(e),
                apply(deps),
                TE.map((e) => ({ e, t }))
              );
            }) /*don't care about write past this point*/,
            TE.chainW(({ e, t }) =>
              pipe(
                writeCompletedTask(e),
                apply({
                  get: () => TE.of(some(t)), // cached and in full sync now
                  set: deps.set,
                })
              )
            )
          )
        )
      )
    );
