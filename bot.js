import fs from 'fs'
import { exec } from 'child_process'
import { Telegraf } from 'telegraf'
import dotenv from 'dotenv'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

dotenv.config()

const token = process.env.TELEGRAM_BOT_TOKEN
const chatId = process.env.TELEGRAM_CHAT_ID
const whitelistIPs = process.env.WHITELISTED_IPS.split(',')

const bot = new Telegraf(token)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const logFilePath = os.platform() === 'win32' ? path.join(__dirname, 'auth.log') : '/var/log/auth.log'

const maxBlockedIPs = Math.min(Math.max(parseInt(process.env.MAX_BLOCKED_IPS || 10), 5), 50)

const sendMessage = (ip, blocked = false) => {
    const keyboard = [
        [{ text: 'Заблокировать IP', callback_data: `block_ip_${ip}` }]
    ]
    if (blocked) {
        keyboard[0].push({ text: 'Разблокировать IP', callback_data: `unblock_ip_${ip}` })
    }
    bot.telegram.sendMessage(chatId, `Обнаружен логин с IP: ${ip}`, {
        reply_markup: {
            inline_keyboard: keyboard
        }
    })
}

const blockIP = (ip) => {
    exec(`sudo ufw deny from ${ip}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`Ошибка при блокировке IP ${ip}: ${stderr}`)
        } else {
            console.log(`IP ${ip} заблокирован.`)
            sendMessage(ip, true)
        }
    })
}

const unblockIP = (ip) => {
    exec(`sudo ufw delete deny from ${ip}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`Ошибка при разблокировке IP ${ip}: ${stderr}`)
        } else {
            console.log(`IP ${ip} разблокирован.`)
            bot.telegram.sendMessage(chatId, `IP ${ip} разблокирован.`)
        }
    })
}

const handleLogin = (line) => {
    const regex = /sshd\[.*\]: Accepted .* for .* from (.*) port/
    const match = regex.exec(line)
    if (match) {
        const ip = match[1]
        if (!whitelistIPs.includes(ip)) {
            sendMessage(ip)
            blockIP(ip)
        }
    }
}

fs.watchFile(logFilePath, (curr, prev) => {
    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) throw err
        const lines = data.split('\n')
        lines.forEach(handleLogin)
    })
})

bot.on('callback_query', (ctx) => {
    const action = ctx.callbackQuery.data
    const blockMatch = action.match(/^block_ip_(.*)$/)
    const unblockMatch = action.match(/^unblock_ip_(.*)$/)
    const closeSessionMatch = action.match(/^close_session_(.*)$/)
    const closeAndBlockMatch = action.match(/^close_and_block_(.*)$/)
    const enableEmergencyMatch = action.match(/^enable_emergency$/)
    const disableEmergencyMatch = action.match(/^disable_emergency$/)

    const executeCommand = (command, successMessage, errorMessage) => {
        exec(command, (err, stdout, stderr) => {
            if (err) {
                ctx.reply(`${errorMessage}: ${stderr}`)
            } else {
                ctx.reply(successMessage)
            }
        })
    }

    if (blockMatch) {
        const ip = blockMatch[1]
        executeCommand(`sudo ufw deny from ${ip}`, `IP ${ip} заблокирован.`, 'Ошибка при блокировке IP')
    }

    if (unblockMatch) {
        const ip = unblockMatch[1]
        executeCommand(`sudo ufw delete deny from ${ip}`, `IP ${ip} разблокирован.`, 'Ошибка при разблокировке IP')
    }

    if (closeSessionMatch) {
        const ip = closeSessionMatch[1]
        exec(`who | grep "${ip}" | awk '{print $2}'`, (err, stdout, stderr) => {
            if (err) {
                ctx.reply(`Ошибка при определении терминала для закрытия сессии: ${stderr}`)
            } else {
                const tty = stdout.trim()
                executeCommand(`sudo pkill -KILL -t ${tty}`, `Сессия с терминалом ${tty} закрыта.`, 'Ошибка при закрытии сессии')
            }
        })
    }

    if (closeAndBlockMatch) {
        const ip = closeAndBlockMatch[1]
        exec(`who | grep "${ip}" | awk '{print $2}'`, (err, stdout, stderr) => {
            if (err) {
                ctx.reply(`Ошибка при определении терминала для закрытия сессии: ${stderr}`)
            } else {
                const tty = stdout.trim()
                exec(`sudo pkill -KILL -t ${tty}`, (err, stdout, stderr) => {
                    if (err) {
                        ctx.reply(`Ошибка при закрытии сессии: ${stderr}`)
                    } else {
                        executeCommand(`sudo ufw deny from ${ip}`, `Сессия с IP ${ip} закрыта и IP заблокирован.`, 'Ошибка при блокировке IP')
                    }
                })
            }
        })
    }

    if (enableEmergencyMatch) {
        executeCommand('sudo ufw default deny incoming && sudo ufw enable', 'Экстренная блокировка включена.', 'Ошибка при включении экстренной блокировки')
    }

    if (disableEmergencyMatch) {
        executeCommand('sudo ufw disable', 'Экстренная блокировка отключена.', 'Ошибка при отключении экстренной блокировки')
    }
})

const getBanTimes = (callback) => {
    fs.readFile('/var/log/ufw.log', 'utf8', (err, data) => {
        if (err) {
            callback(err)
            return
        }

        const banTimes = {}
        const lines = data.split('\n')
        lines.forEach(line => {
            const match = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\д{2}),\d+ ufw\s+\[\д+\]: BLOCK\s+\[sshd\] Ban (.*)$/)
            if (match) {
                const date = match[1]
                const ip = match[2]
                banTimes[ip] = date
            }
        })

        callback(null, banTimes)
    })
}

bot.command('blocked_ips', (ctx) => {
    exec('sudo ufw status', (err, stdout, stderr) => {
        if (err) {
            ctx.reply(`Ошибка при получении заблокированных IP: ${stderr}`)
            return
        }

        const ipListMatch = stdout.match(/To\s+(\d+\.\d+\.\d+\.\d+\/\d+)/)
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
                { text: `Разблокировать ${ip}`, callback_data: `unblock_ip_${ip}` }
            ])

            ctx.reply(replyText, {
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            })
        })
    })
})

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
                const match = line.match(/(\S+)\s+.*\(([\д.]+)\)/)
                if (match) {
                    const user = match[1]
                    const ip = match[2]
                    return [
                        { text: `Закрыть соединение ${ip}`, callback_data: `close_session_${ip}` },
                        { text: `Закрыть и заблокировать ${ip}`, callback_data: `close_and_block_${ip}` }
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

bot.command('emergency', (ctx) => {
    ctx.reply('Выберите действие:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Включить экстренную блокировку', callback_data: 'enable_emergency' }],
                [{ text: 'Отключить экстренную блокировку', callback_data: 'disable_emergency' }]
            ]
        }
    })
})

const desiredCommands = [
    { command: 'blocked_ips', description: 'Показать заблокированные IP' },
    { command: 'logins', description: 'Показать успешные логины и текущие сессии' },
    { command: 'emergency', description: 'Экстренная блокировка всех соединений' }
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
