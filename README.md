# NeuroFlow — Telegram Mini App

## Структура проекта

```
neuroflow/
├── index.html          # Главная страница (GitHub Pages)
├── app.js              # Полное приложение (Preact + htm)
├── sw.js               # Service Worker для офлайна
├── manifest.json       # PWA манифест
├── bot/
│   ├── main.py         # Flask backend для пушей (Vercel)
│   └── requirements.txt
└── vercel.json         # Конфигурация Vercel
```

## Фронтенд (GitHub Pages)

### Что нового в этой версии
- **График циклов** — SVG-линейный график за 12 месяцев в статистике
- **Heatmap симптомов** — сетка дни цикла × симптомы с интенсивностью
- **PDF экспорт** — генерация отчёта через jsPDF
- **CloudStorage** — синхронизация между устройствами Telegram
- **Нативные кнопки** — BackButton, MainButton, SettingsButton из Telegram API
- **Исправлена фертильность** — учитывает день после овуляции
- **Палитра в Dashboard** — цвета фаз теперь из пользовательских настроек
- **Service Worker** — работает офлайн после первой загрузки

### Развёртывание на GitHub Pages
1. Создайте репозиторий на GitHub
2. Загрузите `index.html`, `app.js`, `sw.js`, `manifest.json`
3. Включите GitHub Pages в настройках репозитория (ветка `main`, папка `/`)
4. Добавьте иконки `icon-192.png` и `icon-512.png` (можно сгенерировать на favicon.io)

## Бэкенд (бесплатно)

### Вариант 1: Vercel (рекомендуется)
1. Установите Vercel CLI: `npm i -g vercel`
2. В папке `bot/` выполните: `vercel`
3. Установите переменные окружения в панели Vercel:
   - `BOT_TOKEN` — токен вашего бота от @BotFather
   - `CRON_SECRET` — случайная строка для защиты cron
4. Полученный URL (например, `https://your-bot.vercel.app`) — это ваш бэкенд

### Вариант 2: PythonAnywhere
1. Зарегистрируйтесь на pythonanywhere.com (бесплатный аккаунт)
2. Загрузите `main.py` и `requirements.txt`
3. Настройте Flask app в WSGI
4. Для cron используйте планировщик задач PythonAnywhere

### Вариант 3: cron-job.org + Vercel (бесплатно и без сна)
1. Задеплойте backend на Vercel
2. Зарегистрируйтесь на cron-job.org
3. Создайте cron job: `GET https://your-bot.vercel.app/api/cron`
4. В Header добавьте: `Authorization: Bearer YOUR_CRON_SECRET`
5. Настройте расписание: каждый день в 9:00

## Настройка бота в Telegram

1. Напишите @BotFather, создайте бота
2. Отправьте `/newapp` → выберите бота → введите название
3. В поле URL вставьте адрес вашего GitHub Pages
4. Описание бота (для BotFather):

```
NeuroFlow — нейро-гормональный трекер цикла.

Адаптирует рекомендации по работе, спорту, питанию и интимности под вашу фазу. Визуальный календарь, статистика, персональные цвета, чек-ин самочувствия и экспорт данных.

Команды:
/start — Открыть приложение
```

## Подключение пуш-уведомлений

В `app.js` найдите `register` в настройках и добавьте вызов к вашему бэкенду:

```js
fetch('https://your-bot.vercel.app/api/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: tg.initDataUnsafe.user.id,
    settings: store.getState().notifSettings
  })
});
```

## Лицензия
MIT
