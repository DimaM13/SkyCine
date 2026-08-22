with open('server/src/controllers/rooms.controller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

import re
code = re.sub(r'\} catch \(err\) \{\s*res\.status', r'} catch (err) {\n      logger.error(\'ROOM_ERR\', \'API Error:\', err);\n      res.status', code)

with open('server/src/controllers/rooms.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code)
