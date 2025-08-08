<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagnóstico PunterX</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #f5f5f5;
      margin: 0;
      padding: 20px;
      color: #333;
    }
    h1 {
      text-align: center;
      color: #2c3e50;
    }
    .card {
      background: white;
      border-radius: 10px;
      padding: 20px;
      margin: 20px auto;
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
      max-width: 800px;
    }
    .status {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
    }
    .status i {
      font-size: 1.2em;
      margin-right: 10px;
    }
    .ok {
      color: green;
    }
    .fail {
      color: red;
    }
    .pending {
      color: orange;
    }
    .section-title {
      margin-top: 30px;
      font-weight: bold;
      font-size: 1.2em;
    }
    .footer {
      text-align: center;
      font-size: 0.9em;
      color: #888;
      margin-top: 40px;
    }
  </style>
  <script>
    async function runDiagnostics() {
      const response = await fetch('/.netlify/functions/diagnostico-total')
      const data = await response.json()

      const fields = [
        ['API-FOOTBALL', data.apiFootball],
        ['OddsAPI', data.oddsAPI],
        ['OpenAI', data.openAI],
        ['Supabase', data.supabase],
        ['Telegram Bot', data.telegram],
        ['Canal conectado', data.channelConnected],
        ['Grupo VIP conectado', data.groupConnected],
        ['Último pick generado', data.lastPick || 'No disponible'],
        ['Autopick ejecutado', data.autopickStatus || 'Sin ejecutar'],
        ['Variables de entorno', data.env || 'Revisar'],
      ]

      const section = document.getElementById('result')

      for (const [label, value] of fields) {
        const div = document.createElement('div')
        div.className = 'status'

        const icon = document.createElement('i')
        if (value === true || value === 'OK') {
          icon.textContent = '✅'
          icon.className = 'ok'
        } else if (value === false || value === 'FAIL') {
          icon.textContent = '❌'
          icon.className = 'fail'
        } else {
          icon.textContent = '🕐'
          icon.className = 'pending'
        }

        const text = document.createElement('span')
        text.textContent = `${label}: ${value}`

        div.appendChild(icon)
        div.appendChild(text)
        section.appendChild(div)
      }
    }

    window.onload = runDiagnostics
  </script>
</head>
<body>
  <h1>🔍 Diagnóstico del sistema PunterX</h1>
  <div class="card">
    <div id="result">
      <p>Cargando estado actual del sistema...</p>
    </div>
  </div>
  <div class="footer">
    PunterX v1.0 – Diagnóstico generado automáticamente<br>
    Última actualización: <span id="date"></span>
  </div>
  <script>
    document.getElementById('date').textContent = new Date().toLocaleString()
  </script>
</body>
</html>
