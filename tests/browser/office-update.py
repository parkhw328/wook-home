"""Only run against office-update-preview.mjs; all accounts and work are synthetic."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE = f"http://127.0.0.1:{os.environ.get('OFFICE_TEST_PORT', '18088')}"
OUT = Path('artifacts/office-update'); OUT.mkdir(parents=True, exist_ok=True)
PASSWORD = 'Preview-only-password-2026'
results = []


def audit(page):
    data = page.evaluate('''() => {
      const shown = e => e.checkVisibility() && e.getBoundingClientRect().width > 0;
      const controls = [...document.querySelectorAll('button,input,select')].filter(shown).filter(e=>!e.closest('.office-scene'));
      const small = [...document.querySelectorAll('body *')].filter(shown).filter(e => [...e.childNodes].some(n=>n.nodeType===3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize)<14);
      return {overflow: document.documentElement.scrollWidth > innerWidth+1,
        small: small.map(e=>e.className), badControls: controls.filter(e=>parseFloat(getComputedStyle(e).fontSize)<16 || e.getBoundingClientRect().height < 43.9).map(e=>e.id || e.className),
        shadows: controls.filter(e=>getComputedStyle(e).boxShadow!=='none').map(e=>e.id || e.className)};
    }''')
    assert not data['overflow'] and not data['small'] and not data['badControls'] and not data['shadows'], data
    return data


def login(page):
    page.goto(BASE)
    expect(page.locator('#login-form')).to_be_visible()
    audit(page)
    page.locator('#password').fill('wrong-test-password')
    page.locator('#login-form button').click()
    expect(page.locator('#login-feedback')).to_contain_text('확인해')
    page.locator('#password').fill(PASSWORD)
    page.locator('#login-form button').click()
    page.wait_for_url(BASE + '/')
    expect(page.locator('#app-version')).to_have_text('v0.2.0')
    expect(page.locator('#room-heading')).to_have_text('사무실')


def check(page, label, navigate=True):
    errors=[]; page.on('pageerror', lambda e: errors.append(str(e)))
    if navigate: login(page)
    page.wait_for_timeout(300)
    audit(page)
    expect(page.locator('#floor-view-title')).to_contain_text('고객 포털')
    page.locator('#room-navigation [data-room^="office-"]').click()
    expect(page.locator('#floor-view-title')).to_contain_text('분석 도구')
    expect(page.locator('#room-description')).to_contain_text('분석 도구 전용 층')
    page.locator('#room-navigation [data-floor="0"]').click()
    expect(page.locator('#floor-view-title')).to_contain_text('4개 층')
    page.locator('#room-navigation [data-room="warehouse"]').click()
    expect(page.locator('#room-heading')).to_have_text('대기실')
    page.locator('#room-content [data-archive-agent]').first.click()
    expect(page.locator('#archive-project')).to_have_value('분석 도구')
    page.locator('#archive-note').fill('수정한 다음 행동')
    audit(page)
    page.locator('#archive-form button[value="store"]').click()
    expect(page.locator('#archive-form')).not_to_be_visible()
    page.keyboard.press('Escape')
    page.locator('#room-navigation [data-room="pantry"]').click()
    expect(page.locator('.history-list')).to_contain_text('지난 업무')
    page.locator('.history-filters [name="kind"]').select_option('task')
    expect(page.locator('[data-history-status]')).to_have_text('24건 · 1–20')
    page.locator('[data-history-page="20"]').click()
    expect(page.locator('[data-history-status]')).to_have_text('24건 · 21–24')
    page.locator('.history-filters [name="kind"]').select_option('cli')
    expect(page.locator('[data-history-status]')).to_have_text('1건 · 1–1')
    expect(page.locator('[data-history-coverage]')).to_contain_text('연결 끊김')
    page.locator('[data-history-session]').click()
    expect(page.locator('.history-dialog')).to_be_visible()
    expect(page.locator('.history-dialog')).to_contain_text('오프라인으로 보관한 이전 작업')
    assert page.locator('.history-dialog script').count()==0
    audit(page)
    page.keyboard.press('Escape')
    expect(page.locator('.history-dialog')).not_to_be_visible()
    audit(page)
    if '1366' in label or '320' in label:
        page.screenshot(path=str(OUT / f'{label}-history.png'),full_page=True)
    page.locator('#room-navigation [data-room="office"]').click()
    page.locator('[data-scene-action="fullscreen"]').click()
    page.wait_for_timeout(300)
    audit(page)
    page.locator('[data-scene-action="fullscreen"]').click()
    page.evaluate('document.querySelector("#logout-button").click()')
    expect(page.locator('#login-form')).to_be_visible()
    assert page.request.get(BASE+'/api/state').status==401
    assert not errors, errors
    results.append({'case':label,'result':'passed'})

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox','--enable-unsafe-swiftshader'])
    for theme in ['light','dark']:
        for width in [320,390,768,1366,1920]:
            page=browser.new_page(viewport={'width':width,'height':1000},color_scheme=theme,reduced_motion='reduce')
            check(page,f'{theme}-{width}'); page.close()
    browser.close()
    extension=Path('extensions/browser-observer').resolve()
    for theme in ['light','dark']:
        with tempfile.TemporaryDirectory() as profile:
            context=p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
                viewport={'width':1366,'height':1000},color_scheme=theme,reduced_motion='reduce',
                args=['--no-sandbox','--enable-unsafe-swiftshader',f'--disable-extensions-except={extension}',f'--load-extension={extension}'])
            page=context.pages[0]; login(page)
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('''async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(tab.id,2);return chrome.tabs.getZoom(tab.id);}''')==2
            check(page,f'{theme}-zoom200',False); context.close()
OUT.joinpath('results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(f'PASS: {len(results)} layouts; login, project floors, waiting edits, offline history, pagination, fullscreen, logout and actual 200% zoom')
