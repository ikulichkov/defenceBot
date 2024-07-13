import fs from 'fs'
import { exec } from 'child_process'
import { Telegraf } from 'telegraf'
import dotenv from 'dotenv'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

dotenv.config()

// Настройки бота и белого списка IP
const token = process.env.TELEGRAM_BOT_TOKEN
const chatId = process.env.TELEGRAM_CHAT_ID
const whitelistIPs = process.env.WHITELISTED_IPS.split(',')

const bot = new Telegraf(token)

// Определение пути к лог-файлу в зависимости от ОС
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logFilePath = os.platform() === 'win32' ? path.join(__dirname, 'auth.log') : '/var/log/auth.log'

// Максимальное количество отображаемых заблокированных IP
const maxBlockedIPs = Math.min(Math.max(parseInt(process.env.MAX_BLOCKED_IPS || 10), 5), 50)

// Функция для отправки сообщения
const sendMessage = (ip) => {
    bot.telegram.sendMessage(chatId, `Обнаружен логин с IP: ${ip}`, {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: 'Заблокировать IP',
                        callback_data: `block_ip_${ip}`
                    },
                    {
                        text: 'Разблокировать IP',
                        callback_data: `unblock_ip_${ip}`
                    }
                ]
            ]
        }
    })
}

// Обработка логина
const handleLogin = (line) => {
    const regex = /sshd\[.*\]: Accepted .* for .* from (.*) port/
    const match = regex.exec(line)
    if (match) {
        const ip = match[1]
        if (!whitelistIPs.includes(ip)) {
            sendMessage(ip)
        }
    }
}

// Чтение логов в реальном времени
fs.watchFile(logFilePath, (curr, prev) => {
    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) throw err
        const lines = data.split('\n')
        lines.forEach(handleLogin)
    })
})

// Обработка callback запроса от бота
bot.on('callback_query', (ctx) => {
    const action = ctx.callbackQuery.data
    const blockMatch = action.match(/^block_ip_(.*)$/)
    const unblockMatch = action.match(/^unblock_ip_(.*)$/)

    if (blockMatch) {
        const ip = blockMatch[1]
        exec(`sudo fail2ban-client set sshd banip ${ip}`, (err, stdout, stderr) => {
            if (err) {
                ctx.reply(`Ошибка при блокировке IP: ${stderr}`)
            } else {
                ctx.reply(`IP ${ip} заблокирован.`)
            }
        })
    }

    if (unblockMatch) {
        const ip = unblockMatch[1]
        exec(`sudo fail2ban-client set sshd unbanip ${ip}`, (err, stdout, stderr) => {
            if (err) {
                ctx.reply(`Ошибка при разблокировке IP: ${stderr}`)
            } else {
                ctx.reply(`IP ${ip} разблокирован.`)
            }
        })
    }
})

// Функция для чтения времени блокировки из лога fail2ban
const getBanTimes = (callback) => {
    fs.readFile('/var/log/fail2ban.log', 'utf8', (err, data) => {
        if (err) {
            callback(err)
            return
        }

        const banTimes = {}
        const lines = data.split('\n')
        lines.forEach(line => {
            const match = line.match(/.*fail2ban.actions.* Ban (.*)$/)
            if (match) {
                const ip = match[1]
                const date = new Date(line.split(' ')[0])
                banTimes[ip] = date.toLocaleString()
            }
        })

        callback(null, banTimes)
    })
}

// Команда для отображения заблокированных IP
bot.command('blocked_ips', (ctx) => {
    exec('sudo fail2ban-client status sshd', (err, stdout, stderr) => {
        if (err) {
            ctx.reply(`Ошибка при получении заблокированных IP: ${stderr}`)
            return
        }

        const ipListMatch = stdout.match(/Banned IP list:\s+([\s\S]+)/)
        if (!ipListMatch) {
            ctx.reply('Нет заблокированных IP-адресов.')
            return
        }

        const ips = ipListMatch[1].trim().split(/\s+/)
        const blockedIPs = ips.slice(0, maxBlockedIPs)

        if (blockedIPs.length === 0) {
            ctx.reply('Нет заблокированных IP-адресов.')
            return
        }

        getBanTimes((err, banTimes) => {
            if (err) {
                ctx.reply(`Ошибка при получении времени блокировки: ${err}`)
                return
            }

            const replyText = blockedIPs.map((ip, index) => {
                const date = banTimes[ip] || 'Неизвестно'
                return `${index + 1}. IP: ${ip} - Заблокирован: ${date}`
            }).join('\n')

            const inlineKeyboard = blockedIPs.map(ip => [
                {
                    text: `Разблокировать ${ip}`,
                    callback_data: `unblock_ip_${ip}`
                }
            ])

            ctx.reply(replyText, {
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            })
        })
    })
})

// Обновление команд бота при старте
const desiredCommands = [
    { command: 'start', description: 'Начать работу с ботом' },
    { command: 'blocked_ips', description: 'Показать заблокированные IP' }
]
await updateBotCommands(desiredCommands)

async function updateBotCommands(desiredCommands) {
    try {
        const currentCommands = await bot.telegram.getMyCommands()

        const commandsToRemove = currentCommands.filter(
            cmd => !desiredCommands.some(desiredCmd => desiredCmd.command === cmd.command)
        )

        const commandsToAdd = desiredCommands.filter(
            desiredCmd => !currentCommands.some(cmd => cmd.command === desiredCmd.command)
        )

        if (commandsToRemove.length > 0) {
            await bot.telegram.deleteMyCommands()
        }

        if (commandsToAdd.length > 0 || commandsToRemove.length > 0) {
            await bot.telegram.setMyCommands(desiredCommands)
        }

    } catch (e) {
        console.error('Ошибка при обновлении команд бота', e)
    }
}

bot.launch()
