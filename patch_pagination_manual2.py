
import os
import re

def patch(filepath, regex, replacement):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    code = re.sub(regex, replacement, code, flags=re.DOTALL)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

# MoviesPage
patch('client/src/pages/MoviesPage.tsx', 
    r'(movies\.slice\(0, visibleCount\)\.map.*?</MediaCard>.*?\}\).*?</div>)', 
    r'\1\n          <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />')

# ShowsPage
patch('client/src/pages/ShowsPage.tsx', 
    r'(shows\.slice\(0, visibleCount\)\.map.*?</button>.*?\}?\).*?</div>)', 
    r'\1\n          <InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />')

# LibraryPage
patch('client/src/pages/LibraryPage.tsx', 
    r'(movies\.slice\(0, visibleCount\)\.map.*?</LazyImage>.*?</div>.*?</div>.*?\}?\).*?</div>)', 
    r'\1\n              <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />')

