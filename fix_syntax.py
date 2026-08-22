
import os

def replace_all(filepath, replacements):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    for old, new in replacements.items():
        code = code.replace(old, new)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

replace_all('client/src/pages/MoviesPage.tsx', {
    '.then((res) => setMovies(res.data.movies || []); setVisibleCount(50);)': '.then((res) => { setMovies(res.data.movies || []); setVisibleCount(50); })'
})

replace_all('client/src/pages/LibraryPage.tsx', {
    '.then((res) => setMovies(res.data.movies || []); setVisibleCount(50);)': '.then((res) => { setMovies(res.data.movies || []); setVisibleCount(50); })',
    '.then((res) => setShows(res.data || []); setVisibleCount(50);)': '.then((res) => { setShows(res.data || []); setVisibleCount(50); })',
    '.then((res) => setMovies(res.data || []); setVisibleCount(50);)': '.then((res) => { setMovies(res.data || []); setVisibleCount(50); })',
    '.then((res) => setShows(res.data.shows || []); setVisibleCount(50);)': '.then((res) => { setShows(res.data.shows || []); setVisibleCount(50); })',
    'setMovies(data); setVisibleCount(50);': '{ setMovies(data); setVisibleCount(50); }' # wait, in LibraryPage it was .then((data) => setMovies(data); setVisibleCount(50);)
})

replace_all('client/src/pages/ShowsPage.tsx', {
    '.then((res) => setShows(res.data || []); setVisibleCount(50);)': '.then((res) => { setShows(res.data || []); setVisibleCount(50); })'
})

