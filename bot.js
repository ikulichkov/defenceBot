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
    const closeSessionMatch = action.match(/^close_session_(.*)$/)
    const closeAndBlockMatch = action.match(/^close_and_block_(.*)$/)

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

    if (closeSessionMatch) {
        const ip = closeSessionMatch[1]
        exec(`sudo pkill -f "sshd: ${ip}"`, (err, stdout, stderr) => {
            if (err) {
                ctx.reply(`Ошибка при закрытии сессии: ${stderr}`)
            } else {
                ctx.reply(`Сессия с IP ${ip} закрыта.`)
            }
        })
    }

    if (closeAndBlockMatch) {
        const ip = closeAndBlockMatch[1]
        exec(`sudo pkill -f "sshd: ${ip}" && sudo fail2ban-client set sshd banip ${ip}`, (err, stdout, stderr) => {
            if (err) {
                ctx.reply(`Ошибка при закрытии сессии и блокировке IP: ${stderr}`)
            } else {
                ctx.reply(`Сессия с IP ${ip} закрыта и IP заблокирован.`)
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
            const match = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ fail2ban.actions\s+\[\d+\]: NOTICE\s+\[sshd\] Ban (.*)$/)
            if (match) {
                const date = match[1]
                const ip = match[2]
                banTimes[ip] = date
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

// Команда для отображения успешных логинов и текущих сессий
bot.command('logins', (ctx) => {
    exec('last -n 10', (err, lastStdout, lastStderr) => {
        if (err) {
            ctx.reply(`Ошибка при получении истории логинов: ${lastStderr}`)
            return
        }

        exec('who', (err, whoStdout, whoStderr) => {
            if (err) {
                ctx.reply(`Ошибка при получении текущих сессий: ${whoStderr}`)
                return
            }

            const replyText = `
История успешных логинов:
\`\`\`
${lastStdout.trim()}
\`\`\`

Текущие сессии:
\`\`\`
${whoStdout.trim()}
\`\`\`
            `

            const inlineKeyboard = whoStdout.split('\n').filter(line => line.trim()).map(line => {
                const match = line.match(/(\S+)\s+.*\(([\d.]+)\)/)
                if (match) {
                    const user = match[1]
                    const ip = match[2]
                    return [
                        {
                            text: `Закрыть соединение ${ip}`,
                            callback_data: `close_session_${ip}`
                        },
                        {
                            text: `Закрыть и заблокировать ${ip}`,
                            callback_data: `close_and_block_${ip}`
                        }
                    ]
                }
                return []
            })

            ctx.reply(replyText, {
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                },
                parse_mode: 'Markdown'
            })
        })
    })
})

// Обновление команд бота при старте
const desiredCommands = [
    { command: 'blocked_ips', description: 'Показать заблокированные IP' },
    { command: 'logins', description: 'Показать успешные логины и текущие сессии' }
]
updateBotCommands(desiredCommands)

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
