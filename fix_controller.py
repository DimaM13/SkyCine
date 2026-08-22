
with open('server/src/controllers/stream.controller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

old_call = '''const playlist = ffmpegService.generateVodPlaylist(media, sessionId, token);'''
new_call = '''const playlist = ffmpegService.generateVodPlaylist(media, sessionId, token, startTime);'''

code = code.replace(old_call, new_call)

with open('server/src/controllers/stream.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code)

