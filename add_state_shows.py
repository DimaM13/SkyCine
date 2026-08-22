
import re
with open('client/src/pages/ShowsPage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)
code = code.replace('setShows] = useState<Show[]>([]);', 'setShows] = useState<Show[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
code = code.replace('.then((res) => setShows(res.data || []))', '.then((res) => { setShows(res.data || []); setVisibleCount(50); })')

code = re.sub(
    r'(\) : \(\s*)(<div className="grid grid-cols-2.*?</div>)(\s*\)}\s*\{/\* Create Modal \*/\})',
    r'\1<>\n\2\n<InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />\n</>\3',
    code, flags=re.DOTALL
)

code = code.replace('shows.map((show, idx)', 'shows.slice(0, visibleCount).map((show, idx)')

with open('client/src/pages/ShowsPage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

