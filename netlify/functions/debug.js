exports.handler = async () => ({
  statusCode: 200,
  body: JSON.stringify({
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    ALL_ENV: Object.keys(process.env)
  })
});

