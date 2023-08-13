> Мы отдали часть системы из авторизации и таск трекера бизнесу. Спустя 15 минут бизнес попросил внести необходимые доработки после фидбэка.
> Во время работы с таск трекером, мы поняли, что попуги часто в title задачи пишут конструкцию [jira-id] - Title (Пример: "UBERPOP-42 — Поменять оттенок зелёного на кнопке"). В результате чего поэтому нам необходимо разделить title на два поля: title (string) + jira_id (string). При этом, для всех новых событий, необходимо убедиться что jira-id не присутствует в title. Для этого достаточно сделать валидацию на наличие квадратных скобок (] или [)

> Поправить события на отправку задач в событиях и поменять код в сервисах

✅

> Расписать процесс миграции на новую логику

✅

Мы здесь предположим, что поле `version` уже было у всех событий: `1`.

Тогда, у нас довольно простая миграция "для бедных":

1. общая схема лежит в общедоступной библиотеке

- замечание: схема настолько для бедных, что это парсер-комбинаторы на тайпскрипте; в более лучшем случае я бы имел либо генерацию JSON schema/avro из/в них, или параллельную тулзу для генерации просто типов и ассерт этих типов против моих compile-time типов из парсер-комбинаторов

[![goodenough](./goodenough.jpeg)](Good enough)

2. Клиенты читают и парсят версию 1; мы пишем схему версии 2 и добавляем её в discriminated union

`export const TaskEventCreate = S.union(TaskEventCreateV1, TaskEventCreateV2);` [ref](../../packages/inventory-common/src/lib/schema.ts)

3. Клиенты перестают компилиться; от компилятора мы знаем каждое место, где используется Union `TaskEventCreate`

3.1) Добавляем в клиентов хендлинг нового формата наряду со старым, деплоим клиентов

```
// example consumer code for task events
const consumeTaskEvent = async (taskEvent: TaskEvent) =>
  match(taskEvent)
    .with(
      {
        type: TASK_EVENT_CREATE,
      },
      (t_) =>
        match(t_)
          .with(
            {
              version: 1,
            },
            (t) => {
              const v: 1 = t.version;
              // @ts-expect-error-next-line
              const j: never = t.jiraId;
            }
          )
          .with(
            {
              version: 2,
            },
            (t) => {
              const v: 2 = t.version;
              const j: JiraId = t.jiraId;
            }
          )
          .exhaustive()
    )
    .with(
      {
        type: TASK_EVENT_ASSIGN,
      },
      (t_) => {
        const v: 1 = t_.version;
        const a: UserId = t_.assignee;
      }
    )
    .with(
      {
        type: TASK_EVENT_COMPLETE,
      },
      (t_) => {
        const v: 1 = t_.version;
        const r: number = t_.reward;
      }
    )
    .exhaustive();

```

(.exhaustive() отвечает за "я упаль если не все варианты покрыты")

4. мигрируем продусеров на новый формат, деплоим продюсеров

5. красота

> Выбрать формат сериализации данных и схемы. На выбор: avro, protobuf или json/xml schema.

В моём варианте для бедных это language-locked формат (что не рекомендует книга с кабаном!). Если нужны ещё языки, мы просто пишем параллельную схему в Avro (json вариант) и генерируем из неё типы, ассертя с парсерами; или генерируем схема в/из самих парсеров

> Выбрать реализацию schema registry и эволюции данных. Можно взять готовое решение (http://github.com/davydovanton/event_schema_registry), а можно написать свое.

monorepo common library + discriminated unions + exhaustive match
