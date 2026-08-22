
with open('server/src/services/ffmpeg.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

old_func = '''  public generateVodPlaylist(media: MediaItem, sessionId: string, token?: string): string {'''
new_func = '''  public generateVodPlaylist(media: MediaItem, sessionId: string, token?: string, startTime: number = 0): string {'''

code = code.replace(old_func, new_func)

old_m3u8 = '''      m3u8 += #EXT-X-TARGETDURATION:\\n;
      m3u8 += #EXT-X-MEDIA-SEQUENCE:0\\n;
      m3u8 += #EXT-X-PLAYLIST-TYPE:VOD\\n;
      
      if (useFmp4) {'''
new_m3u8 = '''      m3u8 += #EXT-X-TARGETDURATION:\\n;
      m3u8 += #EXT-X-MEDIA-SEQUENCE:0\\n;
      m3u8 += #EXT-X-PLAYLIST-TYPE:VOD\\n;
      
      if (startTime > 0) {
        m3u8 += #EXT-X-START:TIME-OFFSET=\\n;
      }
      
      if (useFmp4) {'''

code = code.replace(old_m3u8, new_m3u8)

with open('server/src/services/ffmpeg.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)

