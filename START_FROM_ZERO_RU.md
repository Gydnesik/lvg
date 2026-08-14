# Запуск с нуля — версия 6.3.0

## 1. GitHub
1. Замени содержимое репозитория файлами из этого архива.
2. Commit и push в `main`.
3. Открой Actions → `Deploy Supabase Edge Function`. Дождись зелёного запуска.

В Repository secrets должны быть:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF` = `igbkjkjagkhxpxezjwtj`

## 2. Supabase
1. Открой нужный проект `school-helper`.
2. SQL Editor → выполни целиком `schema.sql`.
3. Edge Functions → Secrets: проверь `GEMINI_API_KEY` и `GEMINI_MODEL`.
4. После успешного GitHub deploy открой Edge Functions → `process-schedule` → Logs.

## 3. Первый вход
1. Зарегистрируй/открой админский аккаунт.
2. Если нужно, выполни:

```sql
update public.profiles
set role = 'admin'
where username = 'ТВОЙ_НИК';
```

## 4. Первая загрузка расписания
1. Войди как admin.
2. Открой Админ-панель.
3. Выбери `.ods`, `.xlsx`, `.xls` или `.csv` размером до 12 МБ.
4. Дождись сообщения `Готово`.
5. Если будет ошибка — сразу открой Supabase → Edge Functions → `process-schedule` → Logs и смотри последнюю запись.

## Что исправлено в 6.1
`process-schedule` больше не создаёт одновременно массив всех обработанных листов. Файл отправляется напрямую как multipart/form-data, рабочая область листа ограничена, а оценка листа выполняется без сборки огромной строки. Это сделано специально после ошибки `Memory limit exceeded`.


### Если видишь `DOMParser is not defined`
Это означает, что задеплоена старая версия функции. В v6.3.0 `DOMParser` полностью удалён. После commit дождись зелёного GitHub Actions и затем повтори загрузку.
