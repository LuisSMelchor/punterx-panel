'use strict';
exports.handler = async function () {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: "{\"ok\":true,\"ping\":\"autopick_vip_scheduler (minimal)\"}"
  };
};
