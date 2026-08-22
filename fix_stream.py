file = 'server/src/controllers/stream.controller.ts'
with open(file, 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('\\"', '"')

with open(file, 'w', encoding='utf-8') as f:
    f.write(code)
