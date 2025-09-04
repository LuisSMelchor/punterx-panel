'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const __accepted = () => ({ statusCode: 202, body: '' });
const qbool = (v) => v === '1' || v === 'true' || v === 'yes';

exports.handler = async (event, context) => {
  const __send_report = (() => { const en=(String(process.env.SEND_ENABLED)==='1'); const base={ enabled: en, results:(typeof send_report!=='undefined'&&send_report&&Array.isArray(send_report.results))?send_report.results:[] }; if(en&&typeof message_vip!=='undefined'&&message_vip&&!process.env.TG_VIP_CHAT_ID) base.missing_vip_id=true; if(en&&typeof message_free!=='undefined'&&message_free&&!process.env.TG_FREE_CHAT_ID) base.missing_free_id=true; return base; })();
try {
    const rq = eval('require');
    const path = rq('path');
    const fsx  = rq('fs');

    // Localiza el impl igual que el wrapper principal
    let implPath = path.join(__dirname, 'autopick-vip-nuevo-impl.cjs');
    if (!fsx.existsSync(implPath) && process.env.LAMBDA_TASK_ROOT) {
      const alt = path.join(process.env.LAMBDA_TASK_ROOT, 'netlify/functions', 'autopick-vip-nuevo-impl.cjs');
      if (fsx.existsSync(alt)) implPath = alt;
    }

    const impl = rq(implPath);

    // Inyecta auth si es cron o manual (mismo criterio que run2)
    const qs = (event && event.queryStringParameters) || {};
    const isScheduled = !!((event && event.headers) || {})['x-nf-scheduled'];
    const inHeaders = Object.assign({}, (event && event.headers) || {});
    if ((isScheduled || qbool(qs.manual)) && process.env.AUTH_CODE) {
      inHeaders["x-auth"]        = process.env.AUTH_CODE;
      inHeaders["x-auth-code"]   = process.env.AUTH_CODE;
      inHeaders["authorization"] = "Bearer " + process.env.AUTH_CODE;
      inHeaders["x-api-key"]     = process.env.AUTH_CODE;
    }

    const newEvent = Object.assign({}, event, {
      headers: inHeaders,
      queryStringParameters: Object.assign({}, qs, { manual: (isScheduled || qbool(qs.manual)) ? '1' : undefined })
    });

    // Dispara en background y responde 202 inmediatamente
    setTimeout(() => {
      Promise.resolve()
        .then(() => impl.handler(newEvent, context))
        .catch(e => console.error('[bg impl error]', e && (e.stack || e.message || e)));
    }, 0);

    return __accepted();
  } catch (e) {
    console.error('[bg wrapper error]', e && (e.stack || e.message || e));
    // Aún así respondemos 202 para cumplir contrato de background
    return __accepted();
  }
};
