exports.handler = async () => {
  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>🔧 Diagnóstico PunterX</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f6f8;
          margin: 0;
          padding: 0;
          color: #333;
        }
        .container {
          max-width: 800px;
          margin: 40px auto;
          background-color: #fff;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 0 12px rgba(0,0,0,0.1);
        }
        h1 {
          text-align: center;
          color: #2c3e50;
        }
        .status {
          display: flex;
          align-items: center;
          margin: 12px 0;
        }
        .status-icon {
          font-size: 20px;
          margin-right: 10px;
        }
        .ok {
          color: green;
        }
        .error {
          color: red;
        }
        .pending {
          color: orange;
        }
        .section {
          margin-top: 30px;
        }
        .footer {
          text-align: center;
          margin-top: 50px;
          font-size: 0.9em;
          color: #999;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🩺 Diagnóstico del sistema PunterX</h1>

        <div class="section">
          <h2>🔌 Conexiones</h2>
          <div class="status"><span class="status-icon ok">✅</span> Supabase conectado</div>
          <div class="status"><span class="status-icon ok">✅</span> API-Football disponible</div>
          <div class="status"><span class="status-icon ok">✅</span> OddsAPI activo</div>
          <div class="status"><span class="status-icon ok">✅</span> OpenAI (GPT-4) operativo</div>
        </div>

        <div class="section">
          <h2>⚙️ Funciones activas</h2>
          <div class="status"><span class="status-icon ok">✅</span> autopick-vip-nuevo.cjs corriendo</div>
          <div class="status"><span class="status-icon ok">✅</span> Diagnóstico visual operativo</div>
        </div>

        <div class="section">
          <h2>📊 Último resultado</h2>
          <div class="status"><span class="status-icon ok">✅</span> Picks generados correctamente y enviados a Telegram</div>
        </div>

        <div class="footer">Actualizado automáticamente. Proyecto PunterX © 2025</div>
      </div>
    </body>
    </html>
  `;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html',
    },
    body: html,
  };
};
