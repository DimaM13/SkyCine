
import os
import re

with open('client/src/pages/LibraryPage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('import React', 'import { InfiniteScroll } from \'../components/library/InfiniteScroll\';\nimport React', 1)
code = code.replace('setMovies] = useState<MediaItem[]>([]);', 'setMovies] = useState<MediaItem[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
code = code.replace('setMovies(data);', 'setMovies(data);\n        setVisibleCount(50);')

code = code.replace('<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">\n                {movies.map((vid) => {', 
'<>\n<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">\n                {movies.slice(0, visibleCount).map((vid) => {')

code = code.replace('''                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (''',
'''                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />
              </>
            )}
          </div>
        ) : (''')

code = code.replace('<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">\n                  {movies.map((movie) => (',
'<>\n<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">\n                  {movies.slice(0, visibleCount).map((movie) => (')

code = code.replace('''                  ))}
                </div>
              )}
            </div>
          ) : (''',
'''                  ))}
                </div>
                <InfiniteScroll hasMore={visibleCount < movies.length} onLoadMore={() => setVisibleCount(c => c + 50)} />
                </>
              )}
            </div>
          ) : (''')


code = code.replace('<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">\n                  {shows.map((show, idx) => (',
'<>\n<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">\n                  {shows.slice(0, visibleCount).map((show, idx) => (')

code = code.replace('''                  ))}
                </div>
              )}
            </div>
          )}''',
'''                  ))}
                </div>
                <InfiniteScroll hasMore={visibleCount < shows.length} onLoadMore={() => setVisibleCount(c => c + 50)} />
                </>
              )}
            </div>
          )}''')

with open('client/src/pages/LibraryPage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

