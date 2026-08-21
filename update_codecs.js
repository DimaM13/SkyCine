
const fs = require('fs');

let clientCode = fs.readFileSync('client/src/components/player/CustomPlayer.tsx', 'utf-8');

const targetDirectPlay = \  const isDirectPlay = useMemo(() => {
    const ext = (media.filePath || '').toLowerCase();
    const isNativeContainer = ext.endsWith('.mp4') || ext.endsWith('.m4v') || ext.endsWith('.webm');
    if (!isNativeContainer || selectedQuality !== 'original') return false;

    // Multi-track audio files must use HLS so FFmpeg delivers exactly one isolated audio track
    if (audioTracks.length > 1) {
      return false;
    }

    if (isAppleDevice) {
      const selectedTrack = audioTracks[0];
      const codec = (selectedTrack?.codec || media.audioCodec || '').toLowerCase();
      const isNativeAppleAudio = ['aac', 'mp3', 'opus', 'ac3', 'eac3', 'alac'].some(c => codec.includes(c));
      return isNativeAppleAudio;
    } else {
      const isNativeAudio = media.audioCodec === 'aac' || media.audioCodec === 'mp3' || media.audioCodec === 'opus';
      return isNativeAudio;
    }
  }, [media.filePath, media.audioCodec, selectedQuality, audioTracks, isAppleDevice]);\;

const repDirectPlay = \  const isDirectPlay = useMemo(() => {
    const ext = (media.filePath || '').toLowerCase();
    const isNativeContainer = ext.endsWith('.mp4') || ext.endsWith('.m4v') || ext.endsWith('.webm');
    if (!isNativeContainer || selectedQuality !== 'original') return false;

    // Multi-track audio files must use HLS so FFmpeg delivers exactly one isolated audio track
    if (audioTracks.length > 1) {
      return false;
    }

    const rawVideoCodec = (media.videoCodec || 'h264').toLowerCase();
    const supportedVideoCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'];
    if (!supportedVideoCodecs.includes(rawVideoCodec)) {
      return false;
    }

    if (isAppleDevice) {
      const selectedTrack = audioTracks[0];
      const codec = (selectedTrack?.codec || media.audioCodec || '').toLowerCase();
      const isNativeAppleAudio = ['aac', 'mp3', 'opus', 'ac3', 'eac3', 'alac', 'flac'].some(c => codec.includes(c));
      return isNativeAppleAudio;
    } else {
      const selectedTrack = audioTracks[0];
      const codec = (selectedTrack?.codec || media.audioCodec || '').toLowerCase();
      const isNativePcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'].some(c => codec.includes(c));
      return isNativePcAudio;
    }
  }, [media.filePath, media.videoCodec, media.audioCodec, selectedQuality, audioTracks, isAppleDevice]);\;

clientCode = clientCode.replace(targetDirectPlay, repDirectPlay);

