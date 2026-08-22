
with open('client/src/pages/ShowsPage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()
code = code.replace('setShows] = useState<any[]>([]);', 'setShows] = useState<any[]>([]);\n  const [visibleCount, setVisibleCount] = useState(50);')
with open('client/src/pages/ShowsPage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

