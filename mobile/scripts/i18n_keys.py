"""
Every English sentence the tablet shows, and which translations lack one.

    python scripts/i18n_keys.py          # writes src/i18n/keys.json, lists gaps
    python scripts/i18n_keys.py --check  # the same, exit 1 if any language has a gap

The English sentence is the key (see src/i18n/index.ts). Sentences are found
three ways:

  * written inside t(...) or tn(...) on a screen;
  * held in a table a screen translates by name -- TABLES below;
  * built by the rules in core and translated through a pattern -- the
    `template` of each entry in src/i18n/patterns.ts, and the fixed messages
    listed in CORE below.

keys.json is committed; src/i18n/i18n.test.ts fails when a dictionary lacks
one of them or gets a {placeholder} wrong, so a sentence added to a screen
without its translations is caught by the tests, not on the tablet.
"""

import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LANGS = ['hi', 'or', 'bn']

# Tables of sentences a screen passes to t() by name: file -> names.
TABLES = {
    'app/capture/machine.tsx': ['TYPES'],
    'app/capture/operator.tsx': ['operatorRole'],
    'app/capture/confirm.tsx': ['TYPE_LABEL', 'SEVERITY_LABEL'],
    'app/history.tsx': ['PERIODS', 'TYPE_LABEL'],
    'app/index.tsx': ['TYPE_LABEL'],
    'src/ui/FlowProgress.tsx': ['STAGES'],
    'src/ui/DiscardSheet.tsx': ['REASON_LABEL'],
    'src/ui/Guide.tsx': ['GUIDE', 'STEPS'],
    'src/ui/ItemControl.tsx': ['ANSWER_LABEL'],
    'src/core/capture/session.ts': ['counterpartQuestion'],
    # The summary of the terms is translated; the full terms stay in English,
    # which governs (src/legal/terms.ts).
    'src/legal/terms.ts': ['SUMMARY'],
}

# Fixed sentences from core that reach a screen through t() or tm().
CORE = [
    # evaluation.ts, a check's own problems (ItemControl shows them)
    'Needs a reading', 'Needs an answer', 'A critical item cannot be marked Not applicable',
    'Say what is wrong', 'Add a photo',
    # ItemControl.itemRules, the tags on a check
    'Photo if Caution or Not OK', 'Photo if out of range', 'Yes is a fault', 'No is a fault',
    'Photo if Yes', 'Photo if No',
    # todo.ts, what is left
    'Say who the operator is', 'Enter the hour meter reading',
    # session.fuelProblem
    'Fuel must be between 0 and 100 per cent',
]

SKIP_DIRS = {'node_modules', '.expo', 'android', 'ios', 'dist'}
ENUMISH = re.compile(r'^[A-Z0-9_]+$')


def source_files():
    for top in ('app', 'src'):
        for d, dirs, files in os.walk(os.path.join(ROOT, top)):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for f in files:
                if not f.endswith(('.ts', '.tsx')) or '.test.' in f:
                    continue
                p = os.path.join(d, f)
                if os.path.dirname(p).endswith(os.path.join('src', 'i18n')):
                    continue
                yield p


def read_literal(s, i):
    """The string literal starting at s[i] (a quote). Returns (text|None, end)."""
    q = s[i]
    j = i + 1
    out = []
    while j < len(s):
        c = s[j]
        if c == '\\':
            nxt = s[j + 1]
            out.append({'n': '\n', 't': '\t'}.get(nxt, nxt))
            j += 2
            continue
        if q == '`' and c == '$' and s[j + 1:j + 2] == '{':
            # a template with a value in it is not a key; skip to its end
            depth, j = 0, j
            while j < len(s):
                if s[j] == '`' and depth == 0:
                    return None, j + 1
                if s[j] == '{':
                    depth += 1
                elif s[j] == '}':
                    depth -= 1
                j += 1
            return None, j
        if c == q:
            return ''.join(out), j + 1
        out.append(c)
        j += 1
    return None, j


def call_args(s, i):
    """Literals in each top-level argument of the call whose '(' is at s[i]."""
    args = [[]]
    depth = 0
    j = i + 1
    while j < len(s):
        c = s[j]
        if c in '\'"`':
            before = s[:j].rstrip()
            lit, j = read_literal(s, j)
            # `kind === 'today' ? 'Nothing today' : ...` -- the compared value
            # is not shown; the two answers are.
            if lit is not None and not before.endswith(('==', '!=')):
                args[-1].append(lit)
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                return args
            depth -= 1
        elif c == ',' and depth == 0:
            args.append([])
        j += 1
    return args


