
with open('client/src/components/library/MediaCard.tsx', 'r', encoding='utf-8') as f:
    code = f.read()
code = code.replace('../components/library/LazyImage', './LazyImage')
with open('client/src/components/library/MediaCard.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

with open('client/src/pages/HomePage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()
code = code.replace('src={room.posterPath}', 'src={room.posterPath || \'\'}')
with open('client/src/pages/HomePage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

