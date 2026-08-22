
import re

def process_file(filepath, state_def, update_state, map_old, map_new, grid_regex, grid_repl):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    if 'InfiniteScroll' not in code:
        code = code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)

    code = code.replace(state_def, state_def + '\n  const [visibleCount, setVisibleCount] = useState(50);')
    code = code.replace(update_state, update_state.replace('))', '); setVisibleCount(50); })').replace('.then((res) => ', '.then((res) => { '))
    
    # Actually, let's just do simple replacements.
    code = code.replace(map_old, map_new)

    code = re.sub(grid_regex, grid_repl, code, flags=re.DOTALL)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

# MoviesPage
process_file('client/src/pages/MoviesPage.tsx',
    'setMovies] = useState<MediaItem[]>([]);',
    '.then((res) => setMovies(res.data.movies || []))',
    'movies.map((movie) =>',
    'movies.slice(0, visibleCount).map((movie) =>',
    r'(\) : \(\s*)(<div className="grid grid-cols-2.*?</div>)(\s*\)}\s*\{/\* Details Modal \*/\})',
    r'\1<>\n\2\n<InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />\n</>\3'
)

# ShowsPage
process_file('client/src/pages/ShowsPage.tsx',
    'setShows] = useState<Show[]>([]);',
    '.then((res) => setShows(res.data || []))',
    'shows.map((show, idx) =>',
    'shows.slice(0, visibleCount).map((show, idx) =>',
    r'(\) : \(\s*)(<div className="grid grid-cols-2.*?</div>)(\s*\)}\s*\{/\* Create Modal \*/\})',
    r'\1<>\n\2\n<InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />\n</>\3'
)

# LibraryPage handles both! It has movies and shows.
with open('client/src/pages/LibraryPage.tsx', 'r', encoding='utf-8') as f:
    lib_code = f.read()

if 'InfiniteScroll' not in lib_code:
    lib_code = lib_code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)

lib_code = lib_code.replace('const [movies, setMovies] = useState<MediaItem[]>([]);', 'const [movies, setMovies] = useState<MediaItem[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
lib_code = lib_code.replace('.then((res) => setMovies(res.data.movies || []))', '.then((res) => { setMovies(res.data.movies || []); setVisibleCount(50); })')
lib_code = lib_code.replace('setMovies(data);', 'setMovies(data);\n          setVisibleCount(50);')

lib_code = lib_code.replace('movies.map((vid) => {', 'movies.slice(0, visibleCount).map((vid) => {')
lib_code = lib_code.replace('movies.map((movie) => (', 'movies.slice(0, visibleCount).map((movie) => (')
lib_code = lib_code.replace('shows.map((show, idx) => (', 'shows.slice(0, visibleCount).map((show, idx) => (')

# Replace grid wrapper for movies (independent view in library)
lib_code = re.sub(
    r'(\) : \(\s*)(<div className="grid grid-cols-2.*?</div>)(\s*\)}\s*\{/\* Details Modal \*/\})',
    r'\1<>\n\2\n<InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />\n</>\3',
    lib_code, flags=re.DOTALL
)

# Replace grid wrapper for library movies
lib_code = re.sub(
    r'(\) : \(\s*)(<div className="grid grid-cols-1.*?</div>\s*</div>\s*\)\s*\}?\)\s*\}\s*</div>)(\s*\)}\s*</div>\s*\)\s*:\s*\(\s*<div className="grid grid-cols-2)',
    r'\1<>\n\2\n<InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />\n</>\3',
    lib_code, flags=re.DOTALL
)

# Replace grid wrapper for library shows
lib_code = re.sub(
    r'(\) : \(\s*)(<div className="grid grid-cols-2.*?</div>)(\s*\)}\s*</div>\s*\)\s*}\s*</div>\s*</div>)',
    r'\1<>\n\2\n<InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />\n</>\3',
    lib_code, flags=re.DOTALL
)

with open('client/src/pages/LibraryPage.tsx', 'w', encoding='utf-8') as f:
    f.write(lib_code)


