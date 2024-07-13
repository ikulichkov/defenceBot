
# DefenceBot

DefenceBot - это телеграм-бот для отслеживания логинов в Ubuntu и уведомления о входах с неавторизованных IP-адресов с возможностью блокировки IP через fail2ban.

## Требования

- Node.js
- Yarn
- Telegram Bot Token
- fail2ban (для блокировки IP-адресов)

## Установка

1. Клонируйте репозиторий и перейдите в директорию проекта:

   ```sh
   git clone https://github.com/yourusername/defencebot.git
   cd defencebot
   ```

2. Установите зависимости:

   ```sh
   yarn install
   ```

3. Создайте файл `.env` в корневой директории проекта и добавьте ваши настройки:

   ```env
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   TELEGRAM_CHAT_ID=your_telegram_chat_id
   WHITELISTED_IPS=your_white_ip1,your_white_ip2,etc
   ```

## Установка и настройка fail2ban

1. Перейдите в директорию проекта:

   ```sh
   cd defencebot
   ```

2. Сделайте скрипт установки исполняемым и запустите его:

   ```sh
   chmod +x setup_fail2ban.sh
   sudo ./setup_fail2ban.sh
   ```

## Запуск

```sh
yarn start
```

## Команды бота

```sh
/blocked_ips - Показать последние заблокированные IP-адреса.
```

## Скрипт выполнит следующие действия:

- Установит fail2ban.
- Настроит fail2ban для защиты SSH.
- Перезапустит службу fail2ban.

## Структура проекта

- `bot.js` - основной файл бота.
- `setup_fail2ban.sh` - скрипт для установки и настройки fail2ban.
- `.env` - файл для хранения конфиденциальных данных (не включен в репозиторий).
- `auth.log` - тестовый лог-файл для разработки и тестирования на Windows (не используется в продакшн-среде).

## Лицензия
Этот проект лицензируется под лицензией MIT.
