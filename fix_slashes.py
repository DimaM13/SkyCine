import os

files = [
    'server/src/controllers/media.controller.ts',
    'server/src/controllers/rooms.controller.ts',
    'server/src/controllers/stream.controller.ts'
]

for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        code = f.read()
    
    code = code.replace("\\'", "'")
    
    with open(file, 'w', encoding='utf-8') as f:
        f.write(code)
