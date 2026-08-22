
with open('client/src/components/player/CustomPlayer.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

target = '''    const isDirectPlay = useMemo(() => {
      const ext = (media.filePath || '').toLowerCase();
      const isNativeContainer = ext.endsWith('.mp4') || ext.endsWith('.m4v') || ext.endsWith('.webm');
      if (!isNativeContainer || selectedQuality !== 'original') return false;'''

replacement = '''    const isDirectPlay = useMemo(() => {
      const ext = (media.filePath || '').toLowerCase();
      let isNativeContainer = ext.endsWith('.mp4') || ext.endsWith('.m4v') || ext.endsWith('.webm');
      if (!isAppleDevice && ext.endsWith('.mkv')) {
        isNativeContainer = true;
      }
      if (!isNativeContainer || selectedQuality !== 'original') return false;'''

if target in code:
    code = code.replace(target, replacement)
else:
    print('Target not found in CustomPlayer.tsx again')

with open('client/src/components/player/CustomPlayer.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

