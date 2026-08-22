
import os
import re

def process_easy(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    
    code = code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)
    
    # States
    code = code.replace('setMovies] = useState<MediaItem[]>([]);', 'setMovies] = useState<MediaItem[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
    code = code.replace('setShows] = useState<Show[]>([]);', 'setShows] = useState<Show[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
    
    code = code.replace('.then((res) => setMovies(res.data.movies || []))', '.then((res) => { setMovies(res.data.movies || []); setVisibleCount(50); })')
    code = code.replace('.then((res) => setShows(res.data || []))', '.then((res) => { setShows(res.data || []); setVisibleCount(50); })')
    code = code.replace('setMovies(data);', 'setMovies(data);\n        setVisibleCount(50);')
    
    # Mappings
    code = code.replace('movies.map((vid) => {', 'movies.slice(0, visibleCount).map((vid) => {')
    code = code.replace('movies.map((movie) => (', 'movies.slice(0, visibleCount).map((movie) => (')
    code = code.replace('shows.map((show, idx) => (', 'shows.slice(0, visibleCount).map((show, idx) => (')
    
    # Inject InfiniteScroll before the END of the grid
    # Movies grid end:
    code = code.replace('/>\n            ))}\n          </div>', '/>\n            ))}\n            <div className="col-span-full"><InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} /></div>\n          </div>')
    
    # Shows grid end:
    code = code.replace('</div>\n                ))}\n              </div>', '</div>\n                ))}\n                <div className="col-span-full"><InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} /></div>\n              </div>')
    
    # LibraryPage mixed movies end (independent):
    code = code.replace('/>\n                  ))}\n                </div>', '/>\n                  ))}\n                  <div className="col-span-full"><InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} /></div>\n                </div>')
    
    # LibraryPage library movies end:
    code = code.replace('</div>\n                  );\n                })}\n              </div>', '</div>\n                  );\n                })}\n                <div className="col-span-full"><InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} /></div>\n              </div>')
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

process_easy('client/src/pages/MoviesPage.tsx')
process_easy('client/src/pages/ShowsPage.tsx')
process_easy('client/src/pages/LibraryPage.tsx')

