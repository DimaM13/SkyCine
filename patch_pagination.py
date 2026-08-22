
import os
import re

files_to_patch = [
    'client/src/pages/LibraryPage.tsx',
    'client/src/pages/MoviesPage.tsx',
    'client/src/pages/ShowsPage.tsx'
]

def patch_file(filepath):
    if not os.path.exists(filepath):
        return
        
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    if 'InfiniteScroll' in code:
        return

    # 1. Import InfiniteScroll
    code = code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)
    
    # 2. Add visibleCount state next to items state
    # For MoviesPage and LibraryPage: const [movies, setMovies] = useState<MediaItem[]>([]);
    # For ShowsPage: const [shows, setShows] = useState<Show[]>([]);
    
    if 'setMovies] = useState<MediaItem[]>([])' in code:
        code = code.replace('setMovies] = useState<MediaItem[]>([]);', 'setMovies] = useState<MediaItem[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
        
        # Reset visibleCount on search/sort
        if 'setMovies(res.data.movies || [])' in code:
            code = code.replace('setMovies(res.data.movies || [])', 'setMovies(res.data.movies || []); setVisibleCount(50);')
            
        # Replace mapping
        code = code.replace('movies.map((vid', 'movies.slice(0, visibleCount).map((vid')
        
        # Inject InfiniteScroll after the grid
        code = re.sub(
            r'(movies\.slice\(0, visibleCount\)\.map\(.*?\}\s*\)\s*\}\s*</div>)',
            r'\1\n              <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />',
            code,
            flags=re.DOTALL
        )
        
    if 'setShows] = useState<Show[]>([])' in code:
        code = code.replace('setShows] = useState<Show[]>([]);', 'setShows] = useState<Show[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
        
        if 'setShows(res.data || [])' in code:
            code = code.replace('setShows(res.data || [])', 'setShows(res.data || []); setVisibleCount(50);')
            
        code = code.replace('shows.map((show', 'shows.slice(0, visibleCount).map((show')
        
        code = re.sub(
            r'(shows\.slice\(0, visibleCount\)\.map\(.*?\}\s*\)\s*\}\s*</div>)',
            r'\1\n              <InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />',
            code,
            flags=re.DOTALL
        )
    
    # For LibraryPage which handles both movies and shows maybe?
    # Actually, LibraryPage sets movies but the API might return both. 
    # LibraryPage handles movies: 'apiClient.get(/media/library/)'
    if 'apiClient.get(/media/library/)' in code and 'setMovies(data)' in code:
         code = code.replace('setMovies(data)', 'setMovies(data); setVisibleCount(50);')

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

for f in files_to_patch:
    patch_file(f)

