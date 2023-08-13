import * as S from '@effect/schema/Schema';
import { UserId } from '@monorepo/kafka-users-common';

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
export const TaskId = S.UUID.pipe(S.brand(TaskIdBrand));
export type TaskId = S.To<typeof TaskId>;
export const WithId = S.struct({
  id: TaskId,
});
export type WithId = S.To<typeof WithId>;
export const WithDescription = S.struct({
  description: S.string,
});

// TODO updatedAt; what is updatedAt? TODO stateUpdatedAt

export const TaskCommons = WithId.pipe(S.extend(WithDescription));
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

export const TASK_EVENT_CREATE = 'Create' as const;
export const TASK_EVENT_ASSIGN = 'Assign' as const;
export const TASK_EVENT_COMPLETE = 'Complete' as const;

export const TASK_EVENT_FSM_KEYS = [
  TASK_EVENT_ASSIGN,
  TASK_EVENT_COMPLETE,
] as const;

export const TASK_EVENTS_KEYS = [
  TASK_EVENT_CREATE,
  ...TASK_EVENT_FSM_KEYS,
] as const;

export type TaskEventKey = (typeof TASK_EVENTS_KEYS)[number];

export const TaskEventCommons = S.struct({
  taskId: TaskId,
  timestamp: S.number.pipe(S.int(), S.nonNegative()),
});

export const TaskEventCreate = TaskEventCommons.pipe(
  S.extend(
    S.struct({
      type: S.literal(TASK_EVENT_CREATE),
      title: S.string,
      description: S.string,
    })
  )
);

export type TaskEventCreate = S.To<typeof TaskEventCreate>;

const MonetaryAmount = S.number.pipe(S.int(), S.nonNegative());
const MonetaryAmountPositive = MonetaryAmount.pipe(S.positive());

export const TaskEventAssign = TaskEventCommons.pipe(
  S.extend(
    S.struct({
      type: S.literal(TASK_EVENT_ASSIGN),
      assignee: UserId,
      price: MonetaryAmountPositive,
    })
  )
);

export type TaskEventAssign = S.To<typeof TaskEventAssign>;

export const TaskEventComplete = TaskEventCommons.pipe(
  S.extend(
    S.struct({
      type: S.literal(TASK_EVENT_COMPLETE),
      reward: MonetaryAmountPositive,
    })
  )
);

export type TaskEventComplete = S.To<typeof TaskEventComplete>;

export const TaskEvent = S.union(
  TaskEventAssign,
  TaskEventComplete,
  TaskEventCreate
);
export type TaskEvent = S.To<typeof TaskEvent>;

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
