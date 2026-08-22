
import os
import re

def replace_all(filepath, replacements):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    for old, new in replacements.items():
        code = code.replace(old, new)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

replace_all('client/src/pages/MoviesPage.tsx', {
    'import React': 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React',
    'setMovies] = useState<MediaItem[]>([]);': 'setMovies] = useState<MediaItem[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);',
    '.then((res) => setMovies(res.data.movies || []))': '.then((res) => { setMovies(res.data.movies || []); setVisibleCount(50); })',
    'movies.map((movie)': 'movies.slice(0, visibleCount).map((movie)',
    '  {movies.slice(0, visibleCount).map((movie) => (\n              <MediaCard\n                key={movie.id}\n                media={movie}\n                onOpenDetails={(m) => setSelectedMediaId(m.id)}\n              />\n            ))}\n          </div>': '  {movies.slice(0, visibleCount).map((movie) => (\n              <MediaCard\n                key={movie.id}\n                media={movie}\n                onOpenDetails={(m) => setSelectedMediaId(m.id)}\n              />\n            ))}\n          </div>\n          <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />'
})
# wait, wait! The ternary operator in MoviesPage for loading/empty/movies is:
# ) : (\n <div className="grid..."> \n {movies.map...} \n </div> \n )}
# So I can just replace ) : (\n <div className="grid..."> with ) : (\n <>\n <div className="grid..."> and </div>\n )} with </div>\n <InfiniteScroll.../>\n </>\n )}

