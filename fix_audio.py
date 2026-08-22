with open('server/src/services/ffmpeg.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

old_c = "const appleAudio = ['aac', 'ac3', 'eac3', 'mp3', 'alac', 'opus', 'flac'];"
new_c = "const appleAudio = ['aac', 'ac3', 'eac3', 'mp3', 'alac']; // Removed opus and flac"
code = code.replace(old_c, new_c)

with open('server/src/services/ffmpeg.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)
