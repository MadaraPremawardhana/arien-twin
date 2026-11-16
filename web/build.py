#!/usr/bin/env python3
"""Build the ARIEN web app into static files that any web host can serve (GitHub Pages, Netlify, S3 …).

    npm install        # once: esbuild, three, leaflet, suncalc
    python3 build.py   # src/ -> index.html, <page>/index.html, assets/

Pages are plain HTML from src/pages with the shared header and footer. Links are relative, so the site works from
any folder or domain. The built files are committed, because GitHub Pages serves the repository as it is.
"""
import hashlib, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, ASSETS = ROOT / 'src', ROOT / 'assets'
DESCRIPTION = ('Physics-based digital twins for short-term solar forecasting. Point Arien at your roof and get a working forecast in two minutes — '
               'no data, no install, no card.')
FONTS = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'

# page key -> (output path, title, layout, body file); the key is also <body data-page>
PAGES = {
    'home':      ('index.html',                 'Arien · Solar forecasts from physics', 'site',     'home.html'),
    'plans':     ('plans/index.html',           'Plans · Arien',                        'plans',    'plans.html'),
    'contact':   ('contact/index.html',         'Talk to sales · Arien',                'site',     'contact.html'),
    'accuracy':  ('accuracy/index.html',        'Accuracy · Arien',                     'site',     'accuracy.html'),
    'privacy':   ('privacy/index.html',         'Privacy Policy · Arien',               'site',     'privacy.html'),
    'terms':     ('terms/index.html',           'Terms of Service · Arien',             'site',     'terms.html'),
    'data':      ('data/index.html',            'Data & Security · Arien',              'site',     'data.html'),
    'login':     ('login/index.html',           'Log in · Arien',                       'bare',     'login.html'),
    'register':  ('register/index.html',        'Create your account · Arien',          'bare',     'register.html'),
    'forgot':    ('forgot-password/index.html', 'Reset password · Arien',               'bare',     'forgot.html'),
    'reset':     ('reset-password/index.html',  'New password · Arien',                 'bare',     'reset.html'),
    'twin':      ('twin/index.html',            'Digital Twin · Arien',                 'twin',     'twin.html'),
    'dashboard': ('dashboard/index.html',       'Dashboard · Arien',                    'twin',     'twin.html'),
    'settings':  ('settings/index.html',        'Settings · Arien',                     'app',      'settings.html'),
    'notfound':  ('404.html',                   'Page not found · Arien',               'bare',     'notfound.html'),
}
PROTECTED = {'twin': 'twin/', 'dashboard': 'dashboard/', 'settings': 'settings/'}   # need a signed-in user
LAYOUTS = {
    'site':  '<div class="st">\n{{nav}}{{body}}{{footer}}</div>',
    'plans': '<div class="st" style="min-height: 100vh;">\n{{nav}}{{body}}</div>',
    'app':   '<div class="st app-surface">\n{{nav}}{{body}}</div>',
    'twin':  '<div class="st app-surface twin-host">\n{{nav}}{{body}}</div>',
    'bare':  '{{body}}',
}

# Runs before first paint: takes the session a Google sign-in returns in the address (fragment or query) and removes
# it from the address, goes on to the page the user was heading for (a plain "page/?query" path saved before leaving),
# marks the page signed in or out, sends signed-out visitors of account pages to the log-in page, and sets the sky
# theme from the pinned choice, the last computed phase (under 30 minutes old) or the clock.
HEAD_SCRIPT = r"""(function(){var d=document.documentElement,g=function(k){try{return localStorage.getItem(k)}catch(e){return null}};
try{var u=new URL(location.href),t=u.searchParams.get('access_token'),f=/^#(.*&)?access_token=/.test(u.hash)?new URLSearchParams(u.hash.slice(1)):null;if(f){t=f.get('access_token');u.hash=''}
if(t){try{localStorage.setItem('base44_access_token',t)}catch(e){}}
if(t||u.searchParams.has('is_new_user')){u.searchParams.delete('access_token');u.searchParams.delete('is_new_user');history.replaceState(null,'',u.pathname+u.search+u.hash)}
if(t){var r=null;try{r=sessionStorage.getItem('arien:after-login');sessionStorage.removeItem('arien:after-login')}catch(e){}
if(r&&/^[a-z][a-z0-9-]*\/(\?[^#]*)?$/i.test(r)){location.replace(d.dataset.root+r);return}}}catch(e){}
var a=!!g('base44_access_token');d.dataset.auth=a?'in':'out';%GUARD%
var h=new Date().getHours(),p=h>=5&&h<8?'dawn':h>=8&&h<17?'day':h>=17&&h<20?'dusk':'night',m=g('arien:theme');
try{var c=JSON.parse(g('arien:phase')||'null');if(c&&Date.now()-c.t<18e5)p=c.phase}catch(e){}
d.dataset.phase=m==='day'||m==='night'?m:p})();"""
GUARD = "if(!a){location.replace('%sROOTlogin/?returnTo='+encodeURIComponent('%s'+location.search));return}"

