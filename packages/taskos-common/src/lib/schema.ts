import * as S from '@effect/schema/Schema';
import { MonetaryAmount, MonetaryAmountPositive, UserId } from '@monorepo/utils';

const TaskIdBrand = Symbol.for('TaskId');
export const TaskId = S.UUID.pipe(S.brand(TaskIdBrand));
export type TaskId = S.To<typeof TaskId>;
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
export const CURRENT_TASK_EVENT_CREATE_VERSION = 2;
export const CURRENT_TASK_EVENT_ASSIGN_VERSION = 1;
export const CURRENT_TASK_EVENT_COMPLETE_VERSION = 1;
export const TASK_EVENT_CURRENT_VERSIONS = {
  [TASK_EVENT_CREATE]: CURRENT_TASK_EVENT_CREATE_VERSION,
  [TASK_EVENT_ASSIGN]: CURRENT_TASK_EVENT_ASSIGN_VERSION,
  [TASK_EVENT_COMPLETE]: CURRENT_TASK_EVENT_COMPLETE_VERSION,
} as const satisfies {
  [k in TaskEventKey]: number;
};
export const VersionNumber = S.number.pipe(S.int(), S.positive());
export type VersionNumber = S.To<typeof VersionNumber>;
export const TaskEventCommons = S.struct({
  taskId: TaskId,
  timestamp: S.number.pipe(S.int(), S.nonNegative()),
  version: VersionNumber, // no brand
});

export const TaskEventCreateV1 = TaskEventCommons.pipe(
  S.extend(
    S.struct({
      type: S.literal(TASK_EVENT_CREATE),
      price: MonetaryAmountPositive,
      title: S.string,
      description: S.string,
      version: S.literal(1),
    })
  )
);
export const JiraIdBrand = Symbol.for('JiraId');
export const JiraId = S.string.pipe(
  S.pattern(/^[A-Z]+-[0-9]+$/),
  S.brand(JiraIdBrand)
);
export type JiraId = S.To<typeof JiraId>;
export const tryJiraId = S.parseOption(JiraId);
export const TaskEventCreateV2 = TaskEventCommons.pipe(
  S.extend(
    S.struct({
      type: S.literal(TASK_EVENT_CREATE),
      price: MonetaryAmountPositive,
      // no [ or ] in title
      title: S.string.pipe(S.pattern(/^[^\[\]]+$/)),
      description: S.string,
      jiraId: JiraId,
      version: S.literal(TASK_EVENT_CURRENT_VERSIONS[TASK_EVENT_CREATE]),
    })
  )
);
export const TaskEventCreate = S.union(TaskEventCreateV1, TaskEventCreateV2);
export type TaskEventCreate = S.To<typeof TaskEventCreate>;

export const TaskEventAssignV1 = TaskEventCommons.pipe(
  S.extend(
    S.struct({
      type: S.literal(TASK_EVENT_ASSIGN),
      assignee: UserId,
      version: S.literal(CURRENT_TASK_EVENT_ASSIGN_VERSION),
      price: MonetaryAmountPositive,
    })
  )
);
export const TaskEventAssign = S.union(TaskEventAssignV1);
export type TaskEventAssign = S.To<typeof TaskEventAssign>;
export const TaskEventCompleteV1 = TaskEventCommons.pipe(
  S.extend(
    S.struct({
      type: S.literal(TASK_EVENT_COMPLETE),
      reward: MonetaryAmountPositive,
      version: S.literal(CURRENT_TASK_EVENT_COMPLETE_VERSION),
      userId: UserId,
    })
  )
);
export const TaskEventComplete = S.union(TaskEventCompleteV1);
export type TaskEventComplete = S.To<typeof TaskEventComplete>;
export const TaskEvent = S.union(
  TaskEventAssign,
  TaskEventComplete,
  TaskEventCreate
);
export type TaskEvent = S.To<typeof TaskEvent>;

// TODO again, extra package needed here but no boilerplate until hw is done

const UserAccountsCUDCommons = S.struct({
  type: S.literal('UserAccountsCUD'),
  version: VersionNumber, // no brand
  userId: UserId,
  timestamp: S.number.pipe(S.int(), S.nonNegative()),
});

export const UserAccountsStateCUDV1 = S.struct({
  balance: MonetaryAmount,
});

export const UserAccountsCUDV1 = UserAccountsCUDCommons.pipe(S.extend(
  S.struct({
    previous: UserAccountsStateCUDV1,
    current: UserAccountsStateCUDV1
  })
));

export const UserAccountsCUD = S.union(UserAccountsCUDV1);
export type UserAccountsCUD = S.To<typeof UserAccountsCUD>;
