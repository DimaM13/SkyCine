
import sys, re

with open('server/src/services/ffmpeg.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace first useFmp4 block
code = re.sub(
    r'const isHevc = media\.videoCodec === \'hevc\' \|\| media\.videoCodec === \'h265\';\s*const isRoomSession = /_r\[a-zA-Z0-9\]/\.test\(sessionId\.split\(\'_apple\'\)\.pop\(\) \|\| sessionId\.split\(\'_pc\'\)\.pop\(\) \|\| \'\'\);\s*let useFmp4: boolean;\s*if \(isRoomSession && !isHevc\) {\s*// Watch Together \+ H\.264: force mpegts for ALL devices to ensure identical PTS\s*useFmp4 = false;\s*} else {\s*useFmp4 = !isApple \|\| isHevc; // Normal: PC gets fmp4, iPad gets mpegts \(except HEVC\)\s*}',
    r'''const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVpxOrAv1 = media.videoCodec === 'vp8' || media.videoCodec === 'vp9' || media.videoCodec === 'av1';
    const isRoomSession = /_r[a-zA-Z0-9]/.test(sessionId.split('_apple').pop() || sessionId.split('_pc').pop() || '');
    let useFmp4: boolean;
    if (isRoomSession && !isHevc && !isVpxOrAv1) {
      // Watch Together + H.264: force mpegts for ALL devices to ensure identical PTS
      useFmp4 = false;
    } else {
      useFmp4 = !isApple || isHevc || isVpxOrAv1; // Normal: PC gets fmp4, iPad gets mpegts (except HEVC/VPx/AV1)
    }''',
    code
)

# Replace second useFmp4 block (in getFakeVodPlaylist)
code = re.sub(
    r'const isHevc = media\.videoCodec === \'hevc\' \|\| media\.videoCodec === \'h265\';\s*const isApple = sessionId\.includes\(\'_apple\'\);\s*const isRoomSession = /_r\[a-zA-Z0-9\]/\.test\(sessionId\.split\(\'_apple\'\)\.pop\(\) \|\| sessionId\.split\(\'_pc\'\)\.pop\(\) \|\| \'\'\);\s*const canCopyVideo = sessionId\.includes\(\'_qoriginal_\'\);\s*let useFmp4: boolean;\s*if \(isRoomSession && !isHevc\) {\s*// Watch Together \+ H\.264: mpegts for ALL devices \(matches FFmpeg output\)\s*useFmp4 = false;\s*} else {\s*useFmp4 = !isApple \|\| isHevc;\s*}',
    r'''const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVpxOrAv1 = media.videoCodec === 'vp8' || media.videoCodec === 'vp9' || media.videoCodec === 'av1';
    const isApple = sessionId.includes('_apple');
    const isRoomSession = /_r[a-zA-Z0-9]/.test(sessionId.split('_apple').pop() || sessionId.split('_pc').pop() || '');
    const canCopyVideo = sessionId.includes('_qoriginal_');
    let useFmp4: boolean;
    if (isRoomSession && !isHevc && !isVpxOrAv1) {
      // Watch Together + H.264: mpegts for ALL devices (matches FFmpeg output)
      useFmp4 = false;
    } else {
      useFmp4 = !isApple || isHevc || isVpxOrAv1;
    }''',
    code
)

with open('server/src/services/ffmpeg.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)

print('Patched FMP4 logic')

