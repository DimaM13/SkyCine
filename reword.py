
with open('client/src/components/layout/Sidebar.tsx', 'r', encoding='utf-8') as file:
    sidebar = file.read()

import re
sidebar = re.sub(r'v2\.5\.0\s+Apple HLS Fixes</span>', 'v2.5.0   Start Delay Fix</span>', sidebar)

with open('client/src/components/layout/Sidebar.tsx', 'w', encoding='utf-8') as file:
    file.write(sidebar)

