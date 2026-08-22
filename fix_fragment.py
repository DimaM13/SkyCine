
import re

with open('client/src/pages/LibraryPage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# First block:
# ) : (
#   <div className="grid grid-cols-1 ...
# ...
#   </div>
#   <InfiniteScroll ... />

code = re.sub(
    r'\) : \(\s*(<div className="grid grid-cols-1[^>]*>.*?</div>\s*<InfiniteScroll.*?(?:/>|<\/InfiniteScroll>))\s*\)',
    r') : (\n          <>\n            \1\n          </>\n        )',
    code,
    flags=re.DOTALL
)

# Second block (shows):
# ) : (
#   <div className="grid grid-cols-2 ...
# ...
#   </div>
#   <InfiniteScroll ... />

code = re.sub(
    r'\) : \(\s*(<div className="grid grid-cols-2[^>]*>.*?</div>\s*<InfiniteScroll.*?(?:/>|<\/InfiniteScroll>))\s*\)',
    r') : (\n          <>\n            \1\n          </>\n        )',
    code,
    flags=re.DOTALL
)

with open('client/src/pages/LibraryPage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

with open('client/src/pages/ShowsPage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = re.sub(
    r'\) : \(\s*(<div className="grid grid-cols-2[^>]*>.*?</div>\s*<InfiniteScroll.*?(?:/>|<\/InfiniteScroll>))\s*\)',
    r') : (\n        <>\n          \1\n        </>\n      )',
    code,
    flags=re.DOTALL
)

with open('client/src/pages/ShowsPage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

