const { marketKeyFromName } = require('../netlify/functions/run-pick-oneshot.cjs');

const cases = [
  ['Resultado final', 'h2h'],
  ['1X2', 'h2h'],
  ['Moneyline', 'h2h'],
  ['Más/Menos 2.5 goles', 'totals'],
  ['Over 2.5', 'totals'],
  ['Under 2.5', 'totals'],
  ['Ambos equipos marcan', 'btts'],
  ['BTTS', 'btts'],
];

for (const [name, exp] of cases) {
  const got = marketKeyFromName(name);
  if (got !== exp) {
    throw new Error(`Mapping "${name}" -> ${got}, expected ${exp}`);
  }
}

console.log('OK: market mapping');