CALL = re.compile(r'(?<![\w.$])(tn|t)\(')


def from_calls(s):
    keys = []
    for m in CALL.finditer(s):
        args = call_args(s, m.end() - 1)
        if m.group(1) == 't':
            keys += args[0] if args else []
        else:
            for a in args[1:3]:
                keys += a
    return keys


def block(s, name):
    """The text of `const NAME ...` or `function NAME ...` up to its closing line."""
    m = re.search(r'^(?:export )?(?:const|function) ' + re.escape(name) + r'\b', s, re.M)
    if not m:
        raise SystemExit(f'table {name} not found')
    end = re.search(r'^[}\]][^\n]*;\s*$|^}\s*$', s[m.end():], re.M)
    return s[m.start(): m.end() + (end.end() if end else len(s))]


def literals(text):
    out, j = [], 0
    while j < len(text):
        if text[j] in '\'"`':
            lit, j = read_literal(text, j)
            if lit is not None:
                out.append(lit)
            continue
        if text.startswith('/*', j):
            j = text.find('*/', j)
            if j < 0:
                break
            j += 2
            continue
        if text.startswith('//', j):
            j = text.find('\n', j)
            if j < 0:
                break
            continue
        j += 1
    return out


def ui_text(k):
    return (bool(k.strip()) and not ENUMISH.match(k)
            and not re.match(r'^[a-z]+_[a-z_]+$', k)  # a column name in a type
            and not k.startswith('/') and k not in ('en', 'hi', 'or', 'bn'))


def collect():
    keys = []
    shown = set()   # written inside t() by hand: shown, whatever it looks like
    for p in source_files():
        s = io.open(p, encoding='utf-8').read()
        found = from_calls(s)
        shown.update(found)
        keys += found
        keys += re.findall(r'excludedBecause="([^"]+)"', s)
    for rel, names in TABLES.items():
        s = io.open(os.path.join(ROOT, rel), encoding='utf-8').read()
        for n in names:
            text = block(s, n)
            # keys of an object are not sentences: drop `name:` before a literal
            text = re.sub(r'^\s*(\w+|\'[^\']*\'):\s*(?=\{|\[)', '', text, flags=re.M)
            for lit in literals(text):
                if n in ('STAGES', 'TYPES', 'PERIODS') and lit.islower() and ' ' not in lit:
                    continue  # ids, not labels
                keys.append(lit)
    pat = io.open(os.path.join(ROOT, 'src/i18n/patterns.ts'), encoding='utf-8').read()
    keys += re.findall(r"template:\s*(?:'([^']*)'|\"([^\"]*)\")", pat) and [
        a or b for a, b in re.findall(r"template:\s*(?:'([^']*)'|\"([^\"]*)\")", pat)]
    keys += CORE
    seen, out = set(), []
    for k in keys:
        # A table holds codes beside its labels, so only its text-like
        # literals count. A word somebody wrapped in t() is shown, even one
        # in capitals -- "UNFINISHED" was missed that way on 16 Nov.
        if (ui_text(k) or (k in shown and k.strip() and not k.startswith('/'))) and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def dictionary(lang):
    s = io.open(os.path.join(ROOT, f'src/i18n/{lang}.ts'), encoding='utf-8').read()
    body = s[s.index('{', s.index('=')) + 1: s.rindex('}')]
    return json.loads('{' + re.sub(r',\s*$', '', body.strip()) + '}') if body.strip() else {}


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')  # a Windows console is cp1252
    except AttributeError:
        pass
    keys = collect()
    with io.open(os.path.join(ROOT, 'src/i18n/keys.json'), 'w', encoding='utf-8') as f:
        json.dump(keys, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(keys)} sentences -> src/i18n/keys.json')
    gaps = 0
    for lang in LANGS:
        d = dictionary(lang)
        missing = [k for k in keys if k not in d]
        extra = [k for k in d if k not in keys]
        gaps += len(missing)
        print(f'{lang}: {len(d)} translated, {len(missing)} missing, {len(extra)} not used')
        for k in missing[:400 if '--all' in sys.argv else 15]:
            print('   missing:', k)
        for k in extra[:10]:
            print('   unused :', k)
    if '--check' in sys.argv and gaps:
        sys.exit(1)


if __name__ == '__main__':
    main()
