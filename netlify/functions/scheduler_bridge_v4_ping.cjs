'use strict';
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true,"ping":"scheduler_bridge_v4_ping (pong)"}'
});
