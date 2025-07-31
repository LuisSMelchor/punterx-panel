const equiposMexicanos = [
  "América", "Chivas", "Tigres", "Monterrey", "Pumas", "Cruz Azul", "Pachuca",
  "León", "Toluca", "Santos Laguna", "Atlas", "Querétaro", "Mazatlán", "Necaxa", "Tijuana", "Juárez"
];

const seleccionesFavoritas = [
  "Mexico", "Argentina", "Brazil", "USA", "France", "Germany", "Spain", "Colombia", "Chile", "Uruguay"
];

// Convierte una hora tipo "14:30" a minutos desde medianoche
function horaToMinutos(hora) {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// Convierte un datetime tipo "2025-08-01T19:00:00Z" a minutos CDMX
function utcToMinCDMX(datetime) {
  const fecha = new Date(datetime);
  const offsetCDMX = -6 * 60; // UTC-6
  return fecha.getUTCHours() * 60 + fecha.getUTCMinutes() + offsetCDMX;
}

function partidoEnRango(fixture, minInicio, minFin) {
  const minCDMX = utcToMinCDMX(fixture.fixture.date);
  return minCDMX >= minInicio && minCDMX <= minFin;
}

function buscarPartidoPrioritario(fixtures, horaInicio, horaFin) {
  const minInicio = horaToMinutos(horaInicio);
  const minFin = horaToMinutos(horaFin);

  // 1. Partidos en México
  const enMexico = fixtures.find(f =>
    partidoEnRango(f, minInicio, minFin) &&
    f.league.country === "Mexico"
  );
  if (enMexico) return enMexico;

  // 2. Equipos mexicanos en torneos
  const equipoMX = fixtures.find(f =>
    partidoEnRango(f, minInicio, minFin) &&
    (equiposMexicanos.includes(f.teams.home.name) || equiposMexicanos.includes(f.teams.away.name))
  );
  if (equipoMX) return equipoMX;

  // 3. Partidos de selecciones
  const selecciones = fixtures.find(f =>
    partidoEnRango(f, minInicio, minFin) &&
    (seleccionesFavoritas.includes(f.teams.home.name) || seleccionesFavoritas.includes(f.teams.away.name)) &&
    f.league.name.toLowerCase().includes("cup") // Ej: World Cup, Gold Cup, etc.
  );
  if (selecciones) return selecciones;

  // 4. Sudamérica (Argentina, Brasil, Colombia...)
  const sudamericanos = fixtures.find(f =>
    partidoEnRango(f, minInicio, minFin) &&
    ["Argentina", "Brazil", "Colombia", "Chile", "Uruguay"].includes(f.league.country)
  );
  if (sudamericanos) return sudamericanos;

  // 5. Cualquier otro dentro del rango
  const cualquierOtro = fixtures.find(f => partidoEnRango(f, minInicio, minFin));
  return cualquierOtro || null;
}

module.exports = { buscarPartidoPrioritario };
