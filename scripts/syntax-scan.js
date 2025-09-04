const fs = require('fs');
const parser = require('@babel/parser');

const file = process.argv[2];
if (!file) { console.error('Uso: node scripts/syntax-scan.js <ruta/archivo.js>'); process.exit(1); }

const src = fs.readFileSync(file,'utf8');
try {
  parser.parse(src, {
    sourceType: 'script',
    errorRecovery: false,
    allowReturnOutsideFunction: true,
    plugins: ['optionalChaining','nullishCoalescingOperator','bigInt','numericSeparator','logicalAssignment']
  });
  console.log('✅ Sin errores de sintaxis.');
} catch (e) {
  const {loc} = e;
  console.log(`❌ Babel: ${e.message}`);
  if (loc) {
    const lines = src.split('\n');
    const a = Math.max(1, loc.line-3), b = Math.min(lines.length, loc.line+3);
    console.log(`-- ${file} ${a}-${b} -> ${loc.line}:${loc.column} --`);
    for (let i=a;i<=b;i++) console.log((i===loc.line?'>>':'  '), String(i).padStart(5), lines[i-1]);
  }
  process.exit(1);
}
