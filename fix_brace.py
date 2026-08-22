
with open('client/src/components/player/CustomPlayer.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

old_end = '''    } else {
      video.src = url;
      video.load();
      if (shouldPlay) {
        video.play().catch(() => {});
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
    }
  }, [videoRef]);'''

code = code.replace(old_end, new_end)

with open('client/src/components/player/CustomPlayer.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

