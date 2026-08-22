files = ['server/src/controllers/media.controller.ts', 'server/src/controllers/stream.controller.ts']
for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        code = f.read()
    if 'import { logger }' not in code:
        code = "import { logger } from '../services/logger.service';\n" + code
    with open(file, 'w', encoding='utf-8') as f:
        f.write(code)
