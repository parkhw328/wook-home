"""Run against project-floors-preview.mjs; all API snapshots are synthetic."""
import json
import os
import re
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = f"http://127.0.0.1:{os.environ.get('FLOOR_TEST_PORT', '18089')}"
OUT = Path('artifacts/project-floors')
OUT.mkdir(parents=True, exist_ok=True)
results = []


def audit(page):
    result = page.evaluate('''() => {
      const shown = e => e.checkVisibility() && e.getBoundingClientRect().width > 0;
      const small = [...document.querySelectorAll('body *')].filter(shown).filter(e => [...e.childNodes].some(n => n.nodeType===3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize)<14);
      const controls = [...document.querySelectorAll('#room-navigation button')];
      return {overflow: document.documentElement.scrollWidth > innerWidth+1,
        small: small.map(e => e.id || e.className), badControls: controls.filter(e => parseFloat(getComputedStyle(e).fontSize)<16 || e.getBoundingClientRect().height<43.9).map(e => e.dataset.room)};
    }''')
    assert not result['overflow'] and not result['small'] and not result['badControls'], result


def check(page, label):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    data = page.request.get(BASE + '/api/state').json()
    data['projects'] = [dict(id='a', name='테스트 프로젝트 A', source='folder', floor=2),
                        dict(id='b', name='테스트 프로젝트 B', source='folder', floor=7),
                        dict(id='old', name='지난 프로젝트', source='manual', floor=9)]
    data['agents'] = [dict(id='demo', name='체험 동료', role='체험', provider='demo', status='idle')]
    for i, project in enumerate(['a', 'b']):
        session = f'00000000-0000-4000-8000-00000000000{i+1}'
        data['agents'].append(dict(id=f'staff-{project}', name=f'연결 직원 {project}', role='개발', provider='openai',
            status='observing', observedProjectId=project,
            connection=dict(source='cli', kind='session', status='connected', sessionId=session)))
    data['localSessions'].update(status='connected', workspace='테스트', sessions=[])
    page.route('**/api/state', lambda route: route.fulfill(json=data))

    def publish(live, floors):
        data['localSessions']['sessions'] = [dict(id=a['connection']['sessionId'], name=a['name'], provider='openai',
            status='idle', lifecycle='live', lastActivityAt='2026-10-30T00:00:00Z') for a in data['agents'][1:] if a['observedProjectId'] in live]
        page.evaluate("window.dispatchEvent(new Event('online'))")
        expect(page.locator('[data-floor-label]')).to_have_count(floors)

    page.goto(BASE)
    expect(page.locator('#room-heading')).to_have_text('대기실')
    expect(page.locator('[data-floor-label]')).to_have_count(2)
    expect(page.locator('#room-navigation button')).to_have_count(5)
    expect(page.locator('#room-content')).to_contain_text('현재 확인된 활성 프로젝트가 없어')
    audit(page)
    publish(['a', 'b'], 4)
    expect(page.locator('#room-navigation button')).to_have_count(9)
    page.locator('#room-navigation [data-room="office-b"]').click()
    expect(page.locator('#room-heading')).to_have_text('사무실')
    expect(page.locator('#room-content')).to_contain_text('연결 직원 b')
    page.locator('[data-scene-action="in"]').click()
    expect(page.locator('#office-zoom')).to_have_text('115%')
    page.locator('#room-navigation [data-room="office-b"]').focus()
    publish(['b'], 3)
    expect(page.locator('#floor-view-title')).to_have_text('2F · 테스트 프로젝트 B')
    expect(page.locator('#room-navigation [data-room="office-b"]')).to_be_focused()
    expect(page.locator('#office-zoom')).to_have_text('115%')
    expect(page.locator('#desk-grid [data-agent="staff-b"]')).to_be_visible()
    page.locator('#room-navigation [data-floor="0"]').click()
    page.locator('[data-scene-action="in"]').click()
    page.locator('[data-room-assign]').click()
    page.locator('#task-title').fill('아직 보내지 않은 업무')
    publish([], 2)
    expect(page.locator('#room-heading')).to_have_text('대기실')
    expect(page.locator('#floor-view-title')).to_contain_text('2개 층')
    expect(page.locator('#office-zoom')).to_have_text('115%')
    expect(page.locator('#task-title')).to_have_value('아직 보내지 않은 업무')
    expect(page.locator('#task-title')).to_be_focused()
    page.keyboard.press('Escape')
    audit(page)
    if '1366' in label or '320' in label:
        page.locator('#room-navigation').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / f'{label}-empty.png'))
    publish(['a'], 3)
    expect(page.locator('#room-heading')).to_have_text('대기실')
    expect(page.locator('#floor-view-title')).to_contain_text('3개 층')
    page.locator('#room-navigation [data-room="office"]').click()
    expect(page.locator('#room-content')).to_contain_text('연결 직원 a')
    page.locator('[data-scene-action="fullscreen"]').click()
    publish([], 2)
    expect(page.locator('#office-workspace')).to_have_class(re.compile('is-expanded'))
    expect(page.locator('#room-heading')).to_have_text('대기실')
    audit(page)
    page.locator('[data-scene-action="fullscreen"]').click()
    # The default after a reload still contains no fixed work floor.
    page.reload()
    expect(page.locator('[data-floor-label]')).to_have_count(2)
    expect(page.locator('#room-navigation [data-room^="office"]')).to_have_count(0)
    assert not errors, errors
    results.append(dict(case=label, result='passed'))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--enable-unsafe-swiftshader'])
    for theme in ['light', 'dark']:
        for width in [320, 390, 768, 1366, 1920]:
            page = browser.new_page(viewport=dict(width=width, height=1000), color_scheme=theme, reduced_motion='reduce')
            check(page, f'{theme}-{width}')
            page.close()
    browser.close()
    extension = Path('extensions/browser-observer').resolve()
    for theme in ['light', 'dark']:
        with tempfile.TemporaryDirectory() as profile:
            context = p.chromium.launch_persistent_context(profile, channel='chromium', headless=True,
                viewport=dict(width=1366, height=1000), color_scheme=theme, reduced_motion='reduce',
                args=['--no-sandbox', '--enable-unsafe-swiftshader', f'--disable-extensions-except={extension}', f'--load-extension={extension}'])
            page = context.pages[0]
            page.goto(BASE)
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('''async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(tab.id,2);return chrome.tabs.getZoom(tab.id);}''') == 2
            check(page, f'{theme}-zoom200')
            context.close()
OUT.joinpath('results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(f'PASS: {len(results)} layouts; inactive, active, shrinking and restored floors, focus, drafts, zoom, fullscreen and reload')
