const { spawn } = require('child_process');

const filePath = 'd:/Фильмы/Хроники Шаннары (1 сезон - 10 серий из 10) (2016) WEBRip-AVC. Rus, Eng/The.Shannara.Chronicles.S01E01.WEBRip-AVC.Rus.Eng.mkv';

function testSeek(seekTime) {
  const args = [
    '-accurate_seek',
    '-ss', seekTime.toString(),
    '-i', filePath,
    '-t', '3',
    '-map', '0:v:0',
    '-map', '0:1',
    '-c:v', 'h264_nvenc',
    '-preset', 'p1',
    '-tune', 'ull',
    '-cq', '19',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
    '-g', '48',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-af', 'aresample=async=1:first_pts=0',
    '-avoid_negative_ts', 'make_zero',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    '-y',
    'd:/MyPlex/test_seek_sync.mp4'
  ];

  console.log('Running test seek for', seekTime, 'seconds...');
  const t0 = Date.now();
  const proc = spawn('ffmpeg', args, { windowsHide: true });
  proc.on('close', (code) => {
    console.log(`Seek test finished in ${Date.now() - t0}ms with code ${code}`);
    const probe = spawn('ffprobe', ['-show_streams', '-show_format', 'd:/MyPlex/test_seek_sync.mp4']);
    let out = '';
    probe.stdout.on('data', d => out += d);
    probe.on('close', () => {
      console.log('Probe output:\n', out.split('\n').filter(l => l.includes('start_time') || l.includes('duration')).join('\n'));
    });
  });
}

testSeek(125.5);
