'use strict';
exports.handler = async function () {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: "{\"ok\":true,\"ping\":\"scheduler_bridge_v2 (minimal)\"}"
  };
};
