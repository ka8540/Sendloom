const postcss = require('postcss');
const fs = require('fs');
const files = [
  'src/app/globals.css',
  'src/app/landing.module.css',
  'src/app/auth.module.css',
  'src/app/legal.module.css'
];
let bad = 0;
for (const f of files) {
  const css = fs.readFileSync(f, 'utf8');
  try {
    postcss.parse(css, { from: f });
    console.log('OK    ' + f + '  (' + css.split('\n').length + ' lines)');
  } catch (e) {
    bad = 1;
    console.log('FAIL  ' + f + ' -> ' + e.message);
  }
}
process.exit(bad);
