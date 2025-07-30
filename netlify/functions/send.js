
exports.handler = async (event, context) => {
  try {
    const data = JSON.parse(event.body);

    const message = `
📢 *Nuevo Pronóstico Enviado*

🎯 *Deporte:* ${data.sport}
⚽ *Evento:* ${data.event}
🗓️ *Fecha:* ${data.date}
🎲 *Tipo de Apuesta:* ${data.bettype}
💰 *Cuota:* ${data.odds}
📊 *Confianza:* ${data.confidence}

📝 *Análisis Breve:*
${data.brief}

🔒 *EXCLUSIVO VIP*

📚 *Análisis Detallado:*
${data.detailed}

🎯 *Apuestas Alternativas:*
${data.alternatives}

🏦 *Bookie Sugerida:* ${data.bookie}
📈 *Valor Detectado:* ${data.value}
🕐 *Consejo de Timing:* ${data.timing}

🧾 *Notas:*
${data.notes}
`;

    const telegramUrl = `https://api.telegram.org/bot8494607323:AAHjK3wF_lk4EFojFyoaoOcVbhVrn3_OdCQ/sendMessage`;

    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: "-1002861902996",
        text: message,
        parse_mode: "Markdown"
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error("Telegram error: " + result.description);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Pronóstico enviado correctamente" })
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Error interno: " + error.message })
    };
  }
};
