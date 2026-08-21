
import os
import re

files_to_patch = [
    'client/src/pages/LibraryPage.tsx',
    'client/src/pages/ShowsPage.tsx',
    'client/src/pages/HomePage.tsx',
    'client/src/pages/MoviesPage.tsx',
    'client/src/components/library/MediaCard.tsx'
]

def patch_file(filepath):
    if not os.path.exists(filepath):
        return
        
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    # Add import if not exists
    if 'LazyImage' not in code and '<img' in code:
        # insert import after last import
        imports = re.findall(r'import .*?;', code)
        if imports:
            last_import = imports[-1]
            # wait, they don't always end with ;
            # just inject it after the first import
            code = code.replace('import React', 'import { LazyImage } from \'../components/library/LazyImage\';\nimport React', 1)
            
    # Replace <img with <LazyImage
    # First, replace <img with <LazyImage
    code = code.replace('<img', '<LazyImage')
    
    # Second, replace onError={(e) => { (e.currentTarget as HTMLImageElement).src = /api/media/item//thumbnail; }} 
    # and similar with fallbackSrc={/api/media/item//thumbnail}
    # Actually, it's easier to just let LazyImage handle it by passing fallbackSrc.
    
    # Let's replace the common onError pattern for vid
    code = re.sub(
        r'onError=\{\(e\) => \{\s*\(e\.currentTarget as HTMLImageElement\)\.src = \/api\/media\/item\/\$\{([^}]+)\}\/thumbnail;\s*\}\}',
        r'fallbackSrc={/api/media/item//thumbnail}',
        code
    )
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

for f in files_to_patch:
    patch_file(f)

