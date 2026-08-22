
import os
import re

with open('client/src/pages/ShowsPage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)
code = code.replace('setShows] = useState<Show[]>([]);', 'setShows] = useState<Show[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
code = code.replace('.then((res) => setShows(res.data || []))', '.then((res) => { setShows(res.data || []); setVisibleCount(50); })')

# Replace the grid wrapper for the Shows map
old_grid = '''            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {shows.map((show, idx) => ('''

new_grid = '''            ) : (
              <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {shows.slice(0, visibleCount).map((show, idx) => ('''
                
code = code.replace(old_grid, new_grid)

old_end = '''                  </div>
                ))}
              </div>
            )}
        </div>
        )}'''

new_end = '''                  </div>
                ))}
              </div>
              <InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />
              </>
            )}
        </div>
        )}'''
        
code = code.replace(old_end, new_end)

with open('client/src/pages/ShowsPage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

