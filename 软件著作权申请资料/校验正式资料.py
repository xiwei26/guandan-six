"""Validate local copyright materials without logging personal identity fields."""
import json
import re
import subprocess
import sys
import zipfile
from collections import Counter
from pathlib import Path
from lxml import etree as E

root = Path(__file__).resolve().parent
project = root.parent
final = root / '正式资料'
skill = Path.home() / '.codex/skills/software-copyright-materials'
sys.path.insert(0, str(skill / 'scripts'))
from build_docx_from_md import parse_code_pages

cli = skill / 'vendor/docx-toolkit/scripts/dotnet/DocxToolkit.Cli/bin/Debug/net8.0/DocxToolkit.Cli.dll'
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
checks = []
for f in sorted(final.glob('*.docx')):
    process = subprocess.run(['dotnet', str(cli), 'validate', '--input', str(f), '--business', '--json'], capture_output=True, encoding='utf-8', errors='replace')
    result = json.loads(process.stdout)
    assert result['isValid'] and not result['errors'], f.name
    with zipfile.ZipFile(f) as z:
        assert z.testzip() is None
        doc = E.fromstring(z.read('word/document.xml'))
        body_text = ''.join(doc.xpath('//w:t/text()', namespaces=ns))
        assert '截图缺失' not in body_text and '截图无法插入' not in body_text
        for name in z.namelist():
            if name.endswith('.xml') and name.startswith(('word/document', 'word/header', 'word/styles')):
                xml = E.fromstring(z.read(name))
                assert all(c in ['000000', 'auto'] for c in xml.xpath('//w:color/@w:val', namespaces=ns))
        headers = [z.read(n).decode() for n in z.namelist() if n.startswith('word/header') and n.endswith('.xml')]
        assert any('开掼六六六 V1.0' in h and 'PAGE' in h for h in headers)
        assert not doc.xpath('//w:hyperlink', namespaces=ns)
        if '代码' in f.name:
            paragraphs = [''.join(p.xpath('.//w:t/text()', namespaces=ns)) for p in doc.xpath('/w:document/w:body/w:p', namespaces=ns)]
            pages = parse_code_pages(root / '草稿/代码-全部.md')
            expected = [line or ' ' for _, lines in pages for line in lines]
            assert paragraphs == expected
            assert len(doc.xpath('//w:br[@w:type="page"]', namespaces=ns)) == 30
            counts = {'source_paragraphs': len(paragraphs), 'logical_pages': 31, 'maximum_line_characters': max(map(len, paragraphs))}
        else:
            images = len(doc.xpath('//w:drawing', namespaces=ns))
            assert images == 14 and '【截图预留：' in body_text
            counts = {'embedded_images': images}
    checks.append({'file': f.name, 'openxml_valid': True, 'errors': [], 'warnings': dict(Counter(w['Message'] for w in result['warnings'])), 'checks': counts})

manifest = json.loads((root / '草稿/代码提取清单.json').read_text(encoding='utf-8'))
for item in manifest['files']:
    lines = (project / item['path']).read_text(encoding='utf-8').splitlines()
    assert len(lines) == item['source_line_count']
    assert sum(bool(x.strip()) for x in lines) == item['selected_line_count']

application = (root / '草稿/申请表信息.md').read_text(encoding='utf-8')
txt = (final / '申请表信息.txt').read_text(encoding='utf-8')
for line in application.splitlines():
    if line.startswith('➤'):
        assert line[1:] in txt
(final / '校验结果.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('PASS: two valid DOCX files; 1534 code paragraphs; 14 embedded images; black text; matching headers and application fields.')
print('Logical code pages: 31. Physical Word pagination is not rendered or verified.')
