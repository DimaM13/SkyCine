
with open('server/src/controllers/stream.controller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

import re
code = re.sub(
    r'const playlist = ffmpegService\.generateVodPlaylist\(media, sessionId, token, startTime\);',
    r'const startT = req.query.startTime ? parseFloat(req.query.startTime as string) : 0;\n      const playlist = ffmpegService.generateVodPlaylist(media, sessionId, token, startT);',
    code
)

with open('server/src/controllers/stream.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code)

