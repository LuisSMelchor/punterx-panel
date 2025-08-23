'use strict';
exports.handler = async (event) => {
  try {
    const qs = (event && event.queryStringParameters) || {};
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok:true, stage:'run2.smoke', debug: qs.debug === '1' })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok:false, stage:'run2.catch', error:String(e && (e.message||e)) })
    };
  }
};