TEMPLATE = """<!doctype html>
<html lang="en" data-root="{{root}}" data-phase="day" data-auth="out">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{title}}</title>
<meta name="description" content="{{description}}">
<meta property="og:title" content="{{title}}">
<meta property="og:description" content="{{description}}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#16132B">
<link rel="icon" type="image/svg+xml" href="{{root}}assets/favicon.svg">
<script>{{head_script}}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{{fonts}}">
<link rel="stylesheet" href="{{root}}assets/site.css?v={{v}}">
</head>
<body data-page="{{page}}">
{{content}}
<script src="{{root}}config.js?v={{v}}"></script>
<script type="module" src="{{root}}assets/app.js?v={{v}}"></script>
</body>
</html>
"""


def fill(text, **kw):
    for k, v in kw.items():
        text = text.replace('{{%s}}' % k, v)
    return text


def build_assets():
    ASSETS.mkdir(exist_ok=True)
    for old in list(ASSETS.glob('*.js')) + list(ASSETS.glob('*.txt')):
        old.unlink()
    shutil.rmtree(ASSETS / 'chunks', ignore_errors=True)
    nm = ROOT / 'node_modules'
    if not nm.exists():
        sys.exit('node_modules is missing: run "npm install" in web/ first.')
    subprocess.run([str(nm / '.bin' / 'esbuild'), 'src/js/app.js', '--bundle', '--format=esm', '--splitting', '--minify', '--target=es2020',
                    '--outdir=assets', '--chunk-names=chunks/[name]-[hash]', '--loader:.glsl=text', '--legal-comments=linked', '--log-level=warning'], cwd=ROOT, check=True)
    leaflet = (nm / 'leaflet' / 'dist' / 'leaflet.css').read_text()
    leaflet = re.sub(r'url\(images/[^)]*\)', 'none', leaflet)   # default marker and layer-control images are not used
    css = (SRC / 'css' / 'captured.css').read_text() + '\n/* ---- Leaflet 1.9 (BSD-2-Clause) ---- */\n' + leaflet + '\n' + (SRC / 'css' / 'extra.css').read_text()
    (ASSETS / 'site.css').write_text(css)
    for img in ('day.jpg', 'night.jpg'):   # the Earth textures supplied with ARIEN's globe (from the three.js examples)
        shutil.copyfile(SRC / 'globe' / 'textures' / img, ASSETS / ('earth-' + img))
    mark = (SRC / 'partials' / 'mark.html').read_text().strip().replace(' class="mark"', ' xmlns="http://www.w3.org/2000/svg"').replace(' aria-hidden="true"', '')
    (ASSETS / 'favicon.svg').write_text(mark + '\n')
    h = hashlib.sha1()
    for f in sorted(ASSETS.rglob('*')):
        if f.is_file() and f.suffix in ('.js', '.css'):
            h.update(f.read_bytes())
    h.update((ROOT / 'config.js').read_bytes())
    return h.hexdigest()[:8]


def build_pages(v):
    mark = (SRC / 'partials' / 'mark.html').read_text().strip()
    nav_src, footer_src = (SRC / 'partials' / 'nav.html').read_text(), (SRC / 'partials' / 'footer.html').read_text()
    for key, (out, title, layout, body_file) in PAGES.items():
        root = '../' if '/' in out else './'
        guard = (GUARD % ('', PROTECTED[key])).replace('ROOT', root) if key in PROTECTED else ''
        nav = fill(nav_src, mark=mark, seg_home=' on' if key == 'home' else '', seg_dashboard=' on' if key == 'dashboard' else '')
        body = (SRC / 'pages' / body_file).read_text()
        content = fill(LAYOUTS[layout], nav=nav, body=body, footer=footer_src)
        html = fill(TEMPLATE, content=content.rstrip(), title=title.replace('&', '&amp;'), description=DESCRIPTION, fonts=FONTS.replace('&', '&amp;'),
                    head_script=HEAD_SCRIPT.replace('%GUARD%', guard).replace('\n', ''), page=key, v=v)
        html = fill(html, root=root)
        assert '{{' not in html, (key, re.findall(r'\{\{[^}]*\}\}', html)[:3])
        target = ROOT / out
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html)
    return len(PAGES)


if __name__ == '__main__':
    version = build_assets()
    n = build_pages(version)
    size = sum(f.stat().st_size for f in ASSETS.rglob('*') if f.is_file()) // 1024
    print(f'built {n} pages, assets {size} KB, version {version}')
