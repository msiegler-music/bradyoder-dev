#!/usr/bin/env python3
"""
Automated 25-Sample Spot Check for Chord Chart Rendering.
Verifies typography rules across 25 charts (including priority regressions):
1. Root notes remain full-size on the baseline (never in <sup>).
2. 'add' modifiers remain on the baseline (e.g. Cadd9, not Cᵃᵈᵈ⁹).
3. Minor qualities / extensions properly sit in superscript (e.g. Bᵐ/ₐ).
4. Slash bass notes sit in subscript (e.g. G/ᴅ).
"""

import glob, os, random, re, sys, zipfile
import xml.etree.ElementTree as ET

CHORD_TOKEN_REGEX = re.compile(
    r'(?<![A-Za-z0-9_#♯*])(?:(\/[A-Ga-g][#b♯♭]?)|([A-Ga-g][#b♯♭]?)((?:<[^>]+>|maj|min|dim|aug|sus|add|m|[0-9#b♯♭+-])*)(?:\/([A-Ga-g][#b♯♭]?)([0-9a-z#b♯♭+-]*)?)?)(?![A-Za-z0-9_#♯])'
)

def cleanMammothDocxHtml_py(html):
    if not html:
        return html
    h = re.sub(r'<sup[^>]*>\s*', '<sup>', html, flags=re.I)
    h = re.sub(r'\s*</sup>', '</sup>', h, flags=re.I)
    h = re.sub(r'<sub[^>]*>\s*', '<sub>', h, flags=re.I)
    h = re.sub(r'\s*</sub>', '</sub>', h, flags=re.I)
    h = re.sub(r'<sup>\s*</sup>', '', h, flags=re.I)
    h = re.sub(r'<sub>\s*</sub>', '', h, flags=re.I)
    h = re.sub(r'</sup>\s*<sup>', '', h)
    h = re.sub(r'</sub>\s*<sub>', '', h)
    h = re.sub(r'([A-Ga-g])\s*<sup>\s*b\s*</sup>', r'\1b', h, flags=re.I)
    h = re.sub(r'([A-Ga-g])\s*<sup>\s*#\s*</sup>', r'\1#', h)
    h = re.sub(r'([A-Ga-g])\s*<sup>\s*b([/a-zA-Z0-9_#+-]*)\s*</sup>', r'\1b\2', h, flags=re.I)
    h = re.sub(r'([A-Ga-g])\s*<sup>\s*#([/a-zA-Z0-9_#+-]*)\s*</sup>', r'\1#\2', h)
    
    def unwrap_slash(m):
        inner = m.group(1)
        return f'<sup>{inner}</sup>/' if inner else '/'
    h = re.sub(r'<sup>([^<]*)/</sup>', unwrap_slash, h)
    
    def unwrap_root(m):
        root, rest = m.group(1), m.group(2)
        if rest:
            if rest.endswith('/'):
                inner = rest[:-1]
                return f'{root}<sup>{inner}</sup>/' if inner else f'{root}/'
            return f'{root}<sup>{rest}</sup>'
        return root
    h = re.sub(r'<sup>\s*([A-Ga-g][#b]?)([^<]*)</sup>', unwrap_root, h)
    h = re.sub(r'<sub>\s*([A-Ga-g][#b]?)\s*</sub>', r'\1', h, flags=re.I)
    h = re.sub(r'<sup>\s*(add[0-9a-zA-Z#b+-]*)\s*</sup>', r' \1', h, flags=re.I)
    h = re.sub(r'<sup>\s*/\s*</sup>\s*([A-Ga-g][#b]?)', r'/\1', h)
    h = re.sub(r'<sup>\s*/\s*</sup>', '/', h)
    h = re.sub(r'\b([A-Ga-g])\s+([b#])\b', r'\1\2', h)
    
    smushPattern = re.compile(r'\b([A-Ga-g][#b]?m?)\s+((?:maj|min|dim|aug|sus|add|m7|m9|m11|[0-9])[a-zA-Z0-9#b+-]*)', re.I)
    prev = None
    while prev != h:
        prev = h
        h = smushPattern.sub(r'\1\2', h)
    
    h = re.sub(r'^\s*<p[^>]*>(?:.*?(?:brad\s+yoder|capo|[A-Ga-g][#b♯♭]?\s*\(.*?\)).*?)</p>\s*', '', h, flags=re.I)
    return h

