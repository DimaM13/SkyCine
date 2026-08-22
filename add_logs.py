
import re

with open('server/src/services/ffmpeg.service.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Log FFmpeg arguments
old_spawn = '''const proc = spawn(ffmpegPath, args, { windowsHide: true });'''
new_spawn = '''console.log([FFmpeg-DEBUG] Spawning FFmpeg with args: );
      const proc = spawn(ffmpegPath, args, { windowsHide: true });'''
code = code.replace(old_spawn, new_spawn)

# Log FFmpeg stdout/stderr
old_stderr = '''proc.stderr?.on('data', (d) => {
        const msg = d.toString();'''
new_stderr = '''proc.stderr?.on('data', (d) => {
        const msg = d.toString();
        // console.log([FFmpeg-STDERR] ); // Uncomment to see EVERYTHING, but let's log fatal things
        if (msg.includes('Error') || msg.includes('Invalid') || msg.includes('failed')) {
           console.log([FFmpeg-ERROR] );
        }'''
code = code.replace(old_stderr, new_stderr)

# Log FFmpeg exit
old_exit = '''console.log([Continuous HLS] session  exited (code: ));'''
new_exit = '''console.log([Continuous HLS] session  exited (code: ). StartTime was: . Was killed? );'''
code = code.replace(old_exit, new_exit)

with open('server/src/services/ffmpeg.service.ts', 'w', encoding='utf-8') as f:
    f.write(code)

with open('server/src/controllers/stream.controller.ts', 'r', encoding='utf-8') as f:
    code_ctrl = f.read()

# Add log to getHlsMaster
old_master = '''public static async getHlsMaster(req: AuthRequest, res: Response): Promise<void> {
      try {
        const id = req.params.id as string;'''
new_master = '''public static async getHlsMaster(req: AuthRequest, res: Response): Promise<void> {
      try {
        const id = req.params.id as string;
        console.log([HTTP-DEBUG] getHlsMaster called for . query.level=, startTime=);'''
code_ctrl = code_ctrl.replace(old_master, new_master)

with open('server/src/controllers/stream.controller.ts', 'w', encoding='utf-8') as f:
    f.write(code_ctrl)

