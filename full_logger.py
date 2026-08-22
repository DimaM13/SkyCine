
with open('server/src/services/ffmpeg.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

import re

old_stderr = '''    proc.stderr?.on('data', (d) => {
      const msg = d.toString();
      const isDecoderNoise = msg.includes('Not all references are available') || 
                             msg.includes('Error submitting packet to decoder') || 
                             msg.includes('zero_bit out of range') || 
                             msg.includes('Failed to read frame header') ||
                             msg.includes('Failed to read unit') ||
                             msg.includes('Decoding error: Invalid data');
      if (!isDecoderNoise && (msg.includes('Fatal') || msg.includes('Conversion failed') || msg.includes('Cannot allocate'))) {
        console.error([Continuous HLS stderr] :, msg.trim());
      }
    });'''

new_stderr = '''    proc.stderr?.on('data', (d) => {
      const msg = d.toString();
      
      // We don't want to spam the console with FFmpeg's frame-by-frame progress
      if (msg.startsWith('frame=') || msg.startsWith('size=') || msg.includes('bitrate=')) return;
      
      // Filter out harmless decoder noise that happens on corrupted MKVs but doesn't stop playback
      const isHarmlessNoise = msg.includes('Not all references are available') || 
                              msg.includes('zero_bit out of range') || 
                              msg.includes('Failed to read frame header') ||
                              msg.includes('Failed to read unit');
                              
      if (!isHarmlessNoise) {
        // Log EVERYTHING ELSE from FFmpeg so we never miss a critical error again!
        console.log([FFmpeg LOG - ] );
      }
    });'''

code = code.replace(old_stderr, new_stderr)

old_exit = '''console.log([Continuous HLS] session  exited (code: ));'''
new_exit = '''console.log([Continuous HLS] ?? Session  EXITED (code: ). Was killed manually? );
      if (code !== 0 && !proc.killed) {
        console.error([CRITICAL ERROR] FFmpeg process for  crashed unexpectedly with code ! Check FFmpeg logs above.);
      } else if (code === 0 && !proc.killed) {
        console.warn([WARNING] FFmpeg process for  exited with code 0 (Success) but was NOT killed manually. This usually means it reached the end of the file or encountered a fatal container error that it thought was EOF.);
      }'''

code = code.replace(old_exit, new_exit)

with open('server/src/services/ffmpeg.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)

with open('server/src/controllers/stream.controller.ts', 'r', encoding='utf-8') as f:
    ctrl = f.read()

old_hls_error = '''console.error('[Continuous HLS] getHlsMaster error:', err);'''
new_hls_error = '''console.error([CRITICAL ERROR] getHlsMaster failed for ID . Query:, req.query, 'Error:', err);'''
ctrl = ctrl.replace(old_hls_error, new_hls_error)

old_hls_playlist = '''console.error('[Continuous HLS] getHlsSessionPlaylist error:', err);'''
new_hls_playlist = '''console.error([CRITICAL ERROR] getHlsSessionPlaylist failed for Session . Error:, err);'''
ctrl = ctrl.replace(old_hls_playlist, new_hls_playlist)

old_hls_seg = '''console.error('[Continuous HLS] getHlsSessionSegment error:', err);'''
new_hls_seg = '''console.error([CRITICAL ERROR] getHlsSessionSegment failed for Segment  in Session . Error:, err);'''
ctrl = ctrl.replace(old_hls_seg, new_hls_seg)

with open('server/src/controllers/stream.controller.ts', 'w', encoding='utf-8') as f:
    f.write(ctrl)