const targetStreamMode = \  // Stream mode status for user transparency
  const streamMode = useMemo(() => {
    const selectedTrackObj = audioTracks.find(t => t.streamIndex === selectedAudioTrack) || audioTracks[0];
    const rawAudioCodec = (selectedTrackObj?.codec || media.audioCodec || 'aac').toLowerCase();
    const rawVideoCodec = (media.videoCodec || 'h264').toLowerCase();

    // Apple supports AC3/EAC3/AAC/MP3 natively. PC/Android browsers only support AAC/MP3 natively.
    const isDirectAudio = isAppleDevice
      ? (rawAudioCodec.includes('aac') || rawAudioCodec.includes('ac3') || rawAudioCodec.includes('eac3') || rawAudioCodec.includes('mp3') || rawAudioCodec.includes('alac'))
      : (rawAudioCodec === 'aac' || rawAudioCodec === 'mp3');

    const isSupportedVideoCodec = rawVideoCodec === 'h264' || rawVideoCodec === 'hevc' || rawVideoCodec === 'h265';\;

const repStreamMode = \  // Stream mode status for user transparency
  const streamMode = useMemo(() => {
    const selectedTrackObj = audioTracks.find(t => t.streamIndex === selectedAudioTrack) || audioTracks[0];
    const rawAudioCodec = (selectedTrackObj?.codec || media.audioCodec || 'aac').toLowerCase();
    const rawVideoCodec = (media.videoCodec || 'h264').toLowerCase();

    const appleAudioCodecs = ['aac', 'ac3', 'eac3', 'mp3', 'alac', 'opus', 'flac'];
    const pcAudioCodecs = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'];

    const isDirectAudio = isAppleDevice
      ? appleAudioCodecs.some(c => rawAudioCodec.includes(c))
      : pcAudioCodecs.some(c => rawAudioCodec.includes(c));

    const isSupportedVideoCodec = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'].includes(rawVideoCodec);\;

clientCode = clientCode.replace(targetStreamMode, repStreamMode);
fs.writeFileSync('client/src/components/player/CustomPlayer.tsx', clientCode);

let serverCode = fs.readFileSync('server/src/services/ffmpeg.service.ts', 'utf-8');

const targetServerCodecs = \    // Check if video can be directly stream-copied without re-encoding (Lossless Direct Stream Copy)
    const isSupportedCodec = media.videoCodec === 'h264' || media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const canCopyVideo = quality === 'original' && isSupportedCodec;

    let trackAudioCodec = media.audioCodec?.toLowerCase() || '';
    if (audioIndex > 0) {
      try {
        const track = db.prepare('SELECT codec FROM media_tracks WHERE mediaItemId = ? AND streamIndex = ?').get(media.id, audioIndex) as { codec: string } | undefined;
        if (track?.codec) {
          trackAudioCodec = track.codec.toLowerCase();
        }
      } catch (e) {}
    }

    const isAppleNativeAudio = trackAudioCodec.includes('aac') || trackAudioCodec.includes('ac3') || trackAudioCodec.includes('eac3') || trackAudioCodec.includes('mp3') || trackAudioCodec.includes('alac');
    const isPcNativeAudio = trackAudioCodec === 'aac' || trackAudioCodec === 'mp3';
    const canCopyAudio = isApple ? isAppleNativeAudio : isPcNativeAudio;\;

const repServerCodecs = \    // Check if video can be directly stream-copied without re-encoding (Lossless Direct Stream Copy)
    const supportedVideoCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'];
    const isSupportedCodec = supportedVideoCodecs.includes(media.videoCodec?.toLowerCase() || '');
    const canCopyVideo = quality === 'original' && isSupportedCodec;

    let trackAudioCodec = media.audioCodec?.toLowerCase() || '';
    if (audioIndex > 0) {
      try {
        const track = db.prepare('SELECT codec FROM media_tracks WHERE mediaItemId = ? AND streamIndex = ?').get(media.id, audioIndex) as { codec: string } | undefined;
        if (track?.codec) {
          trackAudioCodec = track.codec.toLowerCase();
        }
      } catch (e) {}
    }

    const appleAudio = ['aac', 'ac3', 'eac3', 'mp3', 'alac', 'opus', 'flac'];
    const pcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'];
    const isAppleNativeAudio = appleAudio.some(c => trackAudioCodec.includes(c));
    const isPcNativeAudio = pcAudio.some(c => trackAudioCodec.includes(c));
    const canCopyAudio = isApple ? isAppleNativeAudio : isPcNativeAudio;\;

serverCode = serverCode.replace(targetServerCodecs, repServerCodecs);

const targetServerFmp4 = \    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isApple = sessionId.includes('_apple');
    const isRoomSession = /_r[a-zA-Z0-9]/.test(sessionId.split('_apple').pop() || sessionId.split('_pc').pop() || '');

    let useFmp4: boolean;
    if (isRoomSession && !isHevc) {
      // Watch Together + H.264: mpegts for ALL devices (matches FFmpeg output)
      useFmp4 = false;
    } else {
      useFmp4 = !isApple || isHevc;
    }\;

const repServerFmp4 = \    const isHevc = media.videoCodec === 'hevc' || media.videoCodec === 'h265';
    const isVpxOrAv1 = media.videoCodec === 'vp8' || media.videoCodec === 'vp9' || media.videoCodec === 'av1';
    const isApple = sessionId.includes('_apple');
    const isRoomSession = /_r[a-zA-Z0-9]/.test(sessionId.split('_apple').pop() || sessionId.split('_pc').pop() || '');

    let useFmp4: boolean;
    if (isHevc || isVpxOrAv1) {
      // Modern codecs require fragmented MP4 (fMP4) for HLS. MPEG-TS doesn't officially support VP9/AV1.
      useFmp4 = true;
    } else if (isRoomSession) {
      // Watch Together + H.264: mpegts for ALL devices (matches FFmpeg output)
      useFmp4 = false;
    } else {
      useFmp4 = !isApple;
    }\;

serverCode = serverCode.replace(targetServerFmp4, repServerFmp4);
fs.writeFileSync('server/src/services/ffmpeg.service.ts', serverCode);

console.log('Update complete.');

