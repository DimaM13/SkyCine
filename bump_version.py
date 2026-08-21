
import json

files = ['package.json', 'client/package.json', 'server/package.json']
for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        data = json.load(file)
    data['version'] = '2.5.0'
    with open(f, 'w', encoding='utf-8') as file:
        json.dump(data, file, indent=2)

with open('client/src/components/layout/Sidebar.tsx', 'r', encoding='utf-8') as file:
    sidebar = file.read()

import re
sidebar = re.sub(r'v2\.\d+\.\d+\s+.*</span>', 'v2.5.0   Apple HLS Fixes</span>', sidebar)

with open('client/src/components/layout/Sidebar.tsx', 'w', encoding='utf-8') as file:
    file.write(sidebar)

print('Updated versions successfully')

