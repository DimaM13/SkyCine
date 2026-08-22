
import os

def replace_all(filepath, replacements):
    if not os.path.exists(filepath):
        return
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    for old, new in replacements.items():
        code = code.replace(old, new)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

replace_all('client/src/pages/MoviesPage.tsx', {
    'movies.map((movie)': 'movies.slice(0, visibleCount).map((movie)',
    '  {movies.slice(0, visibleCount).map((movie) => (\n              <MediaCard\n                key={movie.id}\n                media={movie}\n                onOpenDetails={(m) => setSelectedMediaId(m.id)}\n              />\n            ))}\n          </div>': '  {movies.slice(0, visibleCount).map((movie) => (\n              <MediaCard\n                key={movie.id}\n                media={movie}\n                onOpenDetails={(m) => setSelectedMediaId(m.id)}\n              />\n            ))}\n          </div>\n          <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />'
})

replace_all('client/src/pages/ShowsPage.tsx', {
    'shows.map((show, idx)': 'shows.slice(0, visibleCount).map((show, idx)',
    '})}\n          </div>': '})}\n          </div>\n          <InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />'
})

replace_all('client/src/pages/LibraryPage.tsx', {
    'movies.map((vid': 'movies.slice(0, visibleCount).map((vid',
    '})}\n              </div>': '})}\n              </div>\n              <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />'
})