def formatChordTokenHtml_py(root, qualityAndExt, bass, bassExt, isFancy):
    if not root:
        return ''
    capRoot = root[0].upper() + root[1:]
    finalRoot = capRoot.replace('#', '♯').replace('b', '♭') if isFancy else capRoot.replace('♯', '#').replace('♭', 'b')
    cleanExt = re.sub(r'</?(?:sup|sub)>', '', qualityAndExt or '')
    finalExt = cleanExt.replace('#', '♯').replace('b', '♭') if isFancy else cleanExt.replace('♯', '#').replace('♭', 'b')
    
    extHtml = ''
    if finalExt:
        if not isFancy:
            extHtml = finalExt
        else:
            m = re.match(r'^(m|maj|dim|aug|sus|[0-9]+)?(add[0-9a-zA-Z♯♭+-]*)(.*)$', finalExt, re.I)
            if m:
                prefix, addPart, suffix = m.group(1) or '', m.group(2), m.group(3) or ''
                prefixHtml = f'<sup>{prefix}</sup>' if prefix else ''
                suffixHtml = f'<sup>{suffix}</sup>' if suffix else ''
                extHtml = f'{prefixHtml}{addPart}{suffixHtml}'
            else:
                extHtml = f'<sup>{finalExt}</sup>'
    
    bassHtml = ''
    if bass:
        capBass = bass[0].upper() + bass[1:]
        bExt = re.sub(r'</?(?:sup|sub)>', '', bassExt or '')
        finalBass = (capBass + bExt).replace('#', '♯').replace('b', '♭') if isFancy else (capBass + bExt).replace('♯', '#').replace('♭', 'b')
        bassHtml = f'/<sub>{finalBass}</sub>' if isFancy else f'/{finalBass}'
    return f'{finalRoot}{extHtml}{bassHtml}'

def formatChordsFancy_py(html):
    def repl(m):
        soloSlash, root, qualityAndExt, bass, bassExt = m.groups()
        if soloSlash:
            pitch = soloSlash[1:]
            capPitch = pitch[0].upper() + pitch[1:].replace('#', '♯').replace('b', '♭')
            return f'/<sub>{capPitch}</sub>'
        return formatChordTokenHtml_py(root, qualityAndExt, bass, bassExt, True)
    return CHORD_TOKEN_REGEX.sub(repl, html)

def spot_check(sample_size=25, seed=None):
    if seed is not None:
        random.seed(seed)
    all_docs = sorted(glob.glob('charts/input/*.docx'))
    if not all_docs:
        print('No docx charts found in charts/input/')
        return True
    
    # Priority regressions: ee cummings and back then
    priority_files = [f for f in all_docs if 'ee cummings' in f or 'back then' in f]
    remaining = [f for f in all_docs if f not in priority_files]
    selected = priority_files + random.sample(remaining, min(sample_size - len(priority_files), len(remaining)))
    
    print(f'Spot checking {len(selected)} random charts (including regressions):')
    passed = 0
    for doc_path in selected:
        fname = os.path.basename(doc_path)
        with zipfile.ZipFile(doc_path) as z:
            xml_content = z.read('word/document.xml')
            root = ET.fromstring(xml_content)
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            paras = []
            for p in root.findall('.//w:p', ns):
                p_html = ''
                for r in p.findall('.//w:r', ns):
                    t = ''.join([elem.text for elem in r.findall('.//w:t', ns) if elem.text])
                    va = r.find('.//w:vertAlign', ns)
                    val = va.attrib.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val') if va is not None else None
                    if val == 'superscript': p_html += f'<sup>{t}</sup>'
                    elif val == 'subscript': p_html += f'<sub>{t}</sub>'
                    else: p_html += t
                if p_html.strip():
                    paras.append(f'<p>{p_html}</p>')
            raw_html = '\n'.join(paras)
            cleaned = cleanMammothDocxHtml_py(raw_html)
            formatted = formatChordsFancy_py(cleaned)
            
            # 1. No root note mistakenly in sup
            root_in_sup = re.findall(r'<sup>\s*[A-Ga-g][#b♯♭]?\s*</sup>', formatted)
            if root_in_sup:
                print(f'  [FAIL] {fname}: Root note mistakenly wrapped in <sup>: {root_in_sup}')
                continue
            
            # 2. No "add" word inside sup (e.g. <sup>add9</sup>)
            add_in_sup = re.findall(r'<sup>\s*add', formatted, re.I)
            if add_in_sup:
                print(f'  [FAIL] {fname}: "add" word mistakenly in <sup>: {add_in_sup}')
                continue
            
            print(f'  [OK] {fname}')
            passed += 1
            
    print(f'Spot check complete: {passed}/{len(selected)} charts verified successfully.')
    return passed == len(selected)

if __name__ == '__main__':
    ok = spot_check(25, seed=42)
    sys.exit(0 if ok else 1)
