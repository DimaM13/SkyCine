
import sys

with open('server/src/services/ffmpeg.service.ts', 'r', encoding='utf-8') as f:
    content = f.read()

target = '''    if (cleanStartTime > 0) {
      args.push('-noaccurate_seek', '-ss', cleanStartTime.toString());
    }
    args.push('-i', media.filePath);'''

replacement = '''    // Always pass -ss (even 0) so FFmpeg resets the container PTS to exactly 0.0s for the first segment
    args.push('-noaccurate_seek', '-ss', cleanStartTime.toString());
    args.push('-i', media.filePath);'''

if target in content:
    content = content.replace(target, replacement)
    with open('server/src/services/ffmpeg.service.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Patched successfully!')
else:
    print('Target not found')

