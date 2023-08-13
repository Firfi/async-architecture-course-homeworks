import * as S from '@effect/schema/Schema';
import { UserId } from '@monorepo/kafka-users-common';
import {
  TASK_EVENT_ASSIGN,
  TASK_EVENT_COMPLETE,
  TaskId,
} from '@monorepo/inventory-common/schema';
import { MonetaryAmountPositive } from '@monorepo/utils';

export const TASK_STATE_NEW = 'new' as const;
export const TASK_STATE_ASSIGNED = 'assigned' as const;
export const TASK_STATE_COMPLETED = 'completed' as const;
export const TASK_STATES = [
  TASK_STATE_NEW,
  TASK_STATE_ASSIGNED,
  TASK_STATE_COMPLETED,
] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const WithId = S.struct({
  id: TaskId,
});
export type WithId = S.To<typeof WithId>;
export const WithDescription = S.struct({
  description: S.string,
});

export const WithPrice = S.struct({
  price: MonetaryAmountPositive,
});

// TODO updatedAt; what is updatedAt? TODO stateUpdatedAt

export const TaskCommons = WithId.pipe(
  S.extend(WithDescription),
  S.extend(WithPrice)
);
export const NewTask = TaskCommons.pipe(
  S.extend(
    S.struct({
      state: S.literal(TASK_STATE_NEW),
    })
  )
);
export type NewTask = S.To<typeof NewTask>;
export const AssignedTask = TaskCommons.pipe(
  S.extend(
    S.struct({
      state: S.literal(TASK_STATE_ASSIGNED),
      assignee: UserId,
    })
  )
);
export type AssignedTask = S.To<typeof AssignedTask>;
export const CompletedTask = TaskCommons.pipe(
  S.extend(
    S.struct({
      state: S.literal(TASK_STATE_COMPLETED),
      assignee: UserId,
    })
  )
);
export type CompletedTask = S.To<typeof CompletedTask>;
export const Task = S.union(NewTask, AssignedTask, CompletedTask);
export type Task = S.To<typeof Task>;
export type AssignableTask = NewTask | AssignedTask /*allowed to reassign*/;
export type CompletableTask = AssignedTask;

export const TASK_EVENT_MAP = {
  [TASK_STATE_NEW]: {
    [TASK_EVENT_ASSIGN]: TASK_STATE_ASSIGNED,
  } as const,
  [TASK_STATE_ASSIGNED]: {
    [TASK_EVENT_COMPLETE]: TASK_STATE_COMPLETED,
    [TASK_EVENT_ASSIGN]: TASK_STATE_ASSIGNED,
  } as const,
  [TASK_STATE_COMPLETED]: {} as const,
} as const;

export type TaskEventMap = typeof TASK_EVENT_MAP;
