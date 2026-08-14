# Школьный Помощник — mobile PWA + Supabase + Gemini

Готовая мобильная PWA для Android/iOS. Внутри:
- Supabase Auth: ник + пароль;
- роли `user` / `admin`;
- расписание по классам;
- импорт таблиц расписания (.xls/.xlsx/.ods/.csv) через Supabase Edge Function + SheetJS + Gemini;
- админка с загрузкой таблиц, редактированием и удалением расписаний;
- оценки, средний балл и четвертная оценка;
- календарь с локальными заметками;
- светлая/тёмная/авто-тема;
- адаптация под телефоны и safe-area.

## Что изменено в версии 6.1

- Устранён основной источник `Memory limit exceeded` в `process-schedule`: листы таблицы обрабатываются по одному, а не через массив всех CSV/grid одновременно.
- Рабочая область каждого листа ограничена 2500 строками и 80 колонками, чтобы повреждённый/служебный `!ref` не раздувал память.
- Парсер использует `dense` режим и ограничивает число разбираемых строк.
- Оценка листов больше не собирает огромную строку целого листа.
- Браузер отправляет таблицу как `multipart/form-data`, без base64 JSON: запрос стал меньше и Edge Function использует меньше памяти.
- Старая отправка base64 JSON оставлена для обратной совместимости.
- Ошибки чтения файла теперь возвращаются отдельно и понятнее.

## Что изменено в версии 6.0

- Админка принимает `.xls`, `.xlsx`, `.ods`, `.csv` вместо фотографий.
- Бинарная таблица не отправляется в Gemini: Edge Function читает её через SheetJS, раскрывает объединённые ячейки и конвертирует лучший лист в очищенный CSV.
- Новый промт заставляет Gemini игнорировать дежурство/ВПР/примечания, искать только нижнюю основную сетку, читать каждый класс вертикально сверху вниз, сохранять номер урока и время, переносить `-` как `-` и дублировать уроки из объединённых ячеек.
- При успешном импорте `replace_schedules()` атомарно удаляет ВСЕ старые строки `schedules` и вставляет только новое расписание. Старые дни, классы и варианты написания больше не смешиваются с новым файлом.
- Обычный пользователь по-прежнему получает класс из `profiles.class_name`, а `loadSchedule()` выбирает расписание этого класса.
- Для импорта расписания нужно один раз выполнить обновлённый `schema.sql`, чтобы создать RPC `replace_schedules(jsonb)`.

## Что было исправлено раньше (5.2)

- Импорт расписания теперь использует структурированный JSON Gemini.
- Варианты класса `8а`, `8А`, `8 а`, `8 А`, `8-а`, `8A` нормализуются в один ключ `8А`.
- Латинская `B` в OCR для `8B` нормализуется в кириллическую `В` → `8В`.
- Если один класс встречается в таблице несколько раз, его уроки объединяются и дубликаты удаляются.
- Дни недели и номера уроков сортируются стабильно.
- Старые записи в Supabase с разным написанием класса тоже подхватываются приложением.
- Админка показывает каноническое имя класса и умеет удалить все его старые варианты.
- Убран неработающий пункт сброса пароля, который раньше только показывал сообщение.
- Добавлены проверки типа и размера изображения перед отправкой.
- Ошибки Edge Function/Gemini теперь показываются в админке без падения интерфейса.
- Добавлен тест нормализации расписания: `node scripts/test-schedule-normalization.mjs`.
- Импорт таблицы теперь проходит через SheetJS → очищенный CSV → Gemini; исходный бинарный файл в Gemini не отправляется.
- Цель «Хочу 4/5» теперь считается по порогу четвертной оценки: для 4 нужен средний ≥ 3.50, для 5 — ≥ 4.50.
- Исправлен выбор цвета акцента: цвет применяется ко всем основным элементам интерфейса.
- При смене класса в аккаунте расписание сразу перезагружается для нового класса.
- Стиль карточек оценок приведён к компактному виду с отдельными блоками среднего, количества оценок и четвертной оценки.

## 1. Supabase

1. Открой свой проект Supabase.
2. В SQL Editor выполни целиком `schema.sql`.
3. В Authentication → Providers → Email отключи **Confirm email**, если хочешь оставить вход только по нику + паролю без настоящей почты.
4. Зарегистрируй первый аккаунт.
5. Сделай его админом:

```sql
update public.profiles set role = 'admin' where username = 'ТВОЙ_НИК';
```

## 2. Gemini

В Supabase → Edge Functions → Secrets добавь:

- `GEMINI_API_KEY` — ключ Gemini;
- `GEMINI_MODEL` — `gemini-3.6-flash`.

Ключ Gemini не попадает в браузер: запрос идёт через `process-schedule`.

## 3. GitHub Actions

В GitHub → Settings → Secrets and variables → Actions создай:

- `SUPABASE_ACCESS_TOKEN` — Personal Access Token Supabase;
- `SUPABASE_PROJECT_REF` — `igbkjkjagkhxpxezjwtj`.

