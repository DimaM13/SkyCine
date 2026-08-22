
import os
import re

files_to_patch = [
    'client/src/components/library/MediaCard.tsx',
    'client/src/pages/HomePage.tsx',
    'client/src/pages/LibraryPage.tsx',
    'client/src/pages/ShowsPage.tsx',
    'client/src/pages/MoviesPage.tsx',
    'client/src/components/library/HeroBanner.tsx'
]

def patch_file(filepath):
    if not os.path.exists(filepath):
        return
        
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    # Replace backdrop-blur variations
    code = re.sub(r'backdrop-blur(?:-\w+)?', '', code)
    
    # Increase opacity of bg-black/75 to bg-black/90 so it's readable without blur
    code = code.replace('bg-black/75', 'bg-black/90')
    code = code.replace('bg-black/50', 'bg-black/80')
    
    # Clean up multiple spaces
    code = re.sub(r' +', ' ', code)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(code)

for f in files_to_patch:
    patch_file(f)

