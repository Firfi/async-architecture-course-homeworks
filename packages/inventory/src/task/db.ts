// TODO persist
import { AssignedTask, Task, TASK_STATE_ASSIGNED } from './model';
import { TaskEither } from 'fp-ts/TaskEither';
import * as TE from 'fp-ts/TaskEither';
import { Option } from 'fp-ts/Option';
import * as O from 'fp-ts/Option';
import * as A from 'fp-ts/Array';
import { flow } from 'fp-ts/function';
import { TaskId } from '@monorepo/inventory-common/schema';

export type DbReadError = 'DbReadError';
export type DbWriteError = 'DbWriteError';
export type TaskDbReadError = DbReadError;
export type GetTask = (id: TaskId) => TaskEither<TaskDbReadError, Option<Task>>;
export type TaskDbWriteError = DbWriteError;
export type SetTask = (t: Task) => TaskEither<TaskDbWriteError, void>;

export const tasksStorage: Map<TaskId, Task> = new Map();

export const get: GetTask = (id) => TE.of(O.fromNullable(tasksStorage.get(id)));

export const set: SetTask = (t) => {
  tasksStorage.set(t.id, t);
  return TE.of(undefined);
};

export const list = (): TaskEither<TaskDbReadError, Task[]> =>
  TE.of(Array.from(tasksStorage.values()));

export const listAssigned = flow(
  list,
  TE.map(
    A.filterMap((t) => (t.state === TASK_STATE_ASSIGNED ? O.some(t) : O.none))
  )
);
