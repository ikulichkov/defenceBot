#!/bin/bash

# Обновление списка пакетов и установка fail2ban
sudo apt-get update
sudo apt-get install -y fail2ban

# Создание конфигурационного файла для fail2ban
sudo tee /etc/fail2ban/jail.local > /dev/null <<EOL
[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 3

[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
EOL

# Перезапуск службы fail2ban
sudo systemctl restart fail2ban

# Проверка статуса fail2ban
sudo systemctl status fail2ban

echo "Fail2ban установлен и настроен."
