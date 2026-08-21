
with open('client/src/components/library/LazyImage.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('  src: string;\n', '')
code = code.replace('export const LazyImage: React.FC<LazyImageProps> = ({ src, fallbackSrc, className, alt, ...props }) => {', 'export const LazyImage: React.FC<LazyImageProps> = ({ src, fallbackSrc, className, alt, ...props }) => {')

# Actually, if we remove src: string; we don't need to change much else.

with open('client/src/components/library/LazyImage.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

