"""Remove legacy CSS selectors that target classes the redesign now owns.

For every style rule (also inside @media/@supports), the selector list is split on top-level commas. A selector is
dropped when one of the target classes appears in it outside :is()/:where()/:not()/:has() parentheses (those shared
lists are left alone, to be safe). A rule with no selectors left is removed. Keyframes and other at-rules are kept.
Prints a summary; writes the files in place.
"""
import re, sys

TARGETS = sys.argv[2].split(',')
FILES = sys.argv[1].split(';')
token = re.compile(r'\.(' + '|'.join(map(re.escape, TARGETS)) + r')(?![\w-])')

def split_top(sel):
    parts, depth, cur = [], 0, ''
    for ch in sel:
        if ch in '([': depth += 1
        elif ch in ')]': depth -= 1
        if ch == ',' and depth == 0: parts.append(cur); cur = ''
        else: cur += ch
    parts.append(cur)
    return parts

def outside_parens(sel):
    out, depth = '', 0
    for ch in sel:
        if ch == '(': depth += 1; continue
        if ch == ')': depth -= 1; continue
        if depth == 0: out += ch
    return out

def find_block_end(css, i):  # css[i] == '{'
    depth = 0
    while i < len(css):
        c = css[i]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return i
        elif c == '/' and css[i:i+2] == '/*':
            i = css.index('*/', i) + 1
        elif c in '"\'':
            q = c; i += 1
            while css[i] != q: i += 2 if css[i] == '\\' else 1
        i += 1
    raise ValueError('unbalanced')

stats = {'dropped': 0, 'rules_removed': 0}
def process(css):
    out, i = [], 0
    while i < len(css):
        j = css.find('{', i)
        if j == -1: out.append(css[i:]); break
        # keep comments that precede the prelude intact
        prelude = css[i:j]
        end = find_block_end(css, j)
        body = css[j+1:end]
        head = prelude.strip()
        lead = prelude[:len(prelude) - len(prelude.lstrip())]
        if head.startswith('@'):
            if re.match(r'@(media|supports|layer|container)\b', head):
                inner = process(body)
                if inner.strip(): out.append(prelude + '{' + inner + '}')
                else: stats['rules_removed'] += 1
            else:
                out.append(prelude + '{' + body + '}')
        else:
            # separate a leading comment from the selector
            m = re.match(r'(\s*(?:/\*.*?\*/\s*)*)(.*)$', prelude, re.S)
            comment, sel = m.group(1), m.group(2)
            keep = [s for s in split_top(sel) if not token.search(outside_parens(s))]
            dropped = len(split_top(sel)) - len(keep)
            stats['dropped'] += dropped
            if keep:
                new_sel = ','.join(keep) if dropped else sel
                out.append(comment + new_sel + '{' + body + '}')
            else:
                stats['rules_removed'] += 1
                if comment.strip(): out.append(comment)
        i = end + 1
    return ''.join(out)

for f in FILES:
    css = open(f, encoding='utf-8').read()
    before = len(css)
    new = process(css)
    open(f, 'w', encoding='utf-8').write(new)
    print(f, before, '->', len(new))
print(stats)
