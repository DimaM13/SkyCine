
with open('server/src/controllers/stream.controller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

old_block = '''        if (!media) {
          res.status(404).send('Media not found');
          return;
        }
  
        const playlist = ffmpegService.generateVodPlaylist(media, sessionId, token, startTime);'''

new_block = '''        if (!media) {
          res.status(404).send('Media not found');
          return;
        }
  
        const startTime = req.query.startTime ? parseFloat(req.query.startTime as string) : 0;
        const playlist = ffmpegService.generateVodPlaylist(media, sessionId, token, startTime);'''

code = code.replace(old_block, new_block)

with open('server/src/controllers/stream.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code)

