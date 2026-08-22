
with open('client/src/pages/MoviesPage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)
code = code.replace('setMovies] = useState<MediaItem[]>([]);', 'setMovies] = useState<MediaItem[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
code = code.replace('.then((res) => setMovies(res.data.movies || []))', '.then((res) => { setMovies(res.data.movies || []); setVisibleCount(50); })')

with open('client/src/pages/MoviesPage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

