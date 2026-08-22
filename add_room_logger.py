import re

with open('server/src/controllers/rooms.controller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace console.error with logger.error, and console.log with logger.info
if "import { logger }" not in code:
    code = "import { logger } from '../services/logger.service';\n" + code

code = re.sub(r'console\.error\((.*?)\);', r'logger.error(\'ROOM_ERR\', \1);', code)
code = re.sub(r'console\.log\((.*?)\);', r'logger.info(\'ROOM_LOG\', \1);', code)

with open('server/src/controllers/rooms.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code)
