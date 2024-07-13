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

const sendMessage = (ip) => {
    const keyboard = [
        [
            { text: 'Заблокировать IP', callback_data: `block_ip_${ip}` },
            { text: 'Закрыть соединение', callback_data: `close_session_${ip}` },
            { text: 'Закрыть и заблокировать', callback_data: `close_and_block_${ip}` }
        ]
    ]
    bot.telegram.sendMessage(chatId, `Обнаружен логин с IP: ${ip}`, {
        reply_markup: {
            inline_keyboard: keyboard
        }
    })
}

const blockIP = (ip) => {
    exec(`sudo fail2ban-client set sshd banip ${ip}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`Ошибка при блокировке IP ${ip}: ${stderr}`)
        } else {
            console.log(`IP ${ip} заблокирован.`)
        }
    })
}

const closeSession = (ip, ctx) => {
    exec(`who | grep "${ip}" | awk '{print $2}'`, (err, stdout, stderr) => {
        if (err) {
            ctx.reply(`Ошибка при определении терминала для закрытия сессии: ${stderr}`)
        } else {
            const tty = stdout.trim()
            exec(`sudo pkill -KILL -t ${tty}`, (err, stdout, stderr) => {
                if (err) {
                    ctx.reply(`Ошибка при закрытии сессии: ${stderr}`)
                } else {
                    ctx.reply(`Сессия с терминалом ${tty} закрыта.`)
                }
            })
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
    const ipMatch = action.match(/_(ip|session|and_block)_(.*)$/)
    const ip = ipMatch[2]

    if (action.startsWith('block_ip_')) {
        blockIP(ip)
        ctx.reply(`IP ${ip} заблокирован.`)
    } else if (action.startsWith('close_session_')) {
        closeSession(ip, ctx)
    } else if (action.startsWith('close_and_block_')) {
        closeSession(ip, ctx)
        blockIP(ip)
        ctx.reply(`Сессия с IP ${ip} закрыта и IP заблокирован.`)
    }
})

bot.command('logins', (ctx) => {
    exec('who', (err, whoStdout, whoStderr) => {
        if (err) {
            ctx.reply(`Ошибка при получении текущих сессий: ${whoStderr}`)
            return
        }

        const replyText = `
Текущие сессии:
\`\`\`
${whoStdout.trim()}
\`\`\`
        `
        ctx.reply(replyText, { parse_mode: 'Markdown' })
    })
})

bot.command('recent_logins', (ctx) => {
    exec('last -n 20', (err, lastStdout, lastStderr) => {
        if (err) {
            ctx.reply(`Ошибка при получении истории логинов: ${lastStderr}`)
            return
        }

        const replyText = `
Последние 20 логинов:
\`\`\`
${lastStdout.trim()}
\`\`\`
        `
        ctx.reply(replyText, { parse_mode: 'Markdown' })
    })
})

bot.launch()
