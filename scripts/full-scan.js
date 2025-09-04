const fs = require('fs');
const parser = require('@babel/parser');

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/full-scan.js <archivo.js>');
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');

function printCtx(source, line, col, msg) {
  const lines = source.split('\n');
  const a = Math.max(1, line - 3), b = Math.min(lines.length, line + 3);
  console.log(`-- ${file} ${a}-${b} -> ${line}:${col} --`);
  for (let i = a; i <= b; i++) {
    const mark = i === line ? '>>' : '  ';
    console.log(mark, String(i).padStart(5), lines[i - 1]);
  }
  console.log("\nMensaje:", msg, "\n");
}

try {
  parser.parse(src, {
    sourceType: 'script',
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    plugins: [
      'optionalChaining',
      'nullishCoalescingOperator',
      'bigInt',
      'numericSeparator',
      'logicalAssignment',
      'topLevelAwait'
    ]
  });
  console.log('✅ Sin errores de sintaxis detectados.');
} catch (e) {
  const { loc } = e;
  console.log(`❌ Babel: ${e.message}`);
  if (loc) printCtx(src, loc.line, loc.column, e.message);
  process.exit(1);
}
