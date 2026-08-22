with open('server/src/services/socket.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

import re

# Since the previous run stripped the backticks and variables, I need to match the broken one to replace it!
broken_conn = "      logger.info('SOCKET', `New client connected:  (IP: )`);"

old_conn = """    io.on('connection', (socket: Socket) => {
      logger.info('SOCKET', `New client connected:  (IP: )`);

      socket.onAny((event, ...args) => {
        if (event !== 'sync:ping' && event !== 'room:host_heartbeat' && event !== 'room:buffer_status' && event !== 'room:request_host_sync') {
          logger.info('SOCKET_IN', `[] received: `, args);
        } else {
          // Log ping/heartbeats only in debug so we don't spam the info console
          logger.debug('SOCKET_IN_PING', `[] received: `, args);
        }
      });

      socket.onAnyOutgoing((event, ...args) => {
        if (event !== 'sync:pong' && event !== 'room:buffer_update' && event !== 'room:host_time_reply') {
          logger.info('SOCKET_OUT', `[] emitted: `, args);
        }
      });"""

new_conn = """    io.on('connection', (socket: Socket) => {
      logger.info('SOCKET', `New client connected: ${socket.id} (IP: ${socket.handshake.address})`);

      socket.onAny((event, ...args) => {
        if (event !== 'sync:ping' && event !== 'room:host_heartbeat' && event !== 'room:buffer_status' && event !== 'room:request_host_sync') {
          logger.info('SOCKET_IN', `[${socket.id}] received: ${event}`, args);
        } else {
          // Log ping/heartbeats only in debug so we don't spam the info console
          logger.debug('SOCKET_IN_PING', `[${socket.id}] received: ${event}`, args);
        }
      });

      socket.onAnyOutgoing((event, ...args) => {
        if (event !== 'sync:pong' && event !== 'room:buffer_update' && event !== 'room:host_time_reply') {
          logger.info('SOCKET_OUT', `[${socket.id}] emitted: ${event}`, args);
        }
      });"""

if broken_conn in code:
    code = code.replace(old_conn, new_conn)
else:
    # Fallback if I got the original string
    code = code.replace("    io.on('connection', (socket: Socket) => {", new_conn)

with open('server/src/services/socket.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)
