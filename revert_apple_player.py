
with open('client/src/components/player/CustomPlayer.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

old_block = '''    } else {
      const isVpxOrAv1Codec = media.videoCodec === 'vp9' || media.videoCodec === 'vp8' || media.videoCodec === 'av1';
      // iPad Safari supports MediaSource (MSE). Native AVPlayer has a 30s timeout for VP9 HLS.
      // By forcing hls.js on iPad for VP9, we bypass AVPlayer and instantly invoke WebKit's software decoder!
      const needsHlsJsFallback = isAppleDevice && isVpxOrAv1Codec && Hls.isSupported();

      if (isAppleDevice && video.canPlayType('application/vnd.apple.mpegurl') && !needsHlsJsFallback) {'''

new_block = '''    } else if (isAppleDevice && video.canPlayType('application/vnd.apple.mpegurl')) {'''

code = code.replace(old_block, new_block)

old_hls_comment = '''        // PC Chrome / Edge / Firefox / Android (and iPad for VP9) via Hls.js MediaSource Extensions'''
new_hls_comment = '''      // PC Chrome / Edge / Firefox / Android via Hls.js MediaSource Extensions'''

code = code.replace(old_hls_comment, new_hls_comment)

# I also need to remove the extra closing brace I added earlier.
# Wait, let's just do a regex for the closing brace at the end of the loadStreamSource block.

old_end = '''    } else {
      video.src = url;
      video.load();
      if (shouldPlay) {
        video.play().catch(() => {});
      }
    }
    }
  }, [videoRef]);'''

new_end = '''    } else {
      video.src = url;
      video.load();
      if (shouldPlay) {
        video.play().catch(() => {});
      }
    }
  }, [videoRef]);'''

code = code.replace(old_end, new_end)

with open('client/src/components/player/CustomPlayer.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

