with open('server/src/controllers/media.controller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

import re
if "import { logger }" not in code:
    code = code.replace("import db", "import { logger } from '../services/logger.service';\nimport { db }")

code = re.sub(r'\} catch \(err\) \{\s*res\.status', r'} catch (err) {\n      logger.error(\'MEDIA_ERR\', \'API Error:\', err);\n      res.status', code)
code = re.sub(r'console\.error\((.*?)\);', r'logger.error(\'MEDIA_ERR\', \1);', code)

with open('server/src/controllers/media.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code)
