with open('server/src/controllers/stream.controller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

import re

if "import { logger }" not in code:
    code = code.replace("import ffmpegService", "import { logger } from '../services/logger.service';\nimport ffmpegService")

code = re.sub(
    r'console\.error\(\"\[CRITICAL ERROR\] HLS failed!\", err\);',
    r'logger.error(\"HLS_CRITICAL\", \"HLS failed!\", err);',
    code
)

with open('server/src/controllers/stream.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code)
