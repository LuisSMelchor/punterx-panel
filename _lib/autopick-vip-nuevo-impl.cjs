/**
 * Shim raíz para cron-run2 en runtime Netlify.
 * Reutiliza el motor actual sin duplicar lógica.
 */
module.exports = require('../netlify/functions/autopick-vip-run2.cjs');