`SUPABASE_PROJECT_REF` также указан в `supabase/config.toml`, поэтому это не пароль и его можно использовать как обычный project ref.

После push в `main`:

- `.github/workflows/deploy-supabase-function.yml` задеплоит `process-schedule`;
- GitHub Pages публикует PWA отдельным workflow, если он включён в репозитории.

Для GitHub Pages: Settings → Pages → Source = **GitHub Actions**.

## 4. Где взять `SUPABASE_ACCESS_TOKEN`

В Supabase открой Account → Access Tokens и создай Personal Access Token. Сам токен никому не отправляй и не добавляй в репозиторий.

Для локальной работы можно выполнить:

```bash
export SUPABASE_ACCESS_TOKEN='ТВОЙ_PERSONAL_ACCESS_TOKEN'
supabase link --project-ref igbkjkjagkhxpxezjwtj
```

Для GitHub Actions достаточно сохранить токен как secret с именем `SUPABASE_ACCESS_TOKEN`.

## 5. Где взять `SUPABASE_PROJECT_REF`

Project ref — это идентификатор проекта. В этой версии он уже стоит в:

```text
supabase/config.toml
```

Значение:

```text
igbkjkjagkhxpxezjwtj
```

Если когда-нибудь проект поменяется, замени это значение и GitHub Actions secret `SUPABASE_PROJECT_REF`.

## 6. Проверка перед публикацией

```bash
node scripts/test-schedule-normalization.mjs
node scripts/test-schedule-merge.mjs
node scripts/test-grade-goals.mjs
node --check /tmp/app.js
node --experimental-strip-types --check supabase/functions/process-schedule/index.ts
```

`node --check index.html` напрямую не является валидной командой для HTML, поэтому для проверки JS из `index.html` можно использовать небольшой extraction-скрипт или открыть приложение в браузере. В архиве JS уже дополнительно проверен через `node --check` после извлечения script-блока.

## Оценки

Четвертная оценка округляется по школьному правилу: `3.50 → 4`, `3.49 → 3`, `4.50 → 5`.

## Календарь

☰ → Календарь. Нажатие на число открывает заметку. Дни с заметкой получают точку, выходные выделяются зелёным. Данные календаря сохраняются локально на устройстве.


## Деплой через GitHub Actions

В проект добавлен workflow `.github/workflows/deploy-supabase-function.yml`.

Он автоматически деплоит `process-schedule` в Supabase при push, если изменились:
- `supabase/functions/process-schedule/**`
- `supabase/config.toml`
- сам workflow.

В GitHub → Settings → Secrets and variables → Actions должны существовать:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

### Первичная настройка базы

Один раз откройте Supabase → SQL Editor и выполните `schema.sql` из этого проекта. В нём есть функция `public.replace_schedules(jsonb)`, которая атомарно удаляет старое расписание и записывает новое.

### После установки

1. Замените файлы проекта этим архивом.
2. Сделайте commit и push в GitHub.
3. Откройте GitHub → Actions → `Deploy Supabase Edge Function`.
4. Дождитесь зелёного выполнения.
5. В Supabase → Edge Functions → `process-schedule` проверьте новый deployment.
6. После этого загрузите таблицу через админку.

Важно: `schema.sql` не выполняется GitHub Actions автоматически. Выполните его один раз вручную в SQL Editor.


## v6.4.0 — XML parser fix

Edge Function больше не использует `DOMParser`, которого нет в Supabase Edge/Deno runtime. ODS/XLSX разбираются лёгким специализированным XML-токенизатором без DOM. Это исправляет ошибку `DOMParser is not defined`.

### Важное исправление импорта расписания

`process-schedule` больше не использует Gemini для определения координат классов и строк уроков. Основная сетка извлекается детерминированно из реальных индексов столбцов ODS/XLSX:

- выбирается последний реальный заголовок классов на листе, а верхний служебный/учительский блок игнорируется;
- класс привязан к конкретному индексу столбца на весь блок, поэтому после 6-го/7-го/8-го урока он физически не может переключиться на соседний класс;
- горизонтальные объединённые ячейки распространяются на все покрытые классы;
- для XLSX дополнительно читаются `mergeCell` диапазоны;
- последние уроки (7–15) читаются так же, как первые, без отдельного лимита на 6 уроков;
- кабинет и предмет извлекаются из исходной ячейки без модельного угадывания;
- перед записью выполняются три проверки: совпадение количества непустых ячеек по каждому классу/дню, проверка диапазонов/дубликатов и финальная повторная нормализация.

Для регрессионной проверки:

```bash
node --experimental-strip-types scripts/test-schedule-grid.mjs
node --experimental-strip-types scripts/test-grade-goals.mjs
node --experimental-strip-types scripts/test-schedule-merge.mjs
node --experimental-strip-types scripts/test-schedule-normalization.mjs
node --experimental-strip-types --check supabase/functions/process-schedule/index.ts
```
