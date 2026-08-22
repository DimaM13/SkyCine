
import os
import re

def replace_all(filepath, replacements):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    for old, new in replacements.items():
        code = code.replace(old, new)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

replace_all('client/src/pages/LibraryPage.tsx', {
    'movies.map((movie) => (': 'movies.slice(0, visibleCount).map((movie) => (',
    'shows.map((show, idx) => (': 'shows.slice(0, visibleCount).map((show, idx) => ('
})

# Let's add InfiniteScroll for those two blocks if they don't have it
def inject_scroll(filepath, regex, replacement):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    code = re.sub(regex, replacement, code, flags=re.DOTALL)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

# For LibraryPage's first grid
inject_scroll('client/src/pages/LibraryPage.tsx',
    r'(movies\.slice\(0, visibleCount\)\.map\(.*?\}\s*\)\s*\}\s*/>\s*\}\s*\)\s*\}\s*</div>)',
    r'\1\n              <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />')

# For LibraryPage's third grid (shows)
inject_scroll('client/src/pages/LibraryPage.tsx',
    r'(shows\.slice\(0, visibleCount\)\.map\(.*?\}\s*\)\s*\}\s*</div>\s*</div>\s*\)\s*\}?\)\s*\}\s*</div>)',
    r'\1\n              <InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />')

