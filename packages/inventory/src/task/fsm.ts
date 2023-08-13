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
import prand, { uniformIntDistribution } from 'pure-rand';
import { flow, pipe, tupled } from 'fp-ts/function';
import {
  tasksStorage,
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
  TASK_STATE_ASSIGNED,
  TASK_STATE_COMPLETED,
  TASK_STATE_NEW,
} from './model';
import { some } from 'fp-ts/Option';
import { apply } from 'fp-ts/function';
import { ReaderTaskEither } from 'fp-ts/ReaderTaskEither';
import { TaskReportError } from './topic';
import { uuidToNumberUnsafe } from '@monorepo/utils';
import { RandomGenerator } from 'pure-rand/lib/types/generator/RandomGenerator';
import { State } from 'fp-ts/State';
import * as ST from 'fp-ts/State';
import * as IO from 'fp-ts/IO';
import {
  JiraId,
  TASK_EVENT_ASSIGN,
  TASK_EVENT_COMPLETE,
  TASK_EVENT_CREATE,
  TASK_EVENT_CURRENT_VERSIONS,
  TaskEvent,
  TaskEventAssign,
  TaskEventComplete,
  TaskEventCreate,
  TaskId,
} from '@monorepo/inventory-common/schema';

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
              price: e.price,
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

const initTaskCreateEvent = (
  title: string,
  jiraId: JiraId,
  description: string
): TaskEventCreate =>
  pipe(
    S.parseSync(TaskId)(v4()),
    flow((id) =>
      pipe(id, makeTaskCreatePrice, (price) => ({
        taskId: id,
        price: Number(price),
        type: TASK_EVENT_CREATE,
        title,
        jiraId,
        description,
        timestamp: Date.now(),
        version: TASK_EVENT_CURRENT_VERSIONS[TASK_EVENT_CREATE],
      }))
    )
  );

// bigints cause js has no ints
const ASSIGN_PRICE_MIN = BigInt(10);
const ASSIGN_PRICE_MAX = BigInt(20);

const COMPLETE_REWARD_MIN = BigInt(20);
const COMPLETE_REWARD_MAX = BigInt(40);

// non-random random, because we can
const rngFromTaskId = (taskId: TaskId) =>
  prand.xoroshiro128plus(uuidToNumberUnsafe(taskId));

// priceRngs.get(taskId) || rngFromTaskId(taskId)
const makeTaskPrice_ = (
  min: BigInt,
  max: BigInt
): State<RandomGenerator, BigInt> =>
  ST.map(BigInt)((g) => uniformIntDistribution(Number(min), Number(max), g));

const makeTaskPrice =
  (min: BigInt, max: BigInt) =>
  (taskId: TaskId): BigInt => {
    const rng = rngFromTaskId(taskId); // priceRngs.get(taskId) || rngFromTaskId(taskId);
    const [price, ignoredRng2_] = makeTaskPrice_(min, max)(rng);
    return price;
  };

const makeTaskCreatePrice = makeTaskPrice(ASSIGN_PRICE_MIN, ASSIGN_PRICE_MAX);
const makeTaskCompleteReward = makeTaskPrice(
  COMPLETE_REWARD_MIN,
  COMPLETE_REWARD_MAX
);

// TODO actor?
export const create = (
  title: string,
  jiraId: JiraId,
  description: string
): RTE.ReaderTaskEither<
  { get: GetTask; set: SetTask; report: ReportTaskEvent },
  CreateError,
  NewTask
> =>
  pipe(
    [title, jiraId, description],
    tupled(initTaskCreateEvent),
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

const makeTaskAssignEvent =
  (assignee: UserId) =>
  (taskId: TaskId, currentPrice: number): TaskEventAssign => ({
    type: TASK_EVENT_ASSIGN,
    taskId,
    assignee,
    timestamp: Date.now(),
    version: TASK_EVENT_CURRENT_VERSIONS[TASK_EVENT_ASSIGN],
    price: currentPrice,
  });

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
            TE.chainW((t) =>
              pipe(
                makeTaskAssignEvent(assignee)(t.id, t.price),
                sendTaskEvent,
                apply(deps),
                TE.map((e) => ({ e, t }))
              )
            ) /*don't care about write past this point*/,
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

const makeTaskCompleteEvent = (
  taskId: TaskId,
  userId: UserId
): TaskEventComplete =>
  pipe(makeTaskCompleteReward(taskId), (reward) => ({
    type: TASK_EVENT_COMPLETE,
    taskId,
    userId,
    timestamp: Date.now(),
    reward: Number(reward),
    version: TASK_EVENT_CURRENT_VERSIONS[TASK_EVENT_COMPLETE],
  }));

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
            TE.chainW((t: CompletableTask) =>
              pipe(
                [t.id, actor],
                tupled(makeTaskCompleteEvent),
                sendTaskEvent,
                apply(deps),
                TE.map((e) => ({ e, t }))
              )
            ) /*don't care about write past this point*/,
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
